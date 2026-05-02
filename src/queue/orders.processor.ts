import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CurrencyExchangeService } from '../currency-exchange/currency-exchange.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/order.entity';
import { ENRICH_JOB, ORDERS_DLQ, ORDERS_QUEUE } from './queue.constants';

export interface ExchangeJobPayload {
  orderId: string;
  currency: string;
  totalAmount: number;
}

@Processor(ORDERS_QUEUE)
export class OrdersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrdersProcessor.name);

  constructor(
    private readonly currencyExchange: CurrencyExchangeService,
    private readonly orders: OrdersService,
    @InjectQueue(ORDERS_DLQ) private readonly dlq: Queue,
  ) {
    super();
  }

  async process(job: Job<ExchangeJobPayload>): Promise<void> {
    const { orderId, currency, totalAmount } = job.data;
    const maxAttempts = job.opts.attempts ?? 3;
    this.logger.log(
      `Processing job ${job.id} — order ${orderId} (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
    );

    await this.orders.updateStatus(orderId, OrderStatus.PROCESSING);

    try {
      const result = await this.currencyExchange.fetchRate(
        currency,
        totalAmount,
      );
      await this.orders.updateStatus(orderId, OrderStatus.ENRICHED, result);
      this.logger.log(`Exchange rate fetched for order ${orderId}`);
    } catch (err) {
      const error = err as Error;
      const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

      this.logger.warn(
        `Job ${job.id} failed (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${error.message}`,
      );

      if (isLastAttempt) {
        this.logger.error(
          `Order ${orderId} moved to DLQ after all attempts exhausted`,
        );
        await this.dlq.add(ENRICH_JOB, job.data, { removeOnComplete: false });
        await this.orders.updateStatus(
          orderId,
          OrderStatus.FAILED_ENRICHMENT,
          undefined,
          error.message,
        );
      }

      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExchangeJobPayload>, error: Error): void {
    this.logger.warn(
      `Job ${job.id} (order ${job.data.orderId}) marked failed by BullMQ: ${error.message}`,
    );
  }
}
