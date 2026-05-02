import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ORDERS_DLQ, ORDERS_QUEUE } from './queue.constants';
import { OrdersProcessor } from './orders.processor';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { CurrencyExchangeModule } from '../currency-exchange/currency-exchange.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: ORDERS_QUEUE }),
    BullModule.registerQueue({ name: ORDERS_DLQ }),
    CurrencyExchangeModule,
    OrdersModule,
  ],
  providers: [OrdersProcessor, QueueService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
