import { Test } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { OrdersService } from '../orders/orders.service';
import { QueueService } from '../queue/queue.service';
import { Order, OrderStatus } from '../orders/order.entity';

const mockOrder: Partial<Order> = {
  id: 'uuid-1',
  currency: 'USD',
  totalAmount: 119.8,
  status: OrderStatus.RECEIVED,
};

describe('WebhooksService', () => {
  let service: WebhooksService;
  const mockOrders = { create: jest.fn(), updateStatus: jest.fn() };
  const mockQueue = { enqueueExchange: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: OrdersService, useValue: mockOrders },
        { provide: QueueService, useValue: mockQueue },
      ],
    }).compile();

    service = module.get(WebhooksService);
    jest.clearAllMocks();
  });

  const dto = {
    order_id: 'ext-123',
    customer: { email: 'user@example.com', name: 'Ana' },
    items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
    currency: 'USD' as const,
    idempotency_key: '00000000-0000-0000-0000-000000000001',
  };

  it('aceita novo pedido, enfileira e retorna accepted', async () => {
    mockOrders.create.mockResolvedValue({ order: mockOrder, isDuplicate: false });
    mockQueue.enqueueExchange.mockResolvedValue(undefined);

    const result = await service.receiveOrder(dto);

    expect(result).toEqual({ status: 'accepted', order_id: 'uuid-1' });
    expect(mockQueue.enqueueExchange).toHaveBeenCalledWith({
      orderId: 'uuid-1',
      currency: 'USD',
      totalAmount: 119.8,
    });
  });

  it('retorna duplicate sem enfileirar quando pedido já existe', async () => {
    mockOrders.create.mockResolvedValue({ order: mockOrder, isDuplicate: true });

    const result = await service.receiveOrder(dto);

    expect(result.status).toBe('duplicate');
    expect(mockQueue.enqueueExchange).not.toHaveBeenCalled();
  });

  it('marca FAILED_ENRICHMENT e repropaga erro quando fila está indisponível', async () => {
    mockOrders.create.mockResolvedValue({ order: mockOrder, isDuplicate: false });
    mockQueue.enqueueExchange.mockRejectedValue(new Error('Redis down'));
    mockOrders.updateStatus.mockResolvedValue(undefined);

    await expect(service.receiveOrder(dto)).rejects.toThrow('Redis down');
    expect(mockOrders.updateStatus).toHaveBeenCalledWith(
      'uuid-1',
      OrderStatus.FAILED_ENRICHMENT,
      undefined,
      expect.stringContaining('Redis down'),
    );
  });
});
