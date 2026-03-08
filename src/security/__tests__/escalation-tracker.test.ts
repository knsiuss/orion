/**
 * @file escalation-tracker.test.ts
 * @description Tests for EscalationTracker — multi-turn risk scoring with
 *   weighted signals, time-based decay, and auto-block/unblock behavior.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests the EscalationTracker class from src/security/escalation-tracker.ts.
 *   Uses fake timers to simulate score decay over time.
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

import { EscalationTracker } from "../escalation-tracker.js"

describe("EscalationTracker", () => {
  let tracker: EscalationTracker

  beforeEach(() => {
    vi.useFakeTimers()
    tracker = new EscalationTracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns score 0 for unknown users", () => {
    expect(tracker.getScore("unknown-user")).toBe(0)
  })

  it("returns allowed=true and score=0 for new users", () => {
    const result = tracker.check("new-user")
    expect(result.allowed).toBe(true)
    expect(result.score).toBe(0)
    expect(result.blocked).toBe(false)
  })

  it("is not blocked for unknown users", () => {
    expect(tracker.isBlocked("unknown-user")).toBe(false)
  })

  describe("signal recording", () => {
    it("increases score with injection signal (weight 3)", () => {
      tracker.record("user1", "injection")
      expect(tracker.getScore("user1")).toBe(3)
    })

    it("increases score with jailbreak signal (weight 5)", () => {
      tracker.record("user1", "jailbreak")
      expect(tracker.getScore("user1")).toBe(5)
    })

    it("increases score with abuse signal (weight 2)", () => {
      tracker.record("user1", "abuse")
      expect(tracker.getScore("user1")).toBe(2)
    })

    it("increases score with rate signal (weight 1)", () => {
      tracker.record("user1", "rate")
      expect(tracker.getScore("user1")).toBe(1)
    })

    it("increases score with suspicious signal (weight 1)", () => {
      tracker.record("user1", "suspicious")
      expect(tracker.getScore("user1")).toBe(1)
    })

    it("accumulates multiple signals", () => {
      tracker.record("user1", "injection") // +3
      tracker.record("user1", "abuse") // +2
      tracker.record("user1", "rate") // +1
      expect(tracker.getScore("user1")).toBe(6)
    })
  })

  describe("auto-blocking", () => {
    it("auto-blocks when score reaches threshold (10)", () => {
      // jailbreak(5) + jailbreak(5) = 10 => blocked
      tracker.record("user1", "jailbreak")
      expect(tracker.isBlocked("user1")).toBe(false)

      tracker.record("user1", "jailbreak")
      expect(tracker.isBlocked("user1")).toBe(true)
    })

    it("check() returns allowed=false for blocked user", () => {
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5 => 10
      const result = tracker.check("user1")
      expect(result.allowed).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.score).toBe(10)
    })

    it("blocks via accumulated smaller signals", () => {
      // 4 x injection(3) = 12 => blocked
      for (let i = 0; i < 4; i++) {
        tracker.record("user1", "injection")
      }
      expect(tracker.isBlocked("user1")).toBe(true)
      expect(tracker.getScore("user1")).toBe(12)
    })
  })

  describe("score decay", () => {
    it("decays score by 1 per 5-minute interval", () => {
      tracker.record("user1", "injection") // score = 3

      // Advance 5 minutes (1 decay interval)
      vi.advanceTimersByTime(5 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(2)
    })

    it("decays multiple intervals at once", () => {
      tracker.record("user1", "injection") // score = 3

      // Advance 15 minutes (3 intervals => -3 points)
      vi.advanceTimersByTime(15 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(0)
    })

    it("does not decay below 0", () => {
      tracker.record("user1", "rate") // score = 1

      // Advance 30 minutes (6 intervals => -6 but clamped to 0)
      vi.advanceTimersByTime(30 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(0)
    })

    it("does not decay if less than one interval has passed", () => {
      tracker.record("user1", "injection") // score = 3

      // Advance 4 minutes (< 5 minute interval)
      vi.advanceTimersByTime(4 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(3)
    })
  })

  describe("auto-unblocking after decay", () => {
    it("auto-unblocks when score decays to unblock threshold (3)", () => {
      // Score = 10 => blocked
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5 => 10
      expect(tracker.isBlocked("user1")).toBe(true)

      // Advance 35 minutes (7 intervals => -7 points, score = 3)
      vi.advanceTimersByTime(35 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(3)
      expect(tracker.isBlocked("user1")).toBe(false)
    })

    it("auto-unblocks via check() after sufficient decay", () => {
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5 => 10
      expect(tracker.check("user1").blocked).toBe(true)

      // Advance 40 minutes (8 intervals => -8, score = 2)
      vi.advanceTimersByTime(40 * 60 * 1000)

      const result = tracker.check("user1")
      expect(result.allowed).toBe(true)
      expect(result.blocked).toBe(false)
      expect(result.score).toBe(2)
    })

    it("stays blocked if score still above unblock threshold after decay", () => {
      // Score = 15
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5 => 15
      expect(tracker.isBlocked("user1")).toBe(true)

      // Advance 35 minutes (7 intervals => -7, score = 8 > 3)
      vi.advanceTimersByTime(35 * 60 * 1000)

      expect(tracker.getScore("user1")).toBe(8)
      expect(tracker.isBlocked("user1")).toBe(true)
    })
  })

  describe("manual unblock", () => {
    it("resets score and unblocks the user", () => {
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user1", "jailbreak") // +5 => 10
      expect(tracker.isBlocked("user1")).toBe(true)

      tracker.manualUnblock("user1")
      expect(tracker.isBlocked("user1")).toBe(false)
      expect(tracker.getScore("user1")).toBe(0)
    })

    it("is a no-op for unknown users", () => {
      // Should not throw
      tracker.manualUnblock("nonexistent")
      expect(tracker.getScore("nonexistent")).toBe(0)
    })
  })

  describe("user isolation", () => {
    it("tracks users independently", () => {
      tracker.record("user1", "jailbreak") // +5
      tracker.record("user2", "rate") // +1

      expect(tracker.getScore("user1")).toBe(5)
      expect(tracker.getScore("user2")).toBe(1)
      expect(tracker.isBlocked("user1")).toBe(false)
      expect(tracker.isBlocked("user2")).toBe(false)
    })
  })
})
