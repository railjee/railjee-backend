import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './services/payments.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { MissingSignatureException } from './exceptions/payment.exceptions';
import { SharedUsersService } from '@railji/shared';
import { getClientContext, maskId } from '../modules/meta/tracking.utils';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly usersService: SharedUsersService,
  ) {}

  @Post('order')
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() createOrderDto: CreateOrderDto, @Req() req: any) {
    try {
      this.logger.log('Creating order');
      
      const user = await this.usersService.getUserFromRequest(req);
      const userId = user.userId;
      
      if (!userId) {
        throw new ForbiddenException('User not authenticated');
      }

      const result = await this.paymentsService.createOrder(
        createOrderDto.planId,
        userId,
        createOrderDto.metadata || {},
        { user, client: getClientContext(req) },
      );

      this.logger.log(`Order created successfully: ${maskId(result.orderId)}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(@Body() dto: VerifyPaymentDto) {
    this.logger.log('Verifying payment');
    const isValid = await this.paymentsService.verifyPayment(
      dto.orderId,
      dto.paymentId,
      dto.signature,
    );

    return {
      success: isValid,
      message: isValid ? 'Payment verified' : 'Verification failed',
    };
  }

  @Post('webhook/razorpay')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    // Don't log the body (customer email, phone, payment details) or the signature.
    this.logger.log(`Webhook received - event: ${(req.body as any)?.event ?? 'unknown'}`);

    if (!signature) {
      throw new MissingSignatureException();
    }

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    return this.paymentsService.handleWebhook(rawBody, signature);
  }

  @Get('transaction/:orderId')
  @HttpCode(HttpStatus.OK)
  async getTransaction(@Param('orderId') orderId: string) {
    return this.paymentsService.getTransaction(orderId);
  }

  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  async getUserTransactions(@Param('userId') userId: string) {
    return this.paymentsService.getUserTransactions(userId);
  }

  @Get('plans')
  @HttpCode(HttpStatus.OK)
  async getPlans() {
    return this.paymentsService.getPlans();
  }

  @Get('subscriptions')
  @HttpCode(HttpStatus.OK)
  async getUserSubscriptions(@Req() req: any) {
    const user = await this.usersService.getUserFromRequest(req);
    return this.paymentsService.getUserSubscriptions(user.userId);
  }

}
