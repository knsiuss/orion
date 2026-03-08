/**
 * @file style-modifier.ts
 * @description Converts a MoodProfile into a concrete system-prompt style directive
 *   that adjusts EDITH's response tone to match the user's detected emotional state.
 *
 * ARCHITECTURE:
 *   - Input: MoodProfile from mood-tracker.ts
 *   - Output: Style directive string injected into system-prompt-builder.ts
 *   - Maps dominant emotion + valence/arousal to tone adjustments
 *
 * PAPER BASIS:
 *   - Affective Computing: Picard 1997 — emotion-aware interaction design
 *   - Circumplex Model: Russell 1980 — valence × arousal maps to communication style
 */

import { createLogger } from "../logger.js"
import type { MoodProfile, EmotionLabel } from "./emotion-schema.js"

const log = createLogger("emotion.style-modifier")

/** Style directive mapped per dominant emotion label. */
const EMOTION_DIRECTIVES: Record<EmotionLabel, string> = {
  joy: "The user is in a positive, upbeat mood. Match their energy with warmth and enthusiasm. Feel free to be playful.",
  sadness: "The user seems sad or low. Be gentle, empathetic, and supportive. Avoid overly cheerful or dismissive responses. Offer comfort.",
  anger: "The user seems frustrated or angry. Stay calm, de-escalating, and acknowledge their frustration first before solving the problem.",
  fear: "The user seems anxious or stressed. Be reassuring, clear, and grounding. Break complex things into small, manageable steps.",
  surprise: "The user seems surprised. Acknowledge the unexpected situation directly and provide clear, stabilizing information.",
  disgust: "The user seems uncomfortable or repulsed by something. Validate their reaction and address concerns directly without over-explaining.",
  neutral: "The user is in a neutral state. Maintain your default balanced tone.",
  love: "The user is feeling warm and affectionate. Match their warmth with genuine care and attentiveness.",
}

/**
 * Threshold below which valence is considered negative (for extra-low states).
 */
const VERY_LOW_VALENCE_THRESHOLD = -0.6

/**
 * Threshold above which arousal is considered high (for high-stress states).
 */
const HIGH_AROUSAL_THRESHOLD = 0.75

/**
 * StyleModifier — maps MoodProfile to adaptive response style directives.
 *
 * Produces human-readable instructions injected into the system prompt
 * to guide EDITH's tone for the current user emotional state.
 */
export class StyleModifier {
  /**
   * Returns a style directive string based on the user's current MoodProfile.
   * Adds additional modifiers for extreme valence or arousal states.
   *
   * @param profile - Current MoodProfile for the user
   * @returns Style directive string for system prompt injection
   */
  getDirective(profile: MoodProfile): string {
    const base = EMOTION_DIRECTIVES[profile.dominant]

    const modifiers: string[] = [base]

    // Extra modifier for very negative valence (regardless of dominant label)
    if (profile.valence < VERY_LOW_VALENCE_THRESHOLD) {
      modifiers.push("Prioritize emotional acknowledgment before any task assistance.")
    }

    // Extra modifier for high arousal (activated/stressed state)
    if (profile.arousal > HIGH_AROUSAL_THRESHOLD) {
      modifiers.push("Keep responses concise — brevity is kinder when someone is overwhelmed.")
    }

    const directive = modifiers.join(" ")

    log.debug("style directive generated", {
      userId: profile.userId,
      dominant: profile.dominant,
      valence: profile.valence,
      arousal: profile.arousal,
    })

    return directive
  }

  /**
   * Returns a short human-readable label for the mood state.
   * Useful for debug logging and UI display.
   *
   * @param profile - Current MoodProfile
   * @returns Label like "joyful (high energy)" or "sad (very negative)"
   */
  describeState(profile: MoodProfile): string {
    const arousalLabel = profile.arousal > 0.6 ? "high energy" : profile.arousal < 0.3 ? "calm" : "moderate energy"
    const valenceLabel = profile.valence > 0.5 ? "positive" : profile.valence < -0.5 ? "negative" : "neutral"
    return `${profile.dominant} (${valenceLabel}, ${arousalLabel})`
  }
}

/** Singleton StyleModifier instance. */
export const styleModifier = new StyleModifier()
