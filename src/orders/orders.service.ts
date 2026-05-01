import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { Order, OrderStatus, ExchangeRateData } from './order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly repo: Repository<Order>,
  ) {}

  async create(
    dto: CreateOrderDto,
  ): Promise<{ order: Order; isDuplicate: boolean }> {
    const rawTotal = dto.items.reduce(
      (sum, i) => sum + i.qty * i.unit_price,
      0,
    );
    const total = Math.round(rawTotal * 10000) / 10000;

    const order = this.repo.create({
      externalId: dto.order_id,
      idempotencyKey: dto.idempotency_key,
      customer: dto.customer,
      items: dto.items,
      currency: dto.currency,
      totalAmount: total,
      status: OrderStatus.RECEIVED,
    });

    try {
      await this.repo.save(order);
      return { order, isDuplicate: false };
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code === '23505'
      ) {
        const existing = await this.repo.findOne({
          where: { idempotencyKey: dto.idempotency_key },
        });
        if (existing) return { order: existing, isDuplicate: true };
        throw new ConflictException(
          `Duplicate order: idempotency key "${dto.idempotency_key}"`,
        );
      }
      throw err;
    }
  }

  async findAll(
    status?: OrderStatus,
    page = 1,
    limit = 20,
  ): Promise<{
    data: OrderResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where = status ? { status } : {};
    const [orders, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: orders.map((o) => OrderResponseDto.fromEntity(o)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<OrderResponseDto> {
    const order = await this.repo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return OrderResponseDto.fromEntity(order);
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    exchangeData?: ExchangeRateData,
    error?: string,
  ): Promise<void> {
    const patch: Partial<Order> = { status };
    if (exchangeData !== undefined) patch.exchangeData = exchangeData;
    if (error !== undefined) patch.exchangeError = error;
    await this.repo.update(id, patch);
  }
}
