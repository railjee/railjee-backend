import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PaymentTransactionDocument = PaymentTransaction & Document;

export enum TransactionStatus {
  CREATED = 'created',
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  CAPTURED = 'captured',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  CANCELLED = 'cancelled',
}

export enum TransactionType {
  ORDER = 'order',
  PAYMENT = 'payment',
  REFUND = 'refund',
  VERIFICATION = 'verification',
}

@Schema({ timestamps: true, collection: 'payments' })
export class PaymentTransaction {
  @Prop({ required: true })
  transactionId: string;

  @Prop({ required: true, enum: Object.values(TransactionType) })
  type: TransactionType;

  @Prop({ required: true, default: 'razorpay' })
  gateway: string;

  @Prop({ required: true })
  orderId: string;

  @Prop()
  paymentId?: string;

  @Prop()
  refundId?: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: true, enum: Object.values(TransactionStatus) })
  status: TransactionStatus;

  @Prop()
  method?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Object })
  gatewayResponse?: Record<string, any>;

  @Prop()
  errorCode?: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  userId?: string;

  @Prop()
  customerEmail?: string;

  @Prop()
  customerPhone?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  /** Meta browser ids (fbp, fbc) and the internal flag, captured at order time for the Purchase event. */
  @Prop({ type: Object })
  tracking?: Record<string, any>;
}

export const PaymentTransactionSchema = SchemaFactory.createForClass(PaymentTransaction);

// Indexes for efficient queries
PaymentTransactionSchema.index({ transactionId: 1 });
PaymentTransactionSchema.index({ orderId: 1 });
PaymentTransactionSchema.index({ paymentId: 1 });
PaymentTransactionSchema.index({ gateway: 1, status: 1 });
PaymentTransactionSchema.index({ userId: 1 });
PaymentTransactionSchema.index({ createdAt: -1 });
