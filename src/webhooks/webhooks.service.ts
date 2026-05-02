import { Injectable, Logger } from '@nestjs/common';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { OrderStatus } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly queue: QueueService,
  ) {}

  async receiveOrder(
    dto: CreateOrderDto,
  ): Promise<{ status: string; order_id: string; message?: string }> {
    const { order, isDuplicate } = await this.orders.create(dto);

    if (isDuplicate) {
      return {
        status: 'duplicate',
        order_id: order.id,
        message: 'Order already received',
      };
    }

    try {
      await this.queue.enqueueExchange({
        orderId: order.id,
        currency: order.currency,
        totalAmount: Number(order.totalAmount),
      });
    } catch (err) {
      this.logger.error(
        `Failed to enqueue order ${order.id}: ${(err as Error).message}`,
      );
      await this.orders.updateStatus(
        order.id,
        OrderStatus.FAILED_ENRICHMENT,
        undefined,
        `Queue unavailable: ${(err as Error).message}`,
      );
      throw err;
    }

    return { status: 'accepted', order_id: order.id };
  }
}
