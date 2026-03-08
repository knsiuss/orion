/**
 * @file style-modifier.test.ts
 * @description Tests for StyleModifier — mood to style directive mapping.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { StyleModifier } from "../style-modifier.js"
import type { MoodProfile } from "../emotion-schema.js"

/** Helper to create a test MoodProfile. */
function makeProfile(
  dominant: MoodProfile["dominant"],
  valence: number,
  arousal: number,
  userId = "test-user",
): MoodProfile {
  return {
    userId,
    dominant,
    valence,
    arousal,
    sampleCount: 3,
    sessionStart: new Date(),
    lastUpdatedAt: new Date(),
  }
}

describe("StyleModifier", () => {
  let modifier: StyleModifier

  beforeEach(() => {
    modifier = new StyleModifier()
  })

  describe("getDirective()", () => {
    it("returns a non-empty string for all emotion labels", () => {
      const labels: MoodProfile["dominant"][] = [
        "joy", "sadness", "anger", "fear", "surprise", "disgust", "neutral", "love",
      ]
      for (const label of labels) {
        const directive = modifier.getDirective(makeProfile(label, 0, 0.5))
        expect(typeof directive).toBe("string")
        expect(directive.trim().length).toBeGreaterThan(0)
      }
    })

    it("includes emotional acknowledgment modifier for very negative valence", () => {
      const directive = modifier.getDirective(makeProfile("sadness", -0.8, 0.3))
      expect(directive).toContain("acknowledgment")
    })

    it("includes brevity modifier for high arousal", () => {
      const directive = modifier.getDirective(makeProfile("anger", -0.7, 0.85))
      expect(directive).toContain("concise")
    })

    it("does not add extra modifiers for neutral state", () => {
      const directive = modifier.getDirective(makeProfile("neutral", 0, 0.2))
      expect(directive).not.toContain("acknowledgment")
      expect(directive).not.toContain("concise")
    })

    it("includes warm/enthusiastic language for joy", () => {
      const directive = modifier.getDirective(makeProfile("joy", 0.9, 0.7))
      expect(directive.toLowerCase()).toMatch(/warm|enthusiasm|playful|energy/i)
    })

    it("includes calm/de-escalating language for anger", () => {
      const directive = modifier.getDirective(makeProfile("anger", -0.7, 0.8))
      expect(directive.toLowerCase()).toMatch(/calm|frustrat|de-escalat/i)
    })

    it("includes gentle/supportive language for sadness", () => {
      const directive = modifier.getDirective(makeProfile("sadness", -0.5, 0.3))
      expect(directive.toLowerCase()).toMatch(/gentle|empat|support/i)
    })

    it("includes reassuring language for fear", () => {
      const directive = modifier.getDirective(makeProfile("fear", -0.6, 0.8))
      expect(directive.toLowerCase()).toMatch(/reassur|grounding|clear/i)
    })
  })

  describe("describeState()", () => {
    it("returns a non-empty string", () => {
      const description = modifier.describeState(makeProfile("joy", 0.9, 0.7))
      expect(typeof description).toBe("string")
      expect(description.trim().length).toBeGreaterThan(0)
    })

    it("includes the dominant emotion", () => {
      const description = modifier.describeState(makeProfile("sadness", -0.5, 0.3))
      expect(description).toContain("sadness")
    })

    it("labels high arousal correctly", () => {
      const description = modifier.describeState(makeProfile("anger", -0.7, 0.85))
      expect(description).toContain("high energy")
    })

    it("labels low arousal correctly", () => {
      const description = modifier.describeState(makeProfile("neutral", 0, 0.2))
      expect(description).toContain("calm")
    })

    it("labels positive valence correctly", () => {
      const description = modifier.describeState(makeProfile("joy", 0.8, 0.7))
      expect(description).toContain("positive")
    })

    it("labels negative valence correctly", () => {
      const description = modifier.describeState(makeProfile("sadness", -0.7, 0.3))
      expect(description).toContain("negative")
    })
  })
})
