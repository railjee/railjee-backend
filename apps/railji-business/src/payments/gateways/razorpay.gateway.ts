import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IPaymentGateway,
  OrderResult,
  TransactionResult,
  WebhookEvent,
} from '../interfaces/payment-gateway.interface';
import { config } from '../../config/config';
import { PaymentGatewayException } from '../exceptions/payment.exceptions';

@Injectable()
export class RazorpayGateway implements IPaymentGateway {
  private readonly logger = new Logger(RazorpayGateway.name);
  private razorpay: any;
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;

  constructor() {
    this.keyId = config.payment.razorpay.keyId;
    this.keySecret = config.payment.razorpay.keySecret;
    this.webhookSecret = config.payment.razorpay.webhookSecret;

    if (!this.keyId || !this.keySecret) {
      this.logger.warn('Razorpay credentials not configured');
      return;
    }

    try {
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
      this.logger.log('Razorpay gateway initialized');
    } catch (error) {
      this.logger.error('Razorpay SDK not installed. Install with: npm install razorpay');
    }
  }

  async createOrder(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
  ): Promise<OrderResult> {
    if (!this.razorpay) {
      throw new PaymentGatewayException('Razorpay not configured');
    }

    const options = {
      amount: amount * 100, // Convert to paise
      currency: currency.toUpperCase(),
      receipt: metadata.receipt || `rcpt_${Date.now()}`,
      notes: metadata,
    };

    const order = await this.razorpay.orders.create(options);

    return {
      orderId: order.id,
      amount: order.amount / 100,
      currency: order.currency,
      status: order.status,
      createdAt: new Date(order.created_at * 1000),
      metadata: order.notes,
    };
  }

  async verifyPayment(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    const text = `${orderId}|${paymentId}`;
    const generated = crypto
      .createHmac('sha256', this.keySecret)
      .update(text)
      .digest('hex');

    return generated === signature;
  }

  async getTransaction(paymentId: string): Promise<TransactionResult> {
    if (!this.razorpay) {
      throw new PaymentGatewayException('Razorpay not configured');
    }

    const payment = await this.razorpay.payments.fetch(paymentId);

    return {
      transactionId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount / 100,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      createdAt: new Date(payment.created_at * 1000),
      metadata: payment.notes,
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.error('Webhook secret not configured');
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return expectedSignature === signature;
  }

  parseWebhookEvent(payload: Buffer): WebhookEvent {
    const event = JSON.parse(payload.toString());

    return {
      event: event.event,
      paymentId: event.payload?.payment?.entity?.id,
      orderId: event.payload?.payment?.entity?.order_id,
      status: event.payload?.payment?.entity?.status,
      amount: event.payload?.payment?.entity?.amount
        ? event.payload.payment.entity.amount / 100
        : undefined,
      data: event.payload,
    };
  }
}
