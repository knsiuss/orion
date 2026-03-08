/**
 * @file text-sentiment.test.ts
 * @description Tests for TextSentimentAnalyzer — lexical emotion detection.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { TextSentimentAnalyzer } from "../text-sentiment.js"

describe("TextSentimentAnalyzer", () => {
  let analyzer: TextSentimentAnalyzer

  beforeEach(() => {
    analyzer = new TextSentimentAnalyzer()
  })

  describe("detect()", () => {
    it("returns neutral for empty string", async () => {
      const result = await analyzer.detect("")
      expect(result.dominant).toBe("neutral")
      expect(result.confidence).toBe(1)
    })

    it("returns neutral for whitespace-only input", async () => {
      const result = await analyzer.detect("   ")
      expect(result.dominant).toBe("neutral")
    })

    it("detects joy from English keywords", async () => {
      const result = await analyzer.detect("I am so happy and excited today!")
      expect(result.dominant).toBe("joy")
      expect(result.valence).toBeGreaterThan(0)
      expect(result.arousal).toBeGreaterThan(0)
    })

    it("detects sadness from English keywords", async () => {
      const result = await analyzer.detect("I feel so sad and lonely right now")
      expect(result.dominant).toBe("sadness")
      expect(result.valence).toBeLessThan(0)
    })

    it("detects anger from English keywords", async () => {
      const result = await analyzer.detect("I am furious and angry at this situation")
      expect(result.dominant).toBe("anger")
      expect(result.valence).toBeLessThan(0)
      expect(result.arousal).toBeGreaterThan(0.5)
    })

    it("detects fear/anxiety from English keywords", async () => {
      const result = await analyzer.detect("I am very anxious and stressed about this")
      expect(result.dominant).toBe("fear")
      expect(result.valence).toBeLessThan(0)
    })

    it("detects joy from Indonesian keywords", async () => {
      const result = await analyzer.detect("Saya sangat senang dan bahagia hari ini!")
      expect(result.dominant).toBe("joy")
      expect(result.valence).toBeGreaterThan(0)
    })

    it("detects sadness from Indonesian keywords", async () => {
      const result = await analyzer.detect("Saya merasa sedih dan kecewa sekali")
      expect(result.dominant).toBe("sadness")
      expect(result.valence).toBeLessThan(0)
    })

    it("returns valence within -1 to 1 range", async () => {
      const result = await analyzer.detect("This is amazing and wonderful!")
      expect(result.valence).toBeGreaterThanOrEqual(-1)
      expect(result.valence).toBeLessThanOrEqual(1)
    })

    it("returns arousal within 0 to 1 range", async () => {
      const result = await analyzer.detect("Very angry and furious right now!")
      expect(result.arousal).toBeGreaterThanOrEqual(0)
      expect(result.arousal).toBeLessThanOrEqual(1)
    })

    it("returns confidence within 0 to 1 range", async () => {
      const result = await analyzer.detect("Some random text without clear emotion")
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it("includes scores map when keywords match", async () => {
      const result = await analyzer.detect("I feel so happy and joyful!")
      expect(result.scores).toBeDefined()
      if (result.scores) {
        expect(typeof result.scores.joy).toBe("number")
      }
    })

    it("handles mixed-language text", async () => {
      const result = await analyzer.detect("I am senang dan happy today")
      // Should detect something — not necessarily neutral
      expect(result.dominant).toBeDefined()
      expect(EMOTION_LABELS).toContain(result.dominant)
    })
  })
})

const EMOTION_LABELS = ["joy", "sadness", "anger", "fear", "surprise", "disgust", "neutral", "love"]
