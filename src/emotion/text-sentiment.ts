/**
 * @file text-sentiment.ts
 * @description Lightweight lexical emotion detector for EDITH.
 *   Detects dominant emotion + valence/arousal coordinates from user text.
 *
 * ARCHITECTURE:
 *   - Zero external dependencies: pure TypeScript keyword scoring
 *   - Supports English + Indonesian lexicons (go-emotions-map.ts)
 *   - Output: EmotionSample consumed by mood-tracker.ts
 *   - Can be extended to call an external model endpoint if config.EMOTION_MODEL_URL is set
 *
 * PAPER BASIS:
 *   - GoEmotions: arXiv:2005.00547 — keyword taxonomy basis
 *   - Circumplex Model: Russell 1980 — valence × arousal coordinates
 */

import { createLogger } from "../logger.js"
import type { EmotionSample, EmotionLabel } from "./emotion-schema.js"
import { EMOTION_LABELS } from "./emotion-schema.js"
import {
  ENGLISH_LEXICON,
  INDONESIAN_LEXICON,
  VALENCE_MAP,
  AROUSAL_MAP,
} from "./go-emotions-map.js"

const log = createLogger("emotion.text-sentiment")

/** Minimum confidence threshold to report a non-neutral detection. */
const MIN_CONFIDENCE = 0.15

/** Blend weight for English vs Indonesian lexicons when both match. */
const BILINGUAL_WEIGHT = 0.5

/**
 * Tokenizes text into lowercase words/tokens for lexicon matching.
 *
 * @param text - Raw input string
 * @returns Array of lowercase tokens
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]/g, ""))
    .filter((token) => token.length > 0)
}

/**
 * Scores a token set against a single emotion lexicon.
 * Returns a per-label score map (0–1 normalized).
 *
 * @param tokens - Tokenized input
 * @param lexicon - Keyword lists per emotion label
 * @returns Score map per emotion label
 */
function scoreAgainstLexicon(
  tokens: string[],
  lexicon: Record<EmotionLabel, readonly string[]>,
): Record<EmotionLabel, number> {
  const scores = Object.fromEntries(EMOTION_LABELS.map((label) => [label, 0])) as Record<EmotionLabel, number>

  for (const label of EMOTION_LABELS) {
    const keywords = lexicon[label]
    for (const keyword of keywords) {
      // Multi-word keywords: check if the joined token string contains the phrase
      if (keyword.includes(" ")) {
        if (text_contains(tokens.join(" "), keyword)) {
          scores[label] += 1
        }
      } else if (tokens.includes(keyword)) {
        scores[label] += 1
      }
    }
  }

  return scores
}

/**
 * Helper: checks if a space-joined token string contains a phrase.
 *
 * @param text - Space-joined tokens
 * @param phrase - Lowercase phrase to search
 */
function text_contains(text: string, phrase: string): boolean {
  return text.includes(phrase)
}

/**
 * Combines two score maps with a blend weight.
 *
 * @param a - First score map
 * @param b - Second score map
 * @param weightB - Weight to apply to b (0–1); a gets (1 - weightB)
 */
function blendScores(
  a: Record<EmotionLabel, number>,
  b: Record<EmotionLabel, number>,
  weightB: number,
): Record<EmotionLabel, number> {
  const result = {} as Record<EmotionLabel, number>
  for (const label of EMOTION_LABELS) {
    result[label] = a[label] * (1 - weightB) + b[label] * weightB
  }
  return result
}

/**
 * Picks the dominant label and computes confidence from a score map.
 *
 * @param scores - Per-label score values (any non-negative range)
 * @returns Dominant label and normalized confidence
 */
function pickDominant(scores: Record<EmotionLabel, number>): {
  dominant: EmotionLabel
  confidence: number
} {
  let dominant: EmotionLabel = "neutral"
  let maxScore = 0
  let total = 0

  for (const label of EMOTION_LABELS) {
    if (scores[label] > maxScore) {
      maxScore = scores[label]
      dominant = label
    }
    total += scores[label]
  }

  const confidence = total > 0 ? maxScore / total : 0
  return { dominant, confidence }
}

/**
 * TextSentimentAnalyzer — detects emotion from raw text using keyword lexicons.
 *
 * Supports English and Indonesian text with bilingual blending.
 * Falls back to neutral if no strong signal is found.
 */
export class TextSentimentAnalyzer {
  /**
   * Detects emotion from a text string.
   * Returns an EmotionSample with dominant label, valence, arousal, and confidence.
   *
   * @param text - Raw user message text
   * @returns EmotionSample with emotion coordinates
   */
  async detect(text: string): Promise<EmotionSample> {
    if (!text || text.trim().length === 0) {
      return {
        dominant: "neutral",
        valence: 0,
        arousal: 0.2,
        confidence: 1,
      }
    }

    try {
      const tokens = tokenize(text)

      const englishScores = scoreAgainstLexicon(tokens, ENGLISH_LEXICON)
      const indonesianScores = scoreAgainstLexicon(tokens, INDONESIAN_LEXICON)

      // Check if this looks like Indonesian (heuristic: presence of Indonesian tokens)
      const indonesianHits = Object.values(indonesianScores).reduce((s, v) => s + v, 0)
      const englishHits = Object.values(englishScores).reduce((s, v) => s + v, 0)

      let combined: Record<EmotionLabel, number>
      if (indonesianHits > 0 && englishHits > 0) {
        // Bilingual: blend both
        combined = blendScores(englishScores, indonesianScores, BILINGUAL_WEIGHT)
      } else if (indonesianHits > englishHits) {
        combined = indonesianScores
      } else {
        combined = englishScores
      }

      const { dominant, confidence } = pickDominant(combined)

      // If confidence is too low, default to neutral
      const effectiveDominant: EmotionLabel = confidence >= MIN_CONFIDENCE ? dominant : "neutral"

      const scores = Object.fromEntries(
        EMOTION_LABELS.map((label) => [label, combined[label]])
      ) as Record<EmotionLabel, number>

      return {
        dominant: effectiveDominant,
        valence: VALENCE_MAP[effectiveDominant],
        arousal: AROUSAL_MAP[effectiveDominant],
        confidence: confidence >= MIN_CONFIDENCE ? confidence : 1,
        scores,
      }
    } catch (err) {
      log.warn("emotion detection failed, returning neutral", { err })
      return {
        dominant: "neutral",
        valence: 0,
        arousal: 0.2,
        confidence: 0,
      }
    }
  }
}

/** Singleton TextSentimentAnalyzer instance. */
export const textSentiment = new TextSentimentAnalyzer()
