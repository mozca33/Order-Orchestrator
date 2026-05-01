import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  DefaultValuePipe,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { OrderStatus } from './order.entity';

const MAX_PAGE_LIMIT = 100;

@Controller('orders')
@UseGuards(ThrottlerGuard)
@Throttle({ read: {} })
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(
    @Query('status', new ParseEnumPipe(OrderStatus, { optional: true }))
    status?: OrderStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    const safePage = Math.max(1, page ?? 1);
    const safeLimit = Math.min(Math.max(1, limit ?? 20), MAX_PAGE_LIMIT);
    return this.ordersService.findAll(status, safePage, safeLimit);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }
}
