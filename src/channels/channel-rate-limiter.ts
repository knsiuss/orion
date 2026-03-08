/**
 * @file channel-rate-limiter.ts
 * @description Token-bucket rate limiter for per-channel outbound message throttling.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by ChannelManager.send() before invoking each channel's send().
 *   If tryAcquire() returns false, ChannelManager skips that channel for this
 *   cycle and the message falls through to the next channel in the priority list.
 *   The outbox will retry on the next flush tick.
 *
 *   Rate limits are read from config at construction time (lazy per channel):
 *     CHANNEL_RATE_LIMIT_TELEGRAM_PER_S=30   (default: 30)
 *     CHANNEL_RATE_LIMIT_DISCORD_PER_S=5     (default: 5)
 *     CHANNEL_RATE_LIMIT_WHATSAPP_PER_S=10   (default: 10)
 *     CHANNEL_RATE_LIMIT_DEFAULT_PER_S=10    (default: 10, applies to all others)
 *
 *   Token bucket algorithm:
 *     - Each bucket starts full (capacity = rate * burst multiplier).
 *     - On tryAcquire(): refill tokens based on elapsed time, then consume 1.
 *     - Computed lazily — no timer, O(1) per call.
 *
 * @module channels/channel-rate-limiter
 */

import { createLogger } from "../logger.js"
import { edithMetrics } from "../observability/metrics.js"
import config from "../config.js"

const log = createLogger("channels.rate-limiter")

// ─── Types ────────────────────────────────────────────────────────────────────

/** Token bucket state for a single channel. */
interface TokenBucket {
  /** Maximum tokens (= refillRatePerSec * BURST_MULTIPLIER). */
  readonly capacity: number
  /** Tokens added per millisecond. */
  readonly refillRatePerMs: number
  /** Current token count (fractional). */
  tokens: number
  /** Epoch ms of the last refill computation. */
  lastRefillAt: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Burst multiplier: bucket capacity = rate × this.
 * Allows short bursts up to 2× the sustained rate.
 */
const BURST_MULTIPLIER = 2

// ─── ChannelRateLimiter ───────────────────────────────────────────────────────

/**
 * Per-channel token-bucket rate limiter.
 *
 * Usage:
 *   if (!rateLimiter.tryAcquire("telegram")) {
 *     // skip this channel, try next
 *   }
 */
export class ChannelRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()

  /**
   * Attempt to acquire a send token for the given channel.
   * Returns true if the send is allowed; false if the channel is rate-limited.
   *
   * @param channelName - The channel to check (e.g. "telegram", "discord")
   */
  tryAcquire(channelName: string): boolean {
    const bucket = this.getOrCreate(channelName)
    this.refill(bucket)

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    log.debug("channel rate limited", { channelName, tokens: bucket.tokens.toFixed(2) })
    edithMetrics.channelRateLimitedTotal.inc({ channel: channelName })
    return false
  }

  /**
   * Returns the current token count for a channel (for diagnostics).
   * @param channelName - Channel name
   */
  getTokens(channelName: string): number {
    const bucket = this.getOrCreate(channelName)
    this.refill(bucket)
    return bucket.tokens
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Get or create the token bucket for a channel.
   * Rate limits are read from config on first access.
   *
   * @param channelName - Channel identifier
   */
  private getOrCreate(channelName: string): TokenBucket {
    let bucket = this.buckets.get(channelName)
    if (!bucket) {
      const ratePerSec = this.resolveRate(channelName)
      const capacity = ratePerSec * BURST_MULTIPLIER
      bucket = {
        capacity,
        refillRatePerMs: ratePerSec / 1_000,
        tokens: capacity, // start full
        lastRefillAt: Date.now(),
      }
      this.buckets.set(channelName, bucket)
      log.debug("rate limiter bucket created", { channelName, ratePerSec, capacity })
    }
    return bucket
  }

  /**
   * Refill the bucket based on elapsed time since last refill.
   * Caps tokens at capacity.
   *
   * @param bucket - Bucket to refill (mutated in-place)
   */
  private refill(bucket: TokenBucket): void {
    const now = Date.now()
    const elapsed = now - bucket.lastRefillAt
    const added = elapsed * bucket.refillRatePerMs
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + added)
    bucket.lastRefillAt = now
  }

  /**
   * Resolve the configured rate limit (tokens/second) for a channel.
   * Falls back to CHANNEL_RATE_LIMIT_DEFAULT_PER_S if not specified.
   *
   * @param channelName - Channel identifier
   * @returns Tokens per second
   */
  private resolveRate(channelName: string): number {
    const upper = channelName.toUpperCase()
    const key = `CHANNEL_RATE_LIMIT_${upper}_PER_S` as keyof typeof config
    const value = config[key]
    if (typeof value === "number" && value > 0) return value

    const defaultRate = config.CHANNEL_RATE_LIMIT_DEFAULT_PER_S
    return typeof defaultRate === "number" && defaultRate > 0 ? defaultRate : 10
  }
}

/** Singleton rate limiter — shared across ChannelManager. */
export const channelRateLimiter = new ChannelRateLimiter()
