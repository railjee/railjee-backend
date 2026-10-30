import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { PaymentTransactionService } from './payment-transaction.service';
import { InvalidWebhookException } from '../exceptions/payment.exceptions';
import { SharedSubscriptionsService, GrantAccessDto, Plan, User } from '@railji/shared';
import { MetaCapiService } from '../../modules/meta/meta-capi.service';
import { ClientContext, logEvent, maskId } from '../../modules/meta/tracking.utils';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly transactionService: PaymentTransactionService,
    private readonly subscriptionsService: SharedSubscriptionsService,
    @InjectModel(Plan.name)
    private planModel: Model<Plan>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private readonly metaCapi: MetaCapiService,
  ) {}

  async createOrder(
    planId: string,
    userId: string,
    rawMetadata: Record<string, any> = {},
    context: { user?: User; client?: ClientContext } = {},
  ) {
    // Tracking ids from the browser go on our order record, not into Razorpay notes.
    const { fbp, fbc, internal, ...metadata } = rawMetadata;
    const tracking = {
      fbp: typeof fbp === 'string' ? fbp.slice(0, 200) : undefined,
      fbc: typeof fbc === 'string' ? fbc.slice(0, 200) : undefined,
      internal: internal === true ? true : undefined,
    };

    try {
      this.logger.log(`Creating order for plan: ${planId}`);

      // Fetch plan details
      const plan = await this.planModel.findOne({ planId, isActive: true }).exec();
      
      if (!plan) {
        throw new NotFoundException(`Plan ${planId} not found or inactive`);
      }

      // Check if user already has an active subscription for this plan
      const existingSubscriptions = await this.subscriptionsService.findActiveSubscription(userId);
      const hasActivePlan = existingSubscriptions.some(
        (sub) => sub.planId === planId && sub.status === 'active' && new Date(sub.endDate) > new Date()
      );

      if (hasActivePlan) {
        throw new ConflictException(
          `You already have an active subscription for this plan. Please wait until it expires before purchasing again.`
        );
      }

      const gateway = this.gatewayFactory.getGateway();
      const gatewayType = this.gatewayFactory.getActiveGatewayType();

      // Add plan and user info to metadata
      const orderMetadata = {
        ...metadata,
        planId: plan.planId,
        departmentId: plan.departmentId,
        userId,
        durationMonths: plan.durationMonths,
        price: plan.price,
      };

      this.logger.log(`Creating order with gateway: ${gatewayType}`);
      const order = await gateway.createOrder(plan.price, plan.currency, orderMetadata);
      this.logger.log(`Gateway order created: ${maskId(order.orderId)}`);

      await this.transactionService.logOrderCreation(gatewayType, order, {
        userId,
        customerEmail: metadata.email,
        customerPhone: metadata.phone,
        ipAddress: context.client?.ip,
        userAgent: context.client?.userAgent,
        tracking,
      });

      this.logger.log(`Transaction logged for order: ${maskId(order.orderId)}`);
      logEvent(this.logger, 'payment_event', {
        type: 'order_created',
        order_id: maskId(order.orderId),
        plan_id: plan.planId,
        amount: order.amount,
        currency: order.currency,
      });

      const user = context.user;
      const excluded = this.metaCapi.isExcluded({
        internalFlag: tracking.internal,
        email: user?.email,
        userType: user?.userType,
        trackingExcluded: user?.trackingExcluded,
      });
      if (!excluded) {
        this.metaCapi.send({
          eventName: 'InitiateCheckout',
          // The browser copy (Phase 3) uses the same order id.
          eventId: order.orderId,
          eventSourcePath: '/subscription',
          client: context.client,
          email: user?.email,
          externalId: userId,
          fbp: tracking.fbp ?? user?.attribution?.fbp,
          fbc: tracking.fbc ?? user?.attribution?.fbc,
          customData: {
            value: order.amount,
            currency: order.currency,
            content_ids: [plan.planId],
            content_category: plan.departmentId,
            content_type: 'product',
            num_items: 1,
          },
        });
      }

      return order;
    } catch (error) {
      this.logger.error(`Error in createOrder: ${error.message}`, error.stack);
      throw error;
    }
  }

  async verifyPayment(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    this.logger.log(`Verifying payment: ${maskId(paymentId)}`);

    const gateway = this.gatewayFactory.getGateway();
    const gatewayType = this.gatewayFactory.getActiveGatewayType();

    const isValid = await gateway.verifyPayment(orderId, paymentId, signature);

    await this.transactionService.logPaymentVerification(
      gatewayType,
      paymentId,
      orderId,
      isValid,
      { signature },
    );

    // If payment is valid, grant department access
    if (isValid) {
      await this.grantDepartmentAccessFromOrder(orderId, paymentId, gatewayType);
    }

    return isValid;
  }

  private async grantDepartmentAccessFromOrder(orderId: string, paymentId: string, gateway: string) {
    try {
      // Get transaction details to extract departmentId and userId
      const transactions = await this.transactionService.getTransactionsByOrderId(orderId);
      
      if (!transactions || transactions.length === 0) {
        this.logger.error(`No transaction found for order ${orderId}`);
        return;
      }

      const transaction = transactions[0];
      const planId = transaction.metadata?.planId;
      const departmentId = transaction.metadata?.departmentId;
      const userId = transaction.userId;
      const durationMonths = transaction.metadata?.durationMonths || 12;

      if (!departmentId || !userId) {
        this.logger.error(`Missing departmentId or userId in transaction ${orderId}`);
        return;
      }

      // Create subscription using the shared service
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + durationMonths);

      await this.subscriptionsService.grantAccess({
        userId,
        departmentId,
        planId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        paymentRef: paymentId,
        paymentGateway: gateway,
        description: `${durationMonths} month access to department ${departmentId}`,
      });

      this.logger.log(`Granted department ${departmentId} access to user ${userId} until ${endDate}`);
    } catch (error) {
      this.logger.error(`Failed to grant department access: ${error.message}`, error);
      throw error;
    }
  }

  async handleWebhook(payload: Buffer, signature: string) {
    this.logger.log('Processing webhook');

    const gateway = this.gatewayFactory.getGateway();
    const gatewayType = this.gatewayFactory.getActiveGatewayType();

    const isValid = gateway.verifyWebhookSignature(payload, signature);
    if (!isValid) {
      throw new InvalidWebhookException();
    }

    const event = gateway.parseWebhookEvent(payload);
    logEvent(this.logger, 'payment_event', {
      type: event.event,
      order_id: maskId(event.orderId),
      payment_id: maskId(event.paymentId),
      amount: event.amount,
    });

    await this.transactionService.logWebhookEvent(gatewayType, event.event, event.data);

    // Handle payment captured event
    if (event.event === 'payment.captured' && event.orderId && event.paymentId) {
      // Before the access grant: the money is captured even if the grant fails.
      // Fire-and-forget, so it never delays the webhook response.
      await this.trackPurchase(event.orderId, event.paymentId, event.amount, event.data);
      await this.grantDepartmentAccessFromOrder(event.orderId, event.paymentId, gatewayType);
    }

    return { success: true, event: event.event };
  }

  /**
   * Meta Purchase for a captured payment. event_id is the payment id, so
   * Razorpay webhook retries are deduped by Meta. Only reads from our DB
   * (two indexed lookups) and never throws.
   */
  private async trackPurchase(
    orderId: string,
    paymentId: string,
    amount: number | undefined,
    data: Record<string, any>,
  ): Promise<void> {
    try {
      const order = await this.transactionService.getOrderTransaction(orderId);
      const user = order?.userId
        ? await this.userModel.findOne({ userId: order.userId }).exec()
        : null;

      const excluded = this.metaCapi.isExcluded({
        internalFlag: order?.tracking?.internal,
        email: user?.email,
        userType: user?.userType,
        trackingExcluded: user?.trackingExcluded,
      });
      if (excluded) {
        logEvent(this.logger, 'payment_event', {
          type: 'purchase_not_tracked',
          payment_id: maskId(paymentId),
          reason: 'internal',
        });
        return;
      }

      const currency = String(data?.payment?.entity?.currency || order?.currency || 'INR').toUpperCase();

      this.metaCapi.send({
        eventName: 'Purchase',
        eventId: paymentId,
        eventSourcePath: '/subscription',
        client: { ip: order?.ipAddress, userAgent: order?.userAgent },
        email: user?.email,
        externalId: order?.userId,
        fbp: order?.tracking?.fbp ?? user?.attribution?.fbp,
        fbc: order?.tracking?.fbc ?? user?.attribution?.fbc,
        customData: {
          value: amount ?? order?.amount,
          currency,
          content_ids: order?.metadata?.planId ? [order.metadata.planId] : undefined,
          content_category: order?.metadata?.departmentId,
          content_type: 'product',
          num_items: 1,
          order_id: orderId,
        },
      });
    } catch (error) {
      this.logger.warn(`Purchase tracking skipped for ${maskId(paymentId)}: ${error.message}`);
    }
  }

  async getTransaction(orderId: string) {
    return this.transactionService.getTransactionsByOrderId(orderId);
  }

  async getUserTransactions(userId: string) {
    return this.transactionService.getTransactionsByUserId(userId);
  }

  async grantSubscriptionAccess(grantAccessDto: GrantAccessDto) {
    this.logger.log(`Granting subscription access to user ${grantAccessDto.userId}`);
    return this.subscriptionsService.grantAccess(grantAccessDto);
  }

  async getPlans() {
    return this.planModel.find({ isActive: true }).sort({ departmentId: 1 }).exec();
  }

  async getUserSubscriptions(userId: string) {
    const subscriptions = await this.subscriptionsService.findActiveSubscription(userId);
    
    if (!subscriptions || subscriptions.length === 0) {
      throw new NotFoundException(`No active subscription found for user ${userId}`);
    }
    
    return subscriptions;
  }
}
