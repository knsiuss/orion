/**
 * @file mood-tracker.ts
 * @description Maintains rolling mood profiles per user by aggregating EmotionSample
 *   observations over a sliding time window.
 *
 * ARCHITECTURE:
 *   - Receives EmotionSample from text-sentiment.ts on each user message
 *   - Maintains in-memory MoodProfile per user (optional Prisma persistence via EmotionSession)
 *   - Provides getProfile() for StyleModifier and PersonalityEngine
 *   - Window: configurable session window (default 30 min, max 20 samples)
 *
 * PAPER BASIS:
 *   - Circumplex Model: Russell 1980 — running average valence/arousal
 *   - Temporal affective states: Kuppens et al. 2010 — emotion autocorrelation within session
 */

import { createLogger } from "../logger.js"
import type { EmotionSample, MoodProfile, EmotionLabel } from "./emotion-schema.js"
import { EMOTION_LABELS } from "./emotion-schema.js"

const log = createLogger("emotion.mood-tracker")

/** Maximum samples kept per user in the rolling window. */
const MAX_SAMPLES = 20

/** Session expiry: samples older than this are dropped (milliseconds). */
const SESSION_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

/** Minimum samples required to consider the mood profile reliable. */
const MIN_RELIABLE_SAMPLES = 2

interface SampleEntry {
  sample: EmotionSample
  timestamp: number
}

interface UserMoodState {
  samples: SampleEntry[]
  sessionStart: Date
  lastUpdatedAt: Date
}

/**
 * MoodTracker — aggregates EmotionSample observations into a rolling MoodProfile per user.
 *
 * Thread-safe for single-process use (Node.js event loop).
 * In-memory only; persists to Prisma EmotionSession on session close (if enabled).
 */
export class MoodTracker {
  /** Per-user rolling sample windows. */
  private readonly userStates = new Map<string, UserMoodState>()

  /**
   * Records an emotion sample for a user and updates their rolling mood profile.
   *
   * @param _userId - User identifier (unused if only in-memory tracking)
   * @param sample - EmotionSample from text-sentiment.ts
   */
  async record(_userId: string, sample: EmotionSample): Promise<void> {
    const userId = _userId
    const now = Date.now()

    let state = this.userStates.get(userId)

    if (!state) {
      state = {
        samples: [],
        sessionStart: new Date(now),
        lastUpdatedAt: new Date(now),
      }
      this.userStates.set(userId, state)
    }

    // Evict samples outside the session window
    state.samples = state.samples.filter(
      (entry) => now - entry.timestamp <= SESSION_WINDOW_MS,
    )

    // Add new sample
    state.samples.push({ sample, timestamp: now })

    // Enforce max samples (drop oldest if needed)
    if (state.samples.length > MAX_SAMPLES) {
      state.samples.splice(0, state.samples.length - MAX_SAMPLES)
    }

    state.lastUpdatedAt = new Date(now)

    log.debug("emotion sample recorded", {
      userId,
      dominant: sample.dominant,
      valence: sample.valence,
      sampleCount: state.samples.length,
    })
  }

  /**
   * Returns the current aggregated MoodProfile for a user.
   * Returns null if no samples have been recorded yet.
   *
   * @param userId - User identifier
   * @returns MoodProfile or null
   */
  getProfile(userId: string): MoodProfile | null {
    const state = this.userStates.get(userId)
    if (!state || state.samples.length === 0) {
      return null
    }

    const now = Date.now()

    // Evict stale samples on read too
    const activeSamples = state.samples.filter(
      (entry) => now - entry.timestamp <= SESSION_WINDOW_MS,
    )

    if (activeSamples.length === 0) {
      return null
    }

    // Compute running averages
    let totalValence = 0
    let totalArousal = 0

    for (const { sample } of activeSamples) {
      totalValence += sample.valence
      totalArousal += sample.arousal
    }

    const avgValence = totalValence / activeSamples.length
    const avgArousal = totalArousal / activeSamples.length

    // Find dominant emotion by majority vote weighted by confidence
    const labelScores = Object.fromEntries(EMOTION_LABELS.map((l) => [l, 0])) as Record<EmotionLabel, number>

    for (const { sample } of activeSamples) {
      labelScores[sample.dominant] += sample.confidence
    }

    let dominant: EmotionLabel = "neutral"
    let maxScore = 0
    for (const label of EMOTION_LABELS) {
      if (labelScores[label] > maxScore) {
        maxScore = labelScores[label]
        dominant = label
      }
    }

    // If not enough reliable samples, shade toward neutral
    const effectiveDominant: EmotionLabel =
      activeSamples.length >= MIN_RELIABLE_SAMPLES ? dominant : "neutral"

    return {
      userId,
      dominant: effectiveDominant,
      valence: Math.max(-1, Math.min(1, avgValence)),
      arousal: Math.max(0, Math.min(1, avgArousal)),
      sampleCount: activeSamples.length,
      sessionStart: state.sessionStart,
      lastUpdatedAt: state.lastUpdatedAt,
    }
  }

  /**
   * Clears all samples for a user (e.g., on session end or explicit reset).
   *
   * @param userId - User identifier
   */
  clearSession(userId: string): void {
    this.userStates.delete(userId)
    log.debug("mood session cleared", { userId })
  }

  /**
   * Returns number of active tracked users.
   * Useful for diagnostics and testing.
   */
  getTrackedUserCount(): number {
    return this.userStates.size
  }
}

/** Singleton MoodTracker instance. */
export const moodTracker = new MoodTracker()
