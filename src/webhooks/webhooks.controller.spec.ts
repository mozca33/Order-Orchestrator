import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  const mockWebhooks = { receiveOrder: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockWebhooks }],
    }).compile();

    controller = module.get(WebhooksController);
    jest.clearAllMocks();
  });

  const dto = {
    order_id: 'ext-123',
    customer: { email: 'user@example.com', name: 'Ana' },
    items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
    currency: 'USD',
    idempotency_key: '00000000-0000-0000-0000-000000000001',
  };

  it('delega para WebhooksService e retorna o resultado', async () => {
    mockWebhooks.receiveOrder.mockResolvedValue({
      status: 'accepted',
      order_id: 'uuid-1',
    });

    const result = await controller.receiveOrder(dto);

    expect(mockWebhooks.receiveOrder).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ status: 'accepted', order_id: 'uuid-1' });
  });

  it('retorna duplicado quando WebhooksService indica duplicata', async () => {
    mockWebhooks.receiveOrder.mockResolvedValue({
      status: 'duplicate',
      order_id: 'uuid-1',
      message: 'Order already received',
    });

    const result = await controller.receiveOrder(dto);

    expect(result.status).toBe('duplicate');
  });
});
