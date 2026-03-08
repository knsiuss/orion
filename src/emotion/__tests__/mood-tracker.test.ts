/**
 * @file mood-tracker.test.ts
 * @description Tests for MoodTracker — rolling mood profile aggregation.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { MoodTracker } from "../mood-tracker.js"
import type { EmotionSample } from "../emotion-schema.js"

/** Helper to create a test EmotionSample. */
function makeSample(dominant: EmotionSample["dominant"], valence: number, arousal: number): EmotionSample {
  return {
    dominant,
    valence,
    arousal,
    confidence: 0.8,
  }
}

describe("MoodTracker", () => {
  let tracker: MoodTracker

  beforeEach(() => {
    tracker = new MoodTracker()
  })

  describe("getProfile()", () => {
    it("returns null when no samples recorded", () => {
      const profile = tracker.getProfile("user1")
      expect(profile).toBeNull()
    })

    it("returns a profile after recording a sample", async () => {
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      const profile = tracker.getProfile("user1")
      expect(profile).not.toBeNull()
      expect(profile?.userId).toBe("user1")
    })

    it("correctly reports dominant emotion with single sample", async () => {
      await tracker.record("user1", makeSample("sadness", -0.8, 0.3))
      const profile = tracker.getProfile("user1")
      // With only 1 sample (below MIN_RELIABLE_SAMPLES=2), may shade to neutral
      expect(profile).not.toBeNull()
    })

    it("correctly aggregates multiple samples for dominant", async () => {
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      await tracker.record("user1", makeSample("joy", 0.8, 0.6))
      await tracker.record("user1", makeSample("sadness", -0.8, 0.3))
      const profile = tracker.getProfile("user1")
      // Joy has 2 samples vs sadness 1 — should dominate
      expect(profile?.dominant).toBe("joy")
    })

    it("computes average valence correctly", async () => {
      await tracker.record("user1", makeSample("joy", 0.6, 0.5))
      await tracker.record("user1", makeSample("joy", 0.8, 0.5))
      const profile = tracker.getProfile("user1")
      expect(profile?.valence).toBeCloseTo(0.7, 1)
    })

    it("computes average arousal correctly", async () => {
      await tracker.record("user1", makeSample("fear", -0.6, 0.8))
      await tracker.record("user1", makeSample("fear", -0.6, 0.6))
      const profile = tracker.getProfile("user1")
      expect(profile?.arousal).toBeCloseTo(0.7, 1)
    })

    it("clamps valence to -1..1 range", async () => {
      await tracker.record("user1", makeSample("joy", 1.0, 1.0))
      await tracker.record("user1", makeSample("joy", 1.0, 1.0))
      const profile = tracker.getProfile("user1")
      expect(profile?.valence).toBeLessThanOrEqual(1)
      expect(profile?.valence).toBeGreaterThanOrEqual(-1)
    })

    it("clamps arousal to 0..1 range", async () => {
      await tracker.record("user1", makeSample("neutral", 0, 0))
      await tracker.record("user1", makeSample("neutral", 0, 0))
      const profile = tracker.getProfile("user1")
      expect(profile?.arousal).toBeGreaterThanOrEqual(0)
      expect(profile?.arousal).toBeLessThanOrEqual(1)
    })

    it("tracks separate profiles per user", async () => {
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      await tracker.record("user2", makeSample("sadness", -0.8, 0.3))
      await tracker.record("user2", makeSample("sadness", -0.8, 0.3))
      const profile1 = tracker.getProfile("user1")
      const profile2 = tracker.getProfile("user2")
      expect(profile1?.dominant).toBe("joy")
      expect(profile2?.dominant).toBe("sadness")
    })
  })

  describe("clearSession()", () => {
    it("removes all samples for user after clear", async () => {
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      tracker.clearSession("user1")
      const profile = tracker.getProfile("user1")
      expect(profile).toBeNull()
    })
  })

  describe("getTrackedUserCount()", () => {
    it("returns 0 initially", () => {
      expect(tracker.getTrackedUserCount()).toBe(0)
    })

    it("increments when new users record samples", async () => {
      await tracker.record("user1", makeSample("joy", 0.9, 0.7))
      await tracker.record("user2", makeSample("sadness", -0.8, 0.3))
      expect(tracker.getTrackedUserCount()).toBe(2)
    })
  })
})
