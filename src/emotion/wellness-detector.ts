/**
 * @file wellness-detector.ts
 * @description Detects burnout, overwork, and persistent negative emotional patterns
 *   from a user's rolling MoodProfile history. Triggers proactive wellbeing alerts
 *   via the background daemon.
 *
 * ARCHITECTURE:
 *   - Input: MoodTracker.getProfile() per user
 *   - Output: WellnessSignal (burnout_risk | overwork_pattern | high_stress | persistent_sadness | none)
 *   - Called by daemon.ts in the periodic cycle
 *   - Respects quiet hours before sending any alert
 *
 * PAPER BASIS:
 *   - Maslach Burnout Inventory: Maslach & Jackson 1981 — exhaustion + cynicism indicators
 *   - Temporal emotion dynamics: Brans et al. 2013 — sustained negative affect patterns
 */

import { createLogger } from "../logger.js"
import type { WellnessSignal } from "./emotion-schema.js"
import { moodTracker } from "./mood-tracker.js"

const log = createLogger("emotion.wellness-detector")

/** Valence threshold below which persistent sadness is flagged. */
const SADNESS_VALENCE_THRESHOLD = -0.5

/** Arousal threshold above which high stress is flagged. */
const STRESS_AROUSAL_THRESHOLD = 0.7

/** Number of consecutive negative sessions to flag burnout risk. */
const BURNOUT_CONSECUTIVE_SESSIONS = 3

/** Minimum sample count before wellness checks are meaningful. */
const MIN_SAMPLES_FOR_CHECK = 3

/**
 * WellnessDetector — identifies emotional wellness risk signals from MoodProfile data.
 *
 * Maintains a short history of dominant emotions per user to detect sustained patterns
 * rather than isolated emotional moments.
 */
export class WellnessDetector {
  /** Recent dominant emotions per user (rolling history for pattern detection). */
  private readonly emotionHistory = new Map<string, string[]>()

  /** Maximum history length per user. */
  private static readonly HISTORY_MAX = 10

  /**
   * Analyzes the current MoodProfile for a user and returns a WellnessSignal.
   * Returns signal type "none" if no wellness concern is detected.
   *
   * @param userId - User identifier
   * @returns WellnessSignal with type, confidence, and reason
   */
  async check(userId: string): Promise<WellnessSignal> {
    const profile = moodTracker.getProfile(userId)

    if (!profile || profile.sampleCount < MIN_SAMPLES_FOR_CHECK) {
      return this.makeSignal(userId, "none", 0, "Insufficient data for wellness check")
    }

    // Update history
    this.updateHistory(userId, profile.dominant)
    const history = this.emotionHistory.get(userId) ?? []

    // Check for persistent sadness
    if (profile.dominant === "sadness" && profile.valence < SADNESS_VALENCE_THRESHOLD) {
      const sadnessProportion = history.filter((e) => e === "sadness").length / history.length
      if (sadnessProportion >= 0.6) {
        log.info("wellness signal: persistent sadness detected", { userId, proportion: sadnessProportion })
        return this.makeSignal(
          userId,
          "persistent_sadness",
          sadnessProportion,
          `Persistent sadness detected in ${Math.round(sadnessProportion * 100)}% of recent interactions`,
        )
      }
    }

    // Check for high stress / anxiety
    if (
      (profile.dominant === "fear" || profile.dominant === "anger") &&
      profile.arousal > STRESS_AROUSAL_THRESHOLD
    ) {
      const stressProportion = history.filter((e) => e === "fear" || e === "anger").length / history.length
      if (stressProportion >= 0.5) {
        log.info("wellness signal: high stress pattern", { userId, arousal: profile.arousal })
        return this.makeSignal(
          userId,
          "high_stress",
          stressProportion,
          `High stress pattern detected — frequent fear/anger with high arousal`,
        )
      }
    }

    // Check for burnout risk (sustained negative affect, multiple sessions)
    const negativeEmotions = ["sadness", "anger", "fear", "disgust"]
    const negativeProportion = history.filter((e) => negativeEmotions.includes(e)).length / history.length

    if (history.length >= BURNOUT_CONSECUTIVE_SESSIONS && negativeProportion >= 0.7) {
      log.info("wellness signal: burnout risk", { userId, proportion: negativeProportion })
      return this.makeSignal(
        userId,
        "burnout_risk",
        negativeProportion,
        `Sustained negative affect across ${history.length} recent interactions suggests burnout risk`,
      )
    }

    // Check for overwork pattern (high arousal without matching positive valence)
    if (profile.arousal > STRESS_AROUSAL_THRESHOLD && profile.valence < 0) {
      return this.makeSignal(
        userId,
        "overwork_pattern",
        profile.arousal * 0.8,
        "High activation with negative valence may indicate overwork or excessive pressure",
      )
    }

    return this.makeSignal(userId, "none", 0, "No wellness concern detected")
  }

  /**
   * Updates the rolling emotion history for a user.
   *
   * @param userId - User identifier
   * @param dominant - Dominant emotion to append
   */
  private updateHistory(userId: string, dominant: string): void {
    const history = this.emotionHistory.get(userId) ?? []
    history.push(dominant)

    if (history.length > WellnessDetector.HISTORY_MAX) {
      history.splice(0, history.length - WellnessDetector.HISTORY_MAX)
    }

    this.emotionHistory.set(userId, history)
  }

  /**
   * Constructs a WellnessSignal object.
   *
   * @param userId - User identifier
   * @param signal - Signal type
   * @param confidence - Confidence value (0–1)
   * @param reason - Human-readable reason
   */
  private makeSignal(
    userId: string,
    signal: WellnessSignal["signal"],
    confidence: number,
    reason: string,
  ): WellnessSignal {
    return {
      userId,
      signal,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason,
      detectedAt: new Date(),
    }
  }

  /**
   * Clears emotion history for a user.
   *
   * @param userId - User identifier
   */
  clearHistory(userId: string): void {
    this.emotionHistory.delete(userId)
  }
}

/** Singleton WellnessDetector instance. */
export const wellnessDetector = new WellnessDetector()
