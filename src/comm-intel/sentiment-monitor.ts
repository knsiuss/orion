/**
 * @file sentiment-monitor.ts
 * @description Monitors communication sentiment trends over time.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Complements emotion/text-sentiment.ts by tracking per-contact sentiment
 *   patterns across conversations. Used by protocols to flag deteriorating
 *   relationships or unusually negative communication threads.
 */
import { createLogger } from "../logger.js"

const log = createLogger("comm-intel.sentiment-monitor")

export interface SentimentEntry {
  contactId: string
  sentiment: number
  timestamp: Date
}

class SentimentMonitor {
  private history = new Map<string, SentimentEntry[]>()

  record(userId: string, contactId: string, sentiment: number): void {
    const key = `${userId}:${contactId}`
    const entries = this.history.get(key) ?? []
    entries.push({ contactId, sentiment, timestamp: new Date() })

    // Keep last 100 entries per contact
    if (entries.length > 100) entries.shift()
    this.history.set(key, entries)
    log.debug("sentiment recorded", { userId, contactId, sentiment })
  }

  getTrend(userId: string, contactId: string): number {
    const key = `${userId}:${contactId}`
    const entries = this.history.get(key) ?? []
    if (entries.length < 2) return 0

    const recent = entries.slice(-5)
    const avg = recent.reduce((sum, e) => sum + e.sentiment, 0) / recent.length
    return avg
  }
}

export const sentimentMonitor = new SentimentMonitor()
