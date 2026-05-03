# Módulo: Common

Contém recursos compartilhados usados por toda a aplicação.

---

## Filtro global de erros

Arquivo: `src/common/filters/http-exception.filter.ts`

Intercepta todas as exceções da aplicação e formata a resposta de erro de forma consistente:

```json
{
  "statusCode": 400,
  "timestamp": "2026-04-29T14:00:00.000Z",
  "path": "/webhooks/orders",
  "error": "mensagem de erro aqui"
}
```

Quando há um único erro de validação, `error` é uma string simples. Quando há múltiplos erros (validações de DTO), `error` é o array de mensagens retornado pelo `ValidationPipe`:

```json
{
  "error": [
    "currency must be a valid ISO 4217 code (e.g. USD, BRL, EUR)",
    "order_id should not be empty"
  ]
}
```

---

## Validador de moeda

Arquivo: `src/common/validators/is-valid-currency.validator.ts`

Decorator customizado `@IsValidCurrency()` que valida se o código enviado é uma moeda real do padrão ISO 4217.

Aceita tanto maiúsculo quanto minúsculo — a normalização para maiúsculo é feita pelo `@Transform` no DTO antes da validação.
