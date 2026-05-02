import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ENRICH_JOB, ORDERS_DLQ, ORDERS_QUEUE } from './queue.constants';
import { ExchangeJobPayload } from './orders.processor';

@Injectable()
export class QueueService {
  private readonly jobAttempts: number;
  private readonly jobBackoffDelay: number;

  constructor(
    @InjectQueue(ORDERS_QUEUE) private readonly mainQueue: Queue,
    @InjectQueue(ORDERS_DLQ) private readonly dlq: Queue,
    private readonly config: ConfigService,
  ) {
    this.jobAttempts = this.config.get<number>('QUEUE_JOB_ATTEMPTS', 3);
    this.jobBackoffDelay = this.config.get<number>(
      'QUEUE_JOB_BACKOFF_DELAY_MS',
      2000,
    );
  }

  async enqueueExchange(payload: ExchangeJobPayload): Promise<void> {
    await this.mainQueue.add(ENRICH_JOB, payload, {
      attempts: this.jobAttempts,
      backoff: { type: 'exponential', delay: this.jobBackoffDelay },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async getMetrics() {
    const [mainCounts, dlqCounts] = await Promise.all([
      this.mainQueue.getJobCounts(),
      this.dlq.getJobCounts(),
    ]);

    return {
      main_queue: {
        name: ORDERS_QUEUE,
        ...mainCounts,
      },
      dead_letter_queue: {
        name: ORDERS_DLQ,
        ...dlqCounts,
      },
    };
  }
}
