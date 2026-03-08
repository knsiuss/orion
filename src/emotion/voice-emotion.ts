/**
 * @file voice-emotion.ts
 * @description Bridges EmotionSample to VoiceBridge voice parameter modulation.
 *   Maps detected emotion to Kokoro TTS voice + speed overrides.
 *
 * ARCHITECTURE:
 *   - Extends the existing emotion detection from voice/emotion-engine.ts
 *   - Provides a normalized interface: EmotionSample → VoiceModulation
 *   - Consumed by VoiceBridge.speakWithEmotion()
 *
 * PAPER BASIS:
 *   - Affective Speech Synthesis: Schröder 2001 — prosody correlates with emotion
 *   - Arousal → speech rate; Valence → pitch/voice type
 */

import { createLogger } from "../logger.js"
import type { EmotionSample, EmotionLabel } from "./emotion-schema.js"

const log = createLogger("emotion.voice-emotion")

/**
 * Voice modulation parameters derived from an emotion sample.
 */
export interface VoiceModulation {
  /** Kokoro TTS voice identifier. */
  voice: string
  /** Speaking rate multiplier (0.7 = slower, 1.2 = faster). */
  speed: number
  /** Optional pitch adjustment hint (not all TTS backends support this). */
  pitchHint?: "low" | "normal" | "high"
}

/**
 * Per-emotion voice modulation presets.
 * Voice IDs correspond to Kokoro TTS voice identifiers.
 */
const EMOTION_VOICE_MAP: Record<EmotionLabel, VoiceModulation> = {
  joy: { voice: "af_sky", speed: 1.1, pitchHint: "high" },
  sadness: { voice: "af_nicole", speed: 0.85, pitchHint: "low" },
  anger: { voice: "am_adam", speed: 1.15, pitchHint: "normal" },
  fear: { voice: "af_nicole", speed: 1.05, pitchHint: "normal" },
  surprise: { voice: "af_sky", speed: 1.1, pitchHint: "high" },
  disgust: { voice: "am_adam", speed: 0.9, pitchHint: "low" },
  neutral: { voice: "af_sky", speed: 1.0, pitchHint: "normal" },
  love: { voice: "af_nicole", speed: 0.95, pitchHint: "high" },
}

/**
 * VoiceEmotionMapper — converts an EmotionSample to VoiceModulation parameters.
 *
 * Applies arousal-based speed adjustment on top of preset values so that
 * high-arousal states always speak faster regardless of the preset.
 */
export class VoiceEmotionMapper {
  /**
   * Maps an EmotionSample to VoiceModulation parameters for TTS.
   *
   * @param sample - EmotionSample from TextSentimentAnalyzer or MoodTracker
   * @returns VoiceModulation with voice and speed values
   */
  toVoiceParams(sample: EmotionSample): VoiceModulation {
    const preset = EMOTION_VOICE_MAP[sample.dominant]

    // Apply arousal-based speed fine-tuning (± 0.1 around preset speed)
    const arousalDelta = (sample.arousal - 0.5) * 0.2
    const adjustedSpeed = Math.max(0.7, Math.min(1.3, preset.speed + arousalDelta))

    const modulation: VoiceModulation = {
      voice: preset.voice,
      speed: Number.parseFloat(adjustedSpeed.toFixed(2)),
      pitchHint: preset.pitchHint,
    }

    log.debug("voice modulation computed", {
      dominant: sample.dominant,
      arousal: sample.arousal,
      preset: preset.speed,
      adjusted: modulation.speed,
    })

    return modulation
  }
}

/** Singleton VoiceEmotionMapper instance. */
export const voiceEmotionMapper = new VoiceEmotionMapper()
