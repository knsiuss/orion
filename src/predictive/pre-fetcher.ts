/**
 * @file pre-fetcher.ts
 * @description Pre-fetches relevant data based on predicted user intent.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Intent hint → triggers specific pre-load strategy:
 *     weather/*  → warm weatherMonitor cache
 *     market/*   → warm marketMonitor cache (bitcoin, ethereum)
 *     crypto/*   → warm marketMonitor cache
 *     memory:X   → pre-load memory context for topic X
 *     news/*     → future: warm news curator
 *   All results TTL-cached (5min) to avoid redundant fetches.
 *   Non-blocking: prefetch() is fire-and-forget by design.
 */
import { createLogger } from '../logger.js'
import { weatherMonitor } from '../ambient/weather-monitor.js'
import { marketMonitor } from '../ambient/market-monitor.js'
import { memory } from '../memory/store.js'

const log = createLogger('predictive.pre-fetcher')

/** TTL for pre-fetched entries. */
const PREFETCH_TTL_MS = 5 * 60 * 1000

/** A cached pre-fetch result. */
interface PrefetchEntry {
  result: string
  fetchedAt: number
}

class PreFetcher {
  private cache = new Map<string, PrefetchEntry>()

  /**
   * Pre-fetch data based on a hint string.
   * Non-blocking — errors logged and ignored.
   * @param userId - User to pre-fetch for
   * @param hint - Hint describing what data to pre-fetch (e.g. 'weather', 'market', 'memory:topic')
   */
  prefetch(userId: string, hint: string): void {
    if (!hint) return
    const key = `${userId}:${hint}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.fetchedAt < PREFETCH_TTL_MS) return

    void this.load(userId, hint, key).catch((err) =>
      log.warn('pre-fetch failed', { userId, hint, err }),
    )
  }

  /**
   * Get pre-fetched data if available and fresh.
   * @param userId - User to look up
   * @param hint - Hint key to retrieve
   * @returns Pre-fetched data string or null if not available/expired
   */
  get(userId: string, hint: string): string | null {
    const key = `${userId}:${hint}`
    const entry = this.cache.get(key)
    if (!entry || Date.now() - entry.fetchedAt > PREFETCH_TTL_MS) return null
    return entry.result
  }

  /** Load data from the appropriate source based on the hint. */
  private async load(userId: string, hint: string, key: string): Promise<void> {
    let result = ''

    if (hint.startsWith('weather')) {
      const w = await weatherMonitor.getCurrent()
      result = w
        ? `${w.description}, ${w.temp}°C, feels ${w.feelsLike}°C, rain: ${w.rainChance}%`
        : 'weather unavailable'
    } else if (
      hint.startsWith('market') ||
      hint.startsWith('crypto') ||
      hint.startsWith('bitcoin') ||
      hint.startsWith('ethereum')
    ) {
      result = await marketMonitor.getSummary(['bitcoin', 'ethereum'])
    } else if (hint.startsWith('memory:')) {
      const topic = hint.slice(7)
      const ctx = await memory.buildContext(userId, topic)
      result = ctx.systemContext ?? ''
    } else {
      // Generic: build memory context from hint as query
      const ctx = await memory.buildContext(userId, hint)
      result = ctx.systemContext ?? ''
    }

    this.cache.set(key, { result, fetchedAt: Date.now() })
    log.debug('pre-fetch complete', { userId, hint, resultLen: result.length })
  }

  /** Remove all expired pre-fetch entries from cache. */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.fetchedAt > PREFETCH_TTL_MS) this.cache.delete(key)
    }
  }
}

/** Singleton pre-fetcher. */
export const preFetcher = new PreFetcher()
