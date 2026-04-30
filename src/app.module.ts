import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { ThrottlerModule } from '@nestjs/throttler';
import { OrdersModule } from './orders/orders.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { QueueModule } from './queue/queue.module';
import { Order } from './orders/order.entity';
import { ORDERS_DLQ, ORDERS_QUEUE } from './queue/queue.constants';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { BullBoardAuthMiddleware } from './common/middleware/bull-board-auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => [
        {
          name: 'webhook',
          ttl: cfg.get<number>('THROTTLE_WEBHOOK_TTL_MS', 60000),
          limit: cfg.get<number>('THROTTLE_WEBHOOK_LIMIT', 100),
        },
        {
          name: 'read',
          ttl: cfg.get<number>('THROTTLE_READ_TTL_MS', 60000),
          limit: cfg.get<number>('THROTTLE_READ_LIMIT', 300),
        },
      ],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST', 'localhost'),
        port: cfg.get<number>('DB_PORT', 5432),
        username: cfg.get('DB_USER', 'postgres'),
        password: cfg.get('DB_PASS', 'postgres'),
        database: cfg.get('DB_NAME', 'orders_db'),
        entities: [Order],
        synchronize: cfg.get('NODE_ENV') !== 'production',
        logging: cfg.get('NODE_ENV') === 'development',
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host: cfg.get('REDIS_HOST', 'localhost'),
          port: cfg.get<number>('REDIS_PORT', 6379),
          ...(cfg.get('REDIS_PASSWORD')
            ? { password: cfg.get('REDIS_PASSWORD') }
            : {}),
        },
      }),
    }),

    BullBoardModule.forRoot({ route: '/queues', adapter: ExpressAdapter }),
    BullBoardModule.forFeature({ name: ORDERS_QUEUE, adapter: BullMQAdapter }),
    BullBoardModule.forFeature({ name: ORDERS_DLQ, adapter: BullMQAdapter }),

    OrdersModule,
    WebhooksModule,
    QueueModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    consumer.apply(BullBoardAuthMiddleware).forRoutes('/queues');
  }
}
