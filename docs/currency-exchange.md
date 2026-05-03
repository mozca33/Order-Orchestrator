# Módulo: Currency Exchange

Responsável por consultar a cotação da moeda do pedido e calcular o valor convertido.

---

## O que ele faz

Recebe a moeda e o valor total do pedido, consulta a cotação atual na AwesomeAPI e retorna os dados de câmbio para serem salvos no pedido.

---

## API utilizada

**AwesomeAPI** — pública, gratuita e sem necessidade de chave de acesso.

```
https://economia.awesomeapi.com.br/json/last/{PAR}
```

Exemplos de pares consultados:
- Pedido em `USD` → consulta `USD-BRL`
- Pedido em `BRL` → consulta `BRL-USD`
- Pedido em `EUR` → consulta `EUR-BRL`

---

## Resultado retornado

```json
{
  "base_currency": "USD",
  "target_currency": "BRL",
  "exchange_rate": 5.08,
  "converted_total": 608.57,
  "source": "economia.awesomeapi.com.br"
}
```

Este objeto é salvo no campo `exchange_data` do pedido.

---

## Tratamento de erros

Se a API retornar um par de moedas não suportado, o serviço lança um erro que o processador da fila captura para acionar o mecanismo de retry.
