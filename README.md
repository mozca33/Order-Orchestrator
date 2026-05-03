# Order Orchestrator

---

## Tecnologias

| Função | Tecnologia |
|---|---|
| Framework | NestJS 11 |
| Banco de dados | PostgreSQL + TypeORM |
| Fila e retry | BullMQ + Redis |
| API de câmbio | AwesomeAPI (fallback: Frankfurter) |
| Infraestrutura local | Docker Compose |
| Painel de filas | Bull Board (`/queues`) |
| Segurança HTTP | Helmet |
| Rate limiting | @nestjs/throttler |

---

## Pré-requisitos

| Ferramenta | Versão recomendada | Validado com |
|---|---|---|
| **Node.js** | 20 LTS ou 22 LTS | Node 22 + npm 10.9.2 |
| **Docker Desktop** | 4.x+ | Docker 28.0.1 |
| **Docker Compose** | v2 (plugin) | já incluso no Docker Desktop |
| **Git** | qualquer recente | — |
| **VS Code** | atual | IDE usada no desenvolvimento |

> Postgres e Redis **não precisam ser instalados localmente** — o `docker-compose.yml` já fixa as versões (`postgres:16-alpine` e `redis:7-alpine`) e o Docker baixa as imagens automaticamente.

> Node.js: https://nodejs.org (escolher LTS) · Docker Desktop: https://www.docker.com/products/docker-desktop

---

## Como rodar (passo a passo)

### 1. Clonar o repositório

```bash
git clone https://github.com/mozca33/Order-Orchestrator.git
cd Order-Orchestrator
```

### 2. Abrir no VS Code

```bash
code .
```

> Extensões recomendadas (não obrigatórias): **ESLint**, **Prettier - Code formatter** e **REST Client** ou **Postman** (a coleção `postman_collection.json` está na raiz).

### 3. Instalar as dependências

No terminal integrado do VS Code (`` Ctrl + ` ``):

```bash
npm install
```

### 4. Subir Postgres e Redis via Docker

Com o **Docker Desktop aberto**, rode:

```bash
docker compose up -d
```

Sobe dois containers:
- `postgres:16-alpine` na porta `5432` (banco `orders_db`, user/senha `postgres`/`postgres`)
- `redis:7-alpine` na porta `6379`

Verificar se está tudo de pé: `docker compose ps` — os dois serviços devem aparecer com status `healthy`.

### 5. Configurar variáveis de ambiente

Linux/Mac/Git Bash:
```bash
cp .env.example .env
```

Windows (PowerShell):
```powershell
Copy-Item .env.example .env
```

Os valores padrão já funcionam para o ambiente local. Veja a tabela de variáveis abaixo se quiser customizar (timeouts, rate limits, número de retries, etc.).

### 6. Iniciar a aplicação em modo desenvolvimento

```bash
npm run start:dev
```

Disponível em:
- API: **http://localhost:3000**
- Painel de filas (Bull Board): **http://localhost:3000/queues**

### 7. Testar o webhook

Com a API rodando:

```bash
curl -X POST http://localhost:3000/webhooks/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ext-123",
    "customer": { "email": "ana@example.com", "name": "Ana" },
    "items": [{ "sku": "ABC123", "qty": 2, "unit_price": 59.9 }],
    "currency": "USD",
    "idempotency_key": "test-001"
  }'
```

Resposta (HTTP 202): `{ "status": "accepted", "order_id": "<uuid>" }`.

Em seguida:
- `GET http://localhost:3000/orders` — lista
- `GET http://localhost:3000/orders/<uuid>` — detalhe (já enriquecido com `exchange_data`)
- `GET http://localhost:3000/queue/metrics` — contagem de jobs

Ou importe `postman_collection.json` no Postman para ter todas as requisições prontas.

### 8. Rodar os testes

```bash
npm run test          # 36 testes unitários
npm run test:cov      # com cobertura
npm run test:e2e      # 9 testes end-to-end (sobe Postgres+Redis em containers efêmeros via Testcontainers)
```

> Os testes e2e exigem o Docker rodando, mas **não dependem** do `docker compose up` — eles iniciam seus próprios containers isolados.

### 9. Parar tudo

```bash
# Ctrl+C no terminal do `npm run start:dev`
docker compose down       # derruba postgres e redis
docker compose down -v    # também apaga o volume (limpa o banco)
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta da aplicação |
| `NODE_ENV` | `development` | Ambiente (`development` habilita logs SQL) |
| `DB_HOST` | `localhost` | Host do PostgreSQL |
| `DB_PORT` | `5432` | Porta do PostgreSQL |
| `DB_USER` | `postgres` | Usuário do banco |
| `DB_PASS` | `postgres` | Senha do banco |
| `DB_NAME` | `orders_db` | Nome do banco |
| `REDIS_HOST` | `localhost` | Host do Redis |
| `REDIS_PORT` | `6379` | Porta do Redis |
| `EXCHANGE_TIMEOUT_MS` | `5000` | Timeout das chamadas à API de câmbio (ms) |
| `ALLOWED_ORIGINS` | *(vazio)* | Origens CORS permitidas, separadas por vírgula |
| `THROTTLE_WEBHOOK_TTL_MS` | `60000` | Janela de tempo do throttle no webhook (ms) |
| `THROTTLE_WEBHOOK_LIMIT` | `100` | Requisições máximas por IP na janela do webhook |
| `THROTTLE_READ_TTL_MS` | `60000` | Janela de tempo do throttle nas rotas GET (ms) |
| `THROTTLE_READ_LIMIT` | `300` | Requisições máximas por IP na janela de leitura |
| `QUEUE_DASHBOARD_SECRET` | *(vazio)* | Token para acessar o painel `/queues` via header `x-dashboard-secret` |

---

## Endpoints

### Webhook

#### `POST /webhooks/orders`
Recebe um pedido, valida o payload, garante idempotência e enfileira para processamento.  
Rate limit: **100 req/min por IP**.

**Payload:**
```json
{
  "order_id": "ext-123",
  "customer": { "email": "user@example.com", "name": "Ana" },
  "items": [{ "sku": "ABC123", "qty": 2, "unit_price": 59.9 }],
  "currency": "USD",
  "idempotency_key": "uuid-ou-hash"
}
```

**Limites de validação:**
- `items`: mínimo 1, máximo 500 itens
- `order_id`, `idempotency_key`: máximo 255 caracteres
- `customer.name`: máximo 200 caracteres
- `items[].sku`: máximo 100 caracteres
- `currency`: código ISO 4217 válido (aceita minúsculas — normalizado automaticamente)

**Resposta (202):**
```json
{ "status": "accepted", "order_id": "uuid-interno" }
```

Se o `idempotency_key` já foi recebido antes:
```json
{ "status": "duplicate", "order_id": "uuid-interno", "message": "Order already received" }
```

---

### Pedidos

#### `GET /orders`
Lista pedidos com paginação. Rate limit: **300 req/min por IP**.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `status` | string | Filtra por status (`RECEIVED`, `PROCESSING`, `ENRICHED`, `FAILED_ENRICHMENT`) |
| `page` | number | Página (padrão: `1`) |
| `limit` | number | Itens por página (padrão: `20`) |

**Resposta (200):**
```json
{
  "data": [...],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

#### `GET /orders/:id`
Retorna os detalhes de um pedido pelo ID interno (UUID).

---

### Fila

#### `GET /queue/metrics`
Retorna contagem de jobs nas filas principal e DLQ.

**Resposta (200):**
```json
{
  "main_queue": { "name": "orders", "waiting": 0, "active": 1, "completed": 10, "failed": 0 },
  "dead_letter_queue": { "name": "orders-dlq", "waiting": 2, "active": 0, "completed": 0, "failed": 0 }
}
```

---

### Painel de filas

#### `GET /queues`
Interface visual do Bull Board para monitorar e inspecionar jobs.

Em desenvolvimento (sem `QUEUE_DASHBOARD_SECRET`): acesso livre.  
Em produção: obrigatório enviar o header `x-dashboard-secret: <valor>`.

---

## Ciclo de vida de um pedido

```
RECEIVED → PROCESSING → ENRICHED
                     ↘ FAILED_ENRICHMENT (após 3 tentativas com backoff exponencial)
```

| Status | Descrição |
|---|---|
| `RECEIVED` | Pedido recebido e persistido |
| `PROCESSING` | Worker iniciou o enriquecimento |
| `ENRICHED` | Cotação obtida com sucesso; `exchange_data` preenchido |
| `FAILED_ENRICHMENT` | Todas as tentativas falharam; job movido para a DLQ |

---

## Correlation ID (rastreamento)

Todas as respostas incluem o header `x-request-id`. Você pode passar seu próprio ID na requisição:

```
POST /webhooks/orders
x-request-id: meu-trace-id-123
```

O mesmo valor será ecoado na resposta, facilitando correlacionar logs entre o webhook e o processamento assíncrono. IDs inválidos (com caracteres especiais, acima de 128 chars) são descartados e substituídos por um UUID gerado automaticamente.

---

## Segurança

### Headers HTTP (Helmet)
Todas as respostas incluem headers de segurança: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, entre outros.

### Rate limiting
- Webhook (`POST /webhooks/orders`): 100 req/min por IP (configurável via env)
- Leitura (`GET /orders`, `GET /queue/metrics`): 300 req/min por IP (configurável via env)

### CORS
Desabilitado por padrão. Configure `ALLOWED_ORIGINS` com as origens que devem ter acesso.

### Painel Bull Board
O painel `/queues` é protegido por secret via header `x-dashboard-secret`. Em produção, a variável `QUEUE_DASHBOARD_SECRET` é obrigatória — sem ela o painel retorna 403.

### Validação de entrada
- Whitelist de campos: campos desconhecidos no payload causam erro 400
- Tipos e limites validados em todos os campos (tamanho de string, mínimo/máximo numérico, formato de email, código de moeda ISO 4217)
- Chave de idempotência com constraint única no banco — duplicatas são detectadas tanto na camada de serviço quanto no banco

---

## Estrutura do projeto

```
src/
├── webhooks/          # Recebimento do pedido via POST
├── orders/            # Entidade, serviço e rotas de consulta
├── currency-exchange/ # Integração com AwesomeAPI + fallback Frankfurter
├── queue/             # Worker, retry, DLQ e métricas
└── common/
    ├── filters/       # Filtro global de erros
    ├── middleware/    # Correlation ID, proteção do Bull Board
    └── validators/    # Validador de moeda ISO 4217
```

Documentação detalhada de cada módulo em [`docs/`](./docs).

---

## Testes

```bash
npm run test          # unitários
npm run test:cov      # com cobertura
npm run test:e2e      # end-to-end (sobe Postgres e Redis via Testcontainers)
```

36 testes unitários cobrindo:

- **OrdersService** — criação com idempotência, paginação, atualização de status
- **OrdersProcessor** — processamento, retry, envio à DLQ na última tentativa
- **WebhooksController** — aceitação de novo pedido e rejeição de duplicata
- **CurrencyExchangeService** — AwesomeAPI, fallback Frankfurter, cache de cotações, erros

Para testar os endpoints manualmente, importe o arquivo `postman_collection.json` no Postman.  
A collection inclui uma variável `queue_dashboard_secret` — defina-a no ambiente do Postman se tiver configurado `QUEUE_DASHBOARD_SECRET`.
