import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CurrencyExchangeService } from '../src/currency-exchange/currency-exchange.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

const FIXED_RATE = {
  base_currency: 'USD',
  target_currency: 'BRL',
  exchange_rate: 5.2,
  converted_total: 0,
  source: 'test-mock',
};

async function pollOrderStatus(
  app: INestApplication,
  orderId: string,
  expectedStatuses: string[],
  timeoutMs = 10000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer()).get(`/orders/${orderId}`);
    if (expectedStatuses.includes(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Order ${orderId} did not reach ${expectedStatuses} within ${timeoutMs}ms`,
  );
}

describe('Order enrichment flow (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let fetchRateMock: jest.Mock;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getMappedPort(5432));
    process.env.DB_USER = postgres.getUsername();
    process.env.DB_PASS = postgres.getPassword();
    process.env.DB_NAME = postgres.getDatabase();
    process.env.REDIS_HOST = redis.getHost();
    process.env.REDIS_PORT = String(redis.getMappedPort(6379));
    process.env.NODE_ENV = 'test';
    // 1 tentativa para que o fluxo de falha termine rapidamente
    process.env.QUEUE_JOB_ATTEMPTS = '1';
    process.env.QUEUE_JOB_BACKOFF_DELAY_MS = '100';

    fetchRateMock = jest
      .fn()
      .mockImplementation((_currency: string, total: number) =>
        Promise.resolve({
          ...FIXED_RATE,
          converted_total: Math.round(total * 5.2 * 100) / 100,
        }),
      );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CurrencyExchangeService)
      .useValue({ fetchRate: fetchRateMock })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
    await Promise.all([postgres.stop(), redis.stop()]);
  });

  afterEach(() => {
    // restaura o mock de sucesso após cada teste para evitar interferência
    fetchRateMock.mockImplementation((_currency: string, total: number) =>
      Promise.resolve({
        ...FIXED_RATE,
        converted_total: Math.round(total * 5.2 * 100) / 100,
      }),
    );
  });

  const basePayload = {
    order_id: 'ext-e2e-001',
    customer: { email: 'e2e@test.com', name: 'E2E User' },
    items: [{ sku: 'SKU-001', qty: 2, unit_price: 50 }],
    currency: 'USD',
    idempotency_key: 'e2e-idem-001',
  };

  // ─── Webhook ────────────────────────────────────────────────────────────────

  it('recebe pedido, processa via fila e enriquece com exchange_data', async () => {
    const postRes = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send(basePayload)
      .expect(202);

    expect(postRes.body.status).toBe('accepted');
    const orderId = postRes.body.order_id;

    const order = await pollOrderStatus(app, orderId, [
      'ENRICHED',
      'FAILED_ENRICHMENT',
    ]);

    expect(order.status).toBe('ENRICHED');
    expect(order.exchange_data).toBeDefined();
    expect(order.exchange_data.exchange_rate).toBe(5.2);
    expect(order.exchange_data.converted_total).toBeGreaterThan(0);
    expect(order.exchange_data.source).toBe('test-mock');
    expect(order.failure_reason).toBeNull();
    expect(order).not.toHaveProperty('idempotencyKey');
    expect(order).not.toHaveProperty('exchangeError');
  });

  it('retorna 202 com status duplicate quando idempotency_key é reutilizada', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send(basePayload)
      .expect(202);

    expect(res.body.status).toBe('duplicate');
    expect(res.body.message).toBe('Order already received');
  });

  it('rejeita payload inválido com 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send({ order_id: 'x' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });

  // ─── Fluxo de falha na fila ──────────────────────────────────────────────────

  it('marca FAILED_ENRICHMENT e popula failure_reason quando todas as tentativas falham', async () => {
    fetchRateMock.mockRejectedValue(new Error('Exchange service unavailable'));

    const payload = {
      ...basePayload,
      order_id: 'ext-e2e-fail-001',
      idempotency_key: 'e2e-idem-fail-001',
    };

    const postRes = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send(payload)
      .expect(202);

    const orderId = postRes.body.order_id;
    const order = await pollOrderStatus(
      app,
      orderId,
      ['FAILED_ENRICHMENT', 'ENRICHED'],
      15000,
    );

    expect(order.status).toBe('FAILED_ENRICHMENT');
    expect(order.failure_reason).toBeTruthy();
    expect(order.exchange_data).toBeNull();
  });

  // ─── Consulta de pedidos ─────────────────────────────────────────────────────

  it('GET /orders lista pedidos com shape de DTO correto (snake_case)', async () => {
    const res = await request(app.getHttpServer()).get('/orders').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');

    const first = res.body.data[0];
    expect(first).toHaveProperty('order_id');
    expect(first).toHaveProperty('total_amount');
    expect(first).toHaveProperty('created_at');
    expect(first).not.toHaveProperty('idempotencyKey');
    expect(first).not.toHaveProperty('exchangeError');
  });

  it('GET /orders?status=ENRICHED retorna apenas pedidos enriquecidos', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders?status=ENRICHED')
      .expect(200);

    res.body.data.forEach((order: any) => {
      expect(order.status).toBe('ENRICHED');
    });
  });

  it('GET /orders?status=FAILED_ENRICHMENT retorna apenas pedidos com falha', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders?status=FAILED_ENRICHMENT')
      .expect(200);

    res.body.data.forEach((order: any) => {
      expect(order.status).toBe('FAILED_ENRICHMENT');
      expect(order.failure_reason).toBeTruthy();
    });
  });

  it('GET /orders/:id retorna 404 para UUID inexistente', async () => {
    await request(app.getHttpServer())
      .get('/orders/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('GET /orders/:id retorna 400 para ID que não é UUID', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders/id-invalido')
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  // ─── Métricas da fila ────────────────────────────────────────────────────────

  it('GET /queue/metrics retorna contadores de jobs da fila principal e DLQ', async () => {
    const res = await request(app.getHttpServer())
      .get('/queue/metrics')
      .expect(200);

    expect(res.body).toHaveProperty('main_queue');
    expect(res.body).toHaveProperty('dead_letter_queue');
    expect(typeof res.body.main_queue.waiting).toBe('number');
    expect(typeof res.body.dead_letter_queue.failed).toBe('number');
  });
});
