import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
@UseGuards(ThrottlerGuard)
@Throttle({ webhook: {} })
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  receiveOrder(@Body() dto: CreateOrderDto) {
    return this.webhooks.receiveOrder(dto);
  }
}
