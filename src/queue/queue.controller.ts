import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { QueueService } from './queue.service';

@Controller('queue')
@UseGuards(ThrottlerGuard)
@Throttle({ read: {} })
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('metrics')
  getMetrics() {
    return this.queueService.getMetrics();
  }
}
