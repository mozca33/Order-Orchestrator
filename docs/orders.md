# Módulo: Orders

Responsável por persistir os pedidos no banco de dados, controlar o status de cada um e disponibilizar as rotas de consulta.

---

## Entidade

Cada pedido é salvo na tabela `orders` com os seguintes campos:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID | Identificador interno gerado automaticamente |
| `external_id` | string | ID vindo do sistema externo (`order_id` do payload) |
| `idempotency_key` | string | Chave para evitar processamento duplicado |
| `customer` | jsonb | Dados do cliente (nome e email) |
| `items` | jsonb | Lista de itens do pedido |
| `currency` | string | Moeda do pedido (ex: USD, BRL) |
| `total_amount` | numeric | Soma de `qty × unit_price` de todos os itens |
| `status` | enum | Status atual do pedido |
| `exchange_data` | jsonb | Dados da cotação obtida (preenchido após enriquecimento) |
| `exchange_error` | text | Mensagem de erro caso o enriquecimento falhe |
| `created_at` | timestamp | Data de criação |
| `updated_at` | timestamp | Data da última atualização |

---

## Status

```
RECEIVED           → pedido recebido e salvo
PROCESSING         → worker iniciou a busca de cotação
ENRICHED           → cotação obtida com sucesso
FAILED_ENRICHMENT  → todas as tentativas falharam
```

---

## Endpoints

### Listar pedidos

```
GET /orders
GET /orders?status=ENRICHED
```

Retorna todos os pedidos ordenados do mais recente para o mais antigo. O filtro `status` é opcional.

### Buscar pedido por ID

```
GET /orders/:id
```

Retorna os detalhes de um pedido pelo ID interno (UUID). Retorna `404` se não encontrado e `400` se o ID não for um UUID válido.
