import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './order.entity';
import { CreateOrderDto } from './dto/create-order.dto';

const mockOrder: Order = {
  id: 'uuid-1',
  externalId: 'ext-123',
  idempotencyKey: 'idem-key-1',
  customer: { email: 'user@example.com', name: 'Ana' },
  items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
  currency: 'USD',
  totalAmount: 119.8,
  status: OrderStatus.RECEIVED,
  exchangeData: null,
  exchangeError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OrdersService', () => {
  let service: OrdersService;
  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: mockRepo },
      ],
    }).compile();

    service = module.get(OrdersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto: CreateOrderDto = {
      order_id: 'ext-123',
      customer: { email: 'user@example.com', name: 'Ana' },
      items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
      currency: 'USD',
      idempotency_key: 'idem-key-1',
    };

    it('cria e persiste novo pedido com status RECEIVED', async () => {
      mockRepo.create.mockReturnValue(mockOrder);
      mockRepo.save.mockResolvedValue(mockOrder);

      const result = await service.create(dto);

      expect(result.isDuplicate).toBe(false);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'ext-123',
          status: OrderStatus.RECEIVED,
          totalAmount: 119.8,
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('retorna pedido existente quando DB lança 23505 (race-safe idempotency)', async () => {
      mockRepo.create.mockReturnValue(mockOrder);
      const conflictErr = Object.assign(
        new QueryFailedError('INSERT', [], new Error()),
        { code: '23505' },
      );
      mockRepo.save.mockRejectedValue(conflictErr);
      mockRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.create(dto);

      expect(result.isDuplicate).toBe(true);
      expect(result.order).toBe(mockOrder);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: dto.idempotency_key },
      });
    });

    it('arredonda totalAmount para 4 casas decimais', async () => {
      const dtoWithFraction: CreateOrderDto = {
        ...dto,
        items: [{ sku: 'X', qty: 3, unit_price: 0.1 }],
      };
      mockRepo.create.mockReturnValue(mockOrder);
      mockRepo.save.mockResolvedValue(mockOrder);

      await service.create(dtoWithFraction);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalAmount: 0.3 }),
      );
    });
  });

  describe('findOne', () => {
    it('retorna DTO do pedido quando encontrado', async () => {
      mockRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.findOne('uuid-1');

      expect(result.id).toBe(mockOrder.id);
      expect(result.order_id).toBe(mockOrder.externalId);
    });

    it('mapeia exchangeError para failure_reason no DTO', async () => {
      const failedOrder: Order = {
        ...mockOrder,
        status: OrderStatus.FAILED_ENRICHMENT,
        exchangeError: 'Exchange API indisponível',
      };
      mockRepo.findOne.mockResolvedValue(failedOrder);

      const result = await service.findOne('uuid-1');

      expect(result.failure_reason).toBe('Exchange API indisponível');
    });

    it('não expõe idempotencyKey nem exchangeError diretamente', async () => {
      mockRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.findOne('uuid-1');

      expect(result).not.toHaveProperty('idempotencyKey');
      expect(result).not.toHaveProperty('exchangeError');
    });

    it('lança NotFoundException quando pedido não existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('id-inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('retorna dados paginados como DTOs', async () => {
      mockRepo.findAndCount.mockResolvedValue([[mockOrder], 1]);

      const result = await service.findAll(undefined, 1, 20);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data[0].order_id).toBe(mockOrder.externalId);
    });

    it('filtra por status quando fornecido', async () => {
      mockRepo.findAndCount.mockResolvedValue([[mockOrder], 1]);

      await service.findAll(OrderStatus.RECEIVED, 1, 20);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: OrderStatus.RECEIVED } }),
      );
    });

    it('não aplica filtro de status quando undefined', async () => {
      mockRepo.findAndCount.mockResolvedValue([[mockOrder], 1]);

      await service.findAll(undefined, 1, 20);

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('não expõe idempotencyKey na listagem', async () => {
      mockRepo.findAndCount.mockResolvedValue([[mockOrder], 1]);

      const result = await service.findAll(undefined, 1, 20);

      expect(result.data[0]).not.toHaveProperty('idempotencyKey');
    });
  });

  describe('updateStatus', () => {
    it('atualiza somente status quando sem dados adicionais', async () => {
      mockRepo.update.mockResolvedValue({});

      await service.updateStatus('uuid-1', OrderStatus.PROCESSING);

      expect(mockRepo.update).toHaveBeenCalledWith('uuid-1', {
        status: OrderStatus.PROCESSING,
      });
    });

    it('inclui exchangeData ao atualizar para ENRICHED', async () => {
      mockRepo.update.mockResolvedValue({});
      const exchangeData = {
        base_currency: 'USD',
        target_currency: 'BRL',
        exchange_rate: 5.1,
        converted_total: 611.0,
        source: 'test',
      };

      await service.updateStatus('uuid-1', OrderStatus.ENRICHED, exchangeData);

      expect(mockRepo.update).toHaveBeenCalledWith('uuid-1', {
        status: OrderStatus.ENRICHED,
        exchangeData,
      });
    });

    it('inclui exchangeError ao atualizar para FAILED_ENRICHMENT', async () => {
      mockRepo.update.mockResolvedValue({});

      await service.updateStatus(
        'uuid-1',
        OrderStatus.FAILED_ENRICHMENT,
        undefined,
        'API timeout após 3 tentativas',
      );

      expect(mockRepo.update).toHaveBeenCalledWith('uuid-1', {
        status: OrderStatus.FAILED_ENRICHMENT,
        exchangeError: 'API timeout após 3 tentativas',
      });
    });
  });
});
