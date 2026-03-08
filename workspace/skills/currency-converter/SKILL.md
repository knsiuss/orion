---
name: currency-converter
description: "Convert between currencies using live exchange rates."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "💱"
    requires:
      env:
        - EXCHANGERATE_API_KEY
---

# Currency Converter

## When to Use

Use for:
- Converting amounts between any two currencies
- Getting current exchange rates
- Checking rate trends (today vs. last week)
- Multi-currency comparisons

Do NOT use for:
- Cryptocurrency prices (use crypto-prices skill)
- Hedging or financial advice

## API Reference

Uses ExchangeRate-API (or open.er-api.com as fallback).
Base URL: `https://v6.exchangerate-api.com/v6/$EXCHANGERATE_API_KEY`

### Latest Rates
```
GET /latest/{base_currency}
```

### Convert Amount
```
GET /pair/{from}/{to}/{amount}
```

## Output Format

```
💱 1 USD = 15,743 IDR
   100 USD = 1,574,300 IDR
   Rate as of: Mon 09 Mar 2026, 14:32 UTC
```

## Example Invocations

- "Convert 250 USD to IDR."
- "What's the EUR to JPY exchange rate?"
- "How much is 1 BTC in USD?" (→ redirects to crypto-prices skill)
- "Convert 5000 IDR to USD and SGD."

## What It Does

1. Parses the source currency, target currency, and amount
2. Fetches the latest exchange rate
3. Returns the converted amount with rate timestamp
4. Warns if the rate data is more than 24 hours old
