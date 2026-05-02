import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer()).get(`/orders/${orderId}`);
    if (expectedStatuses.includes(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Order ${orderId} did not reach ${expectedStatuses} within ${timeoutMs}ms`);
}

describe('Order enrichment flow (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;

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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CurrencyExchangeService)
      .useValue({
        fetchRate: jest.fn().mockImplementation((_currency: string, total: number) =>
          Promise.resolve({ ...FIXED_RATE, converted_total: Math.round(total * 5.2 * 100) / 100 }),
        ),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
    await Promise.all([postgres.stop(), redis.stop()]);
  });

  const basePayload = {
    order_id: 'ext-e2e-001',
    customer: { email: 'e2e@test.com', name: 'E2E User' },
    items: [{ sku: 'SKU-001', qty: 2, unit_price: 50 }],
    currency: 'USD',
    idempotency_key: 'e2e-idem-001',
  };

  it('receives order, processes it through the queue and enriches it', async () => {
    const postRes = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send(basePayload)
      .expect(202);

    expect(postRes.body.status).toBe('accepted');
    const orderId = postRes.body.order_id;

    const order = await pollOrderStatus(app, orderId, ['ENRICHED', 'FAILED_ENRICHMENT']);

    expect(order.status).toBe('ENRICHED');
    expect(order).toHaveProperty('exchange_data');
    expect(order.exchange_data.exchange_rate).toBe(5.2);
    expect(order.exchange_data.source).toBe('test-mock');
    expect(order).not.toHaveProperty('idempotencyKey');
    expect(order).not.toHaveProperty('exchangeError');
  });

  it('returns 202 with duplicate status when idempotency key is reused', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send(basePayload)
      .expect(202);

    expect(res.body.status).toBe('duplicate');
    expect(res.body.message).toBe('Order already received');
  });

  it('rejects invalid payload with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/orders')
      .send({ order_id: 'x' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });

  it('GET /orders lists orders with correct DTO shape', async () => {
    const res = await request(app.getHttpServer()).get('/orders').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body.data[0]).toHaveProperty('order_id');
    expect(res.body.data[0]).not.toHaveProperty('idempotencyKey');
  });

  it('GET /orders/:id returns 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/orders/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('GET /queue/metrics returns queue counts', async () => {
    const res = await request(app.getHttpServer()).get('/queue/metrics').expect(200);

    expect(res.body).toHaveProperty('main_queue');
    expect(res.body).toHaveProperty('dead_letter_queue');
  });
});
