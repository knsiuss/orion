/**
 * @file channel-rate-limiter.test.ts
 * @description Unit tests for the per-channel token-bucket rate limiter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    CHANNEL_RATE_LIMIT_TELEGRAM_PER_S: 30,
    CHANNEL_RATE_LIMIT_DISCORD_PER_S: 5,
    CHANNEL_RATE_LIMIT_DEFAULT_PER_S: 10,
  },
}))

vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: {
    channelRateLimitedTotal: { inc: vi.fn() },
  },
}))

import { ChannelRateLimiter } from "../channel-rate-limiter.js"

describe("ChannelRateLimiter", () => {
  let limiter: ChannelRateLimiter

  beforeEach(() => {
    limiter = new ChannelRateLimiter()
  })

  it("allows first acquire (bucket starts full)", () => {
    expect(limiter.tryAcquire("telegram")).toBe(true)
  })

  it("allows burst up to capacity then blocks", () => {
    // telegram rate = 30/s, capacity = 30 * 2 = 60 tokens
    let allowed = 0
    for (let i = 0; i < 100; i++) {
      if (limiter.tryAcquire("telegram")) allowed++
    }
    expect(allowed).toBe(60) // exactly capacity
  })

  it("separate channels have independent buckets", () => {
    // Drain discord (capacity = 5 * 2 = 10)
    for (let i = 0; i < 10; i++) limiter.tryAcquire("discord")
    expect(limiter.tryAcquire("discord")).toBe(false)

    // Telegram should be unaffected
    expect(limiter.tryAcquire("telegram")).toBe(true)
  })

  it("uses default rate for unknown channels", () => {
    // default = 10/s, capacity = 20
    let allowed = 0
    for (let i = 0; i < 30; i++) {
      if (limiter.tryAcquire("matrix")) allowed++
    }
    expect(allowed).toBe(20)
  })

  it("getTokens returns remaining tokens", () => {
    limiter.tryAcquire("telegram") // consume 1
    const tokens = limiter.getTokens("telegram")
    // Started with 60, consumed 1 → ~59 (allow small floating point drift)
    expect(tokens).toBeGreaterThanOrEqual(58)
    expect(tokens).toBeLessThan(60)
  })

  it("refills over time", async () => {
    // Drain discord fully (capacity 10)
    for (let i = 0; i < 10; i++) limiter.tryAcquire("discord")
    expect(limiter.tryAcquire("discord")).toBe(false)

    // Wait 1 second — discord refills at 5/s → ~5 new tokens
    await new Promise((r) => setTimeout(r, 1_050))
    expect(limiter.tryAcquire("discord")).toBe(true)
  })
})
