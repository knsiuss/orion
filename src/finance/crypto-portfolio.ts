/**
 * @file crypto-portfolio.ts
 * @description Track crypto holdings and portfolio value.
 *
 * ARCHITECTURE / INTEGRATION:
 *   In-memory portfolio with real-time prices from CoinGecko (free, no API key).
 *   Supports P&L calculation if purchase price is tracked.
 */
import { createLogger } from '../logger.js'

const log = createLogger('finance.crypto')

/** A crypto holding entry. */
export interface CryptoHolding {
  symbol: string
  coinId: string
  amount: number
  purchasePrice?: number
}

/** Portfolio value snapshot at a point in time. */
export interface PortfolioSnapshot {
  holdings: Array<{
    symbol: string
    amount: number
    currentPrice: number
    value: number
    pnl?: number
  }>
  totalValueUsd: number
  calculatedAt: Date
}

/** CoinGecko price response. */
type CoinGeckoResponse = Record<string, { usd: number }>

class CryptoPortfolio {
  private holdings = new Map<string, CryptoHolding>()

  /**
   * Add or update a holding.
   * @param holding - Holding details including coin ID and amount
   */
  setHolding(holding: CryptoHolding): void {
    this.holdings.set(holding.symbol, holding)
    log.debug('holding updated', { symbol: holding.symbol, amount: holding.amount })
  }

  /**
   * Get portfolio snapshot with current prices from CoinGecko.
   * @returns Snapshot with per-holding values and total
   */
  async getSnapshot(): Promise<PortfolioSnapshot> {
    const holdings = [...this.holdings.values()]
    if (holdings.length === 0) {
      return { holdings: [], totalValueUsd: 0, calculatedAt: new Date() }
    }

    const coinIds = holdings.map(h => h.coinId).join(',')
    let prices: CoinGeckoResponse = {}

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(10_000) },
      )
      if (res.ok) {
        prices = await res.json() as CoinGeckoResponse
      }
    } catch (err) {
      log.warn('price fetch failed', { err })
    }

    const snapshotHoldings = holdings.map(h => {
      const currentPrice = prices[h.coinId]?.usd ?? 0
      const value = h.amount * currentPrice
      const pnl = h.purchasePrice !== undefined
        ? value - h.amount * h.purchasePrice
        : undefined
      return { symbol: h.symbol, amount: h.amount, currentPrice, value, pnl }
    })

    return {
      holdings: snapshotHoldings,
      totalValueUsd: snapshotHoldings.reduce((sum, h) => sum + h.value, 0),
      calculatedAt: new Date(),
    }
  }
}

/** Singleton crypto portfolio tracker. */
export const cryptoPortfolio = new CryptoPortfolio()
