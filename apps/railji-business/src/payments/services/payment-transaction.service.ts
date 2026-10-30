import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentTransaction,
  PaymentTransactionDocument,
  TransactionStatus,
  TransactionType,
} from '../schemas/payment-transaction.schema';
import { OrderResult, TransactionResult } from '../interfaces/payment-gateway.interface';

@Injectable()
export class PaymentTransactionService {
  constructor(
    @InjectModel(PaymentTransaction.name)
    private paymentModel: Model<PaymentTransactionDocument>,
  ) {}

  async logOrderCreation(
    gateway: string,
    order: OrderResult,
    metadata?: {
      userId?: string;
      customerEmail?: string;
      customerPhone?: string;
      ipAddress?: string;
      userAgent?: string;
      tracking?: Record<string, any>;
    },
  ) {
    return this.paymentModel.create({
      transactionId: order.orderId,
      type: TransactionType.ORDER,
      gateway,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      status: TransactionStatus.CREATED,
      metadata: order.metadata,
      ...metadata,
    });
  }

  async logPaymentVerification(
    gateway: string,
    paymentId: string,
    orderId: string,
    isValid: boolean,
    metadata?: Record<string, any>,
  ) {
    return this.paymentModel.create({
      transactionId: paymentId,
      type: TransactionType.PAYMENT,
      gateway,
      orderId,
      paymentId,
      amount: 0,
      currency: 'INR',
      status: isValid ? TransactionStatus.CAPTURED : TransactionStatus.FAILED,
      metadata,
    });
  }

  async logTransaction(gateway: string, transaction: TransactionResult) {
    return this.paymentModel.findOneAndUpdate(
      { orderId: transaction.orderId },
      {
        paymentId: transaction.transactionId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status as TransactionStatus,
        method: transaction.method,
        gatewayResponse: transaction,
      },
      { upsert: true, new: true },
    );
  }

  async logWebhookEvent(gateway: string, event: string, data: any) {
    const orderId = data?.payment?.entity?.order_id;
    const paymentId = data?.payment?.entity?.id;

    if (orderId) {
      return this.paymentModel.findOneAndUpdate(
        { orderId },
        {
          paymentId,
          status: this.mapStatusFromEvent(event),
          gatewayResponse: data,
        },
        { new: true },
      );
    }
  }

  async getTransactionsByOrderId(orderId: string) {
    return this.paymentModel.find({ orderId }).sort({ createdAt: -1 }).exec();
  }

  /** The record written at order creation (holds userId, plan metadata and tracking ids). */
  async getOrderTransaction(orderId: string) {
    return this.paymentModel.findOne({ orderId, type: TransactionType.ORDER }).exec();
  }

  async getTransactionsByPaymentId(paymentId: string) {
    return this.paymentModel.find({ paymentId }).sort({ createdAt: -1 }).exec();
  }

  async getTransactionsByUserId(userId: string) {
    return this.paymentModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  private mapStatusFromEvent(event: string): TransactionStatus {
    if (event.includes('captured')) return TransactionStatus.CAPTURED;
    if (event.includes('failed')) return TransactionStatus.FAILED;
    if (event.includes('authorized')) return TransactionStatus.AUTHORIZED;
    return TransactionStatus.PENDING;
  }
}
