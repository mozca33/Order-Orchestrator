# Módulo: Webhooks

Responsável por receber pedidos externos via HTTP e dar início ao fluxo de processamento.

---

## Endpoint

```
POST /webhooks/orders
```

---

## O que ele faz

1. Recebe o payload do pedido
2. Valida todos os campos obrigatórios
3. Verifica se o pedido já foi recebido antes (idempotência)
4. Salva o pedido no banco com status `RECEIVED`
5. Enfileira o pedido para busca da cotação
6. Retorna `202 Accepted` com o ID interno do pedido

---

## Payload esperado

```json
{
  "order_id": "ext-123",
  "customer": {
    "email": "user@example.com",
    "name": "Ana"
  },
  "items": [
    { "sku": "ABC123", "qty": 2, "unit_price": 59.9 }
  ],
  "currency": "USD",
  "idempotency_key": "chave-unica-qualquer"
}
```

### Validações aplicadas

| Campo | Regra |
|---|---|
| `order_id` | string não vazia |
| `customer.email` | e-mail válido |
| `customer.name` | string não vazia |
| `items` | array com pelo menos 1 item |
| `items[].qty` | número inteiro maior ou igual a 1 |
| `items[].unit_price` | número positivo |
| `currency` | código ISO 4217 válido (ex: USD, BRL, EUR) — aceita minúsculo, normaliza automaticamente |
| `idempotency_key` | string não vazia |

---

## Idempotência

Se o mesmo `idempotency_key` for enviado mais de uma vez, o sistema retorna o pedido original sem reprocessar:

```json
{
  "status": "duplicate",
  "order_id": "uuid-do-pedido-original",
  "message": "Order already received"
}
```

---

## Respostas

| Status | Situação |
|---|---|
| `202` | Pedido aceito (novo ou duplicado) |
| `400` | Payload inválido |
| `409` | Conflito de `order_id` com chave de idempotência diferente |
