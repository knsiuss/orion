/**
 * @file pattern-learner.test.ts
 * @description Unit/integration tests for predictive\.__tests__\.pattern-learner.test.ts.
 */
import { describe, it, expect } from "vitest"
import { patternLearner } from "../pattern-learner.js"

describe("PatternLearner", () => {
  it("records and retrieves patterns", () => {
    patternLearner.record("user1", "morning-coffee", "7am")
    patternLearner.record("user1", "morning-coffee", "7am")
    patternLearner.record("user1", "morning-coffee", "7am")

    const patterns = patternLearner.getPatterns("user1", 0.1)
    expect(patterns.length).toBe(1)
    expect(patterns[0].name).toBe("morning-coffee")
    expect(patterns[0].frequency).toBe(3)
  })

  it("filters by confidence", () => {
    patternLearner.record("user2", "rare-action", "noon")
    const patterns = patternLearner.getPatterns("user2", 0.5)
    expect(patterns.length).toBe(0)
  })
})
