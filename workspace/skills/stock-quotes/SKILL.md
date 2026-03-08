---
name: stock-quotes
description: "Get real-time stock quotes, price history, and basic fundamentals."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📈"
    requires:
      env:
        - ALPHA_VANTAGE_API_KEY
---

# Stock Quotes

## When to Use

Use for:
- Current stock price and daily change
- 52-week high/low
- Basic fundamentals (P/E ratio, market cap, volume)
- Price history for a ticker over a date range

Do NOT use for:
- Financial advice or buy/sell recommendations
- Cryptocurrency (use crypto-prices skill)
- Real-time options or futures data

## Disclaimer

EDITH provides data for informational purposes only. This is NOT financial advice.
Always consult a qualified financial advisor before making investment decisions.

## API Reference

Uses Alpha Vantage API.
Base URL: `https://www.alphavantage.co/query`

### Quote Endpoint
```
GET ?function=GLOBAL_QUOTE&symbol=AAPL&apikey=$ALPHA_VANTAGE_API_KEY
```

### Daily History
```
GET ?function=TIME_SERIES_DAILY&symbol=AAPL&outputsize=compact&apikey=...
```

## Output Format

```
📈 AAPL — Apple Inc.
   $192.40  ▲ +1.2% today
   Vol: 52.3M  |  52w: $164.08 – $199.62
   P/E: 31.2  |  Mkt Cap: $2.97T
```

## Example Invocations

- "What's Apple's stock price right now?"
- "Show me TSLA's performance this week."
- "What are NVIDIA's key fundamentals?"
- "Compare MSFT and GOOGL prices today."

## What It Does

1. Resolves company name to ticker symbol if needed
2. Fetches quote from Alpha Vantage
3. Returns formatted price data with daily change
4. Includes basic fundamentals on request
