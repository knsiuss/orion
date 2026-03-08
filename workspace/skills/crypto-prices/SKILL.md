---
name: crypto-prices
description: "Get real-time cryptocurrency prices, market cap, and 24h changes via CoinGecko."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "₿"
---

# Crypto Prices

## When to Use

Use for:
- Current price of any cryptocurrency
- 24-hour price change and volume
- Market cap rankings
- Multi-coin price comparison

Do NOT use for:
- Financial advice or trading signals
- DeFi protocol interactions
- Wallet management

## Disclaimer

EDITH provides data for informational purposes only. Cryptocurrency is highly volatile.
This is NOT financial advice.

## API Reference

Uses CoinGecko API (no key required for basic tier).
Base URL: `https://api.coingecko.com/api/v3`

### Price
```
GET /simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_market_cap=true
```

### Top Coins by Market Cap
```
GET /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10
```

## Output Format

```
₿ Bitcoin (BTC)
   $68,420  ▲ +3.2% (24h)
   Vol: $32.1B  |  Mkt Cap: $1.34T  |  Rank: #1
```

## Example Invocations

- "What's Bitcoin's price right now?"
- "Show me the top 10 cryptos by market cap."
- "How much is 2.5 ETH worth in USD?"
- "Compare BTC, ETH, and SOL prices."

## What It Does

1. Resolves coin names/symbols to CoinGecko IDs
2. Fetches current price, 24h change, volume, and market cap
3. Returns formatted output with directional indicators
4. Handles multiple coins in a single request
