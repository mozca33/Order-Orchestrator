import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { OrdersProcessor, ExchangeJobPayload } from './orders.processor';
import { CurrencyExchangeService } from '../currency-exchange/currency-exchange.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/order.entity';
import { ORDERS_DLQ } from './queue.constants';

const makeJob = (
  overrides: Partial<Job<ExchangeJobPayload>> = {},
): Job<ExchangeJobPayload> =>
  ({
    id: 'job-1',
    data: { orderId: 'uuid-1', currency: 'USD', totalAmount: 119.8 },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  }) as unknown as Job<ExchangeJobPayload>;

describe('OrdersProcessor', () => {
  let processor: OrdersProcessor;
  const mockExchange = { fetchRate: jest.fn() };
  const mockOrders = { updateStatus: jest.fn() };
  const mockDlq = { add: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersProcessor,
        { provide: CurrencyExchangeService, useValue: mockExchange },
        { provide: OrdersService, useValue: mockOrders },
        { provide: getQueueToken(ORDERS_DLQ), useValue: mockDlq },
      ],
    }).compile();

    processor = module.get(OrdersProcessor);
    jest.clearAllMocks();
  });

  describe('process', () => {
    it('busca cotação e atualiza status para ENRICHED', async () => {
      const exchangeResult = { exchange_rate: 5.1, converted_total: 611.0 };
      mockExchange.fetchRate.mockResolvedValue(exchangeResult);
      mockOrders.updateStatus.mockResolvedValue(undefined);

      await processor.process(makeJob());

      expect(mockOrders.updateStatus).toHaveBeenCalledWith(
        'uuid-1',
        OrderStatus.PROCESSING,
      );
      expect(mockExchange.fetchRate).toHaveBeenCalledWith('USD', 119.8);
      expect(mockOrders.updateStatus).toHaveBeenCalledWith(
        'uuid-1',
        OrderStatus.ENRICHED,
        exchangeResult,
      );
    });

    it('propaga o erro e não envia para DLQ em tentativas intermediárias', async () => {
      mockExchange.fetchRate.mockRejectedValue(new Error('API timeout'));
      mockOrders.updateStatus.mockResolvedValue(undefined);

      // attemptsMade=0 → tentativa 1/3 → não é a última
      await expect(
        processor.process(makeJob({ attemptsMade: 0 })),
      ).rejects.toThrow('API timeout');

      expect(mockDlq.add).not.toHaveBeenCalled();
      expect(mockOrders.updateStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        OrderStatus.FAILED_ENRICHMENT,
        expect.anything(),
        expect.anything(),
      );
    });

    it('envia para DLQ e marca FAILED_ENRICHMENT na última tentativa', async () => {
      const error = new Error('All retries exhausted');
      mockExchange.fetchRate.mockRejectedValue(error);
      mockOrders.updateStatus.mockResolvedValue(undefined);
      mockDlq.add.mockResolvedValue(undefined);

      // attemptsMade=2 → tentativa 3/3 → é a última
      await expect(
        processor.process(makeJob({ attemptsMade: 2 })),
      ).rejects.toThrow('All retries exhausted');

      expect(mockDlq.add).toHaveBeenCalledWith(
        expect.any(String),
        { orderId: 'uuid-1', currency: 'USD', totalAmount: 119.8 },
        expect.objectContaining({ removeOnComplete: false }),
      );
      expect(mockOrders.updateStatus).toHaveBeenCalledWith(
        'uuid-1',
        OrderStatus.FAILED_ENRICHMENT,
        undefined,
        'All retries exhausted',
      );
    });
  });
});
