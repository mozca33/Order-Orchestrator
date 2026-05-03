# Módulo: Queue

Responsável pelo processamento assíncrono dos pedidos, controle de retentativas e envio para a fila de erros (DLQ) em caso de falha definitiva.

---

## Filas

| Nome | Função |
|---|---|
| `orders` | Fila principal — processa a busca de cotação |
| `orders-dlq` | Dead Letter Queue — recebe pedidos que falharam em todas as tentativas |

---

## Fluxo de processamento

```
Pedido enfileirado
       ↓
Atualiza status → PROCESSING
       ↓
Consulta cotação (CurrencyExchangeService)
       ↓ sucesso
Atualiza status → ENRICHED + salva exchange_data
       ↓ falha
Retenta (até 3×, backoff exponencial: 2s, 4s, 8s)
       ↓ todas as tentativas falharam
Move para DLQ + atualiza status → FAILED_ENRICHMENT + salva exchange_error
```

---

## Configuração de retry

| Parâmetro | Valor |
|---|---|
| Tentativas | 3 |
| Estratégia | Exponential backoff |
| Delay inicial | 2 segundos |

---

## Endpoint de métricas

```
GET /queue/metrics
```

Retorna a contagem de jobs em cada estado para as duas filas:

```json
{
  "main_queue": {
    "name": "orders",
    "waiting": 0,
    "active": 1,
    "completed": 12,
    "failed": 2
  },
  "dead_letter_queue": {
    "name": "orders-dlq",
    "waiting": 0,
    "active": 0,
    "completed": 0,
    "failed": 1
  }
}
```
