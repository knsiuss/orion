/**
 * @file circuit-breaker.test.ts
 * @description Tests for ChannelCircuitBreaker — state transitions (closed,
 *   open, half-open), failure counting, cooldown, and manual reset.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests the ChannelCircuitBreaker class from src/channels/circuit-breaker.ts.
 *   Uses fake timers for cooldown testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { ChannelCircuitBreaker } from "../../channels/circuit-breaker.js"

describe("ChannelCircuitBreaker", () => {
  let breaker: ChannelCircuitBreaker

  beforeEach(() => {
    vi.useFakeTimers()
    breaker = new ChannelCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts in closed state", () => {
    expect(breaker.getState("telegram")).toBe("closed")
  })

  it("passes through successful calls", async () => {
    const result = await breaker.execute("telegram", async () => "hello")
    expect(result).toBe("hello")
    expect(breaker.getState("telegram")).toBe("closed")
  })

  it("stays closed after fewer failures than the threshold", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // 2 failures (threshold is 3)
    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")
    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")

    expect(breaker.getState("telegram")).toBe("closed")
  })

  it("opens after 3 consecutive failures (default threshold)", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")
    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")
    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")

    expect(breaker.getState("telegram")).toBe("open")
  })

  it("rejects calls when circuit is open", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }
    expect(breaker.getState("telegram")).toBe("open")

    // Subsequent calls should be rejected immediately with circuit open message
    await expect(
      breaker.execute("telegram", async () => "should not run")
    ).rejects.toThrow(/Circuit open/)
  })

  it("transitions to half-open after cooldown", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }
    expect(breaker.getState("telegram")).toBe("open")

    // Advance past the 60s cooldown
    vi.advanceTimersByTime(60_001)

    // The next execute should transition to half-open and run the fn
    // We use a successful call to verify half-open -> closed transition
    const result = await breaker.execute("telegram", async () => "probe-ok")
    expect(result).toBe("probe-ok")
    // After success in half-open, it should be closed
    expect(breaker.getState("telegram")).toBe("closed")
  })

  it("closes after successful half-open probe", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }

    // Advance past cooldown
    vi.advanceTimersByTime(60_001)

    // Successful probe
    await breaker.execute("telegram", async () => "ok")
    expect(breaker.getState("telegram")).toBe("closed")

    // Confirm normal operation resumes
    const result = await breaker.execute("telegram", async () => "normal")
    expect(result).toBe("normal")
  })

  it("re-opens if half-open probe fails", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }

    // Advance past cooldown
    vi.advanceTimersByTime(60_001)

    // Failed probe (half-open -> open again)
    await expect(breaker.execute("telegram", fail)).rejects.toThrow("fail")
    expect(breaker.getState("telegram")).toBe("open")
  })

  it("manual reset returns to closed state", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }
    expect(breaker.getState("telegram")).toBe("open")

    // Manual reset
    breaker.reset("telegram")
    expect(breaker.getState("telegram")).toBe("closed")

    // Confirm normal operation resumes
    const result = await breaker.execute("telegram", async () => "reset-ok")
    expect(result).toBe("reset-ok")
  })

  it("tracks channels independently", async () => {
    const fail = () => Promise.reject(new Error("fail"))

    // Trip telegram
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute("telegram", fail)).rejects.toThrow()
    }

    expect(breaker.getState("telegram")).toBe("open")
    expect(breaker.getState("discord")).toBe("closed")

    // Discord should still work
    const result = await breaker.execute("discord", async () => "ok")
    expect(result).toBe("ok")
  })
})
