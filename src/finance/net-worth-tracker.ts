/**
 * @file net-worth-tracker.ts
 * @description Aggregates assets and liabilities into a net worth snapshot.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Pulls from expense-tracker, crypto-portfolio, and subscription-audit.
 *   Provides periodic net worth summaries via protocols/evening-summary.
 */
import { createLogger } from "../logger.js"

const log = createLogger("finance.net-worth-tracker")

export interface NetWorthSnapshot {
  userId: string
  assets: number
  liabilities: number
  netWorth: number
  currency: string
  timestamp: Date
}

class NetWorthTracker {
  private snapshots = new Map<string, NetWorthSnapshot[]>()

  record(userId: string, assets: number, liabilities: number, currency = "IDR"): NetWorthSnapshot {
    const snapshot: NetWorthSnapshot = {
      userId,
      assets,
      liabilities,
      netWorth: assets - liabilities,
      currency,
      timestamp: new Date(),
    }

    const history = this.snapshots.get(userId) ?? []
    history.push(snapshot)
    if (history.length > 365) history.shift()
    this.snapshots.set(userId, history)

    log.debug("net worth recorded", { userId, netWorth: snapshot.netWorth })
    return snapshot
  }

  getLatest(userId: string): NetWorthSnapshot | undefined {
    const history = this.snapshots.get(userId) ?? []
    return history.at(-1)
  }

  getHistory(userId: string): NetWorthSnapshot[] {
    return this.snapshots.get(userId) ?? []
  }
}

export const netWorthTracker = new NetWorthTracker()
