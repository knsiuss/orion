/**
 * @file emotion-schema.ts
 * @description Zod schemas and TypeScript types for the Phase 21 Emotional Intelligence module.
 *
 * ARCHITECTURE:
 *   Shared type contract used by text-sentiment.ts, mood-tracker.ts, style-modifier.ts,
 *   voice-emotion.ts, wellness-detector.ts, and go-emotions-map.ts.
 *
 * PAPER BASIS:
 *   - GoEmotions: arXiv:2005.00547 — 27-category fine-grained emotion taxonomy
 *   - Circumplex Model of Affect: Russell 1980 — valence × arousal 2D emotion space
 */

import { z } from "zod"

/** Primary emotion labels aligned to the GoEmotions taxonomy (simplified 8-class). */
export type EmotionLabel =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "surprise"
  | "disgust"
  | "neutral"
  | "love"

/** All valid emotion label values as a const array. */
export const EMOTION_LABELS: readonly EmotionLabel[] = [
  "joy",
  "sadness",
  "anger",
  "fear",
  "surprise",
  "disgust",
  "neutral",
  "love",
] as const

/**
 * A single detected emotion sample from a piece of text.
 * Contains the dominant label plus valence/arousal coordinates.
 */
export const EmotionSampleSchema = z.object({
  /** Dominant emotion detected. */
  dominant: z.enum(["joy", "sadness", "anger", "fear", "surprise", "disgust", "neutral", "love"]),
  /** Valence: -1 (very negative) → +1 (very positive). */
  valence: z.number().min(-1).max(1),
  /** Arousal: 0 (very calm) → 1 (very activated). */
  arousal: z.number().min(0).max(1),
  /** Confidence 0–1. */
  confidence: z.number().min(0).max(1),
  /** Raw scores per label (optional). */
  scores: z.record(z.string(), z.number()).optional(),
})

export type EmotionSample = z.infer<typeof EmotionSampleSchema>

/**
 * Aggregated mood profile for a user over a rolling window of samples.
 * Used by StyleModifier and PersonalityEngine for adaptive tone.
 */
export const MoodProfileSchema = z.object({
  /** User identifier. */
  userId: z.string(),
  /** Current dominant emotion across recent samples. */
  dominant: z.enum(["joy", "sadness", "anger", "fear", "surprise", "disgust", "neutral", "love"]),
  /** Running average valence. */
  valence: z.number().min(-1).max(1),
  /** Running average arousal. */
  arousal: z.number().min(0).max(1),
  /** Number of samples in the current window. */
  sampleCount: z.number().int().min(0),
  /** Timestamp of the first sample in the window. */
  sessionStart: z.date(),
  /** Timestamp of the most recent sample. */
  lastUpdatedAt: z.date(),
})

export type MoodProfile = z.infer<typeof MoodProfileSchema>

/**
 * Wellness signal types detected by WellnessDetector.
 */
export const WellnessSignalSchema = z.object({
  /** User identifier. */
  userId: z.string(),
  /** Type of wellness concern. */
  signal: z.enum([
    "burnout_risk",
    "overwork_pattern",
    "high_stress",
    "persistent_sadness",
    "none",
  ]),
  /** Confidence 0–1. */
  confidence: z.number().min(0).max(1),
  /** Human-readable reason for this signal. */
  reason: z.string(),
  /** Timestamp when signal was generated. */
  detectedAt: z.date(),
})

export type WellnessSignal = z.infer<typeof WellnessSignalSchema>
