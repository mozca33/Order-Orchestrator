import { Order, OrderStatus, ExchangeRateData } from '../order.entity';

export class OrderResponseDto {
  id: string;
  order_id: string;
  customer: { email: string; name: string };
  items: { sku: string; qty: number; unit_price: number }[];
  currency: string;
  total_amount: number;
  status: OrderStatus;
  exchange_data: ExchangeRateData | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;

  static fromEntity(order: Order): OrderResponseDto {
    return {
      id: order.id,
      order_id: order.externalId,
      customer: order.customer,
      items: order.items,
      currency: order.currency,
      total_amount: order.totalAmount,
      status: order.status,
      exchange_data: order.exchangeData,
      failure_reason: order.exchangeError,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }
}
