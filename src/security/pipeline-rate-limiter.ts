/**
 * @file pipeline-rate-limiter.ts
 * @description Pipeline-level token-bucket rate limiter applied at the
 *   processMessage() entry point, independent of any per-channel limiter.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Instantiated as a singleton (`pipelineRateLimiter`) and imported by
 *     src/core/message-pipeline.ts as the Stage 0 guard.
 *   - Works independently from src/channels/circuit-breaker.ts and any
 *     channel-level rate limiting.
 *   - Limit is configurable via config.PIPELINE_RATE_LIMIT_PER_MIN.
 *   - Stale per-user buckets are evicted every 10 minutes to bound memory use.
 *
 * PAPER BASIS:
 *   Token-bucket algorithm — standard leaky/token-bucket as described in
 *   RFC 2697 (Single Token Bucket) — each user gets `maxPerMin` tokens
 *   refilled continuously at rate = maxPerMin tokens / 60 seconds.
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("security.pipeline-rate-limiter")

/** Evict inactive buckets after this many milliseconds (10 minutes). */
const EVICTION_IDLE_MS = 10 * 60 * 1000

/** Run the eviction sweep at this interval. */
const EVICTION_INTERVAL_MS = 10 * 60 * 1000

/** Per-user token-bucket state. */
interface Bucket {
  /** Current token count (floating point for continuous refill). */
  tokens: number
  /** Timestamp of the last refill calculation. */
  lastRefillAt: number
  /** Timestamp of the last `check()` call for this user. */
  lastAccessAt: number
}

/**
 * Token-bucket rate limiter scoped to the message pipeline.
 *
 * Each user starts with a full bucket (`maxPerMin` tokens). Tokens refill
 * continuously at `maxPerMin / 60` per second. One token is consumed per
 * message. When the bucket is empty the request is rejected.
 */
export class PipelineRateLimiter {
  private buckets = new Map<string, Bucket>()
  private readonly evictionTimer: ReturnType<typeof setInterval>

  constructor() {
    // Periodically evict idle buckets so memory does not grow unbounded in
    // long-running server deployments.
    this.evictionTimer = setInterval(() => {
      this.evictStaleBuckets()
    }, EVICTION_INTERVAL_MS)

    // Allow Node.js to exit even if the interval is still active.
    if (this.evictionTimer.unref) {
      this.evictionTimer.unref()
    }
  }

  /**
   * Check whether `userId` is allowed to send a message right now.
   * Consumes one token if allowed.
   *
   * @param userId - The authenticated user identifier
   * @returns `true` if the request is within the rate limit, `false` otherwise
   */
  check(userId: string): boolean {
    const maxPerMin = config.PIPELINE_RATE_LIMIT_PER_MIN
    const refillRatePerMs = maxPerMin / 60_000

    const now = Date.now()
    let bucket = this.buckets.get(userId)

    if (!bucket) {
      bucket = { tokens: maxPerMin, lastRefillAt: now, lastAccessAt: now }
      this.buckets.set(userId, bucket)
    }

    // Refill tokens based on elapsed time since last refill.
    const elapsed = now - bucket.lastRefillAt
    bucket.tokens = Math.min(maxPerMin, bucket.tokens + elapsed * refillRatePerMs)
    bucket.lastRefillAt = now
    bucket.lastAccessAt = now

    if (bucket.tokens < 1) {
      log.warn("pipeline rate limit exceeded", { userId, tokens: bucket.tokens, maxPerMin })
      return false
    }

    bucket.tokens -= 1
    return true
  }

  /**
   * Remove buckets that have been idle for longer than `EVICTION_IDLE_MS`.
   * Called on a timer; should not be called externally in normal use.
   */
  private evictStaleBuckets(): void {
    const now = Date.now()
    let evicted = 0

    for (const [userId, bucket] of this.buckets) {
      if (now - bucket.lastAccessAt > EVICTION_IDLE_MS) {
        this.buckets.delete(userId)
        evicted++
      }
    }

    if (evicted > 0) {
      log.debug("evicted stale pipeline rate-limit buckets", { evicted })
    }
  }

  /**
   * Stop the background eviction timer.
   * Call this during graceful shutdown to allow the process to exit cleanly.
   */
  destroy(): void {
    clearInterval(this.evictionTimer)
  }
}

/** Singleton pipeline rate limiter — imported by message-pipeline.ts. */
export const pipelineRateLimiter = new PipelineRateLimiter()
