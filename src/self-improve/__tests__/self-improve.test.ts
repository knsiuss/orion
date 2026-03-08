/**
 * @file self-improve.test.ts
 * @description Tests for Phase 24 self-improvement modules.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { QualityTracker } from "../quality-tracker.js"
import { PromptVersioning } from "../prompt-versioning.js"
import { PromptOptimizer } from "../prompt-optimizer.js"
import { GapDetector } from "../gap-detector.js"
import { PatternDetector } from "../pattern-detector.js"
import { FROZEN_ZONES } from "../types.js"
import type { FeedbackSignal, PromptVersion } from "../types.js"

// ---------------------------------------------------------------------------
// QualityTracker
// ---------------------------------------------------------------------------
describe("QualityTracker", () => {
  let tracker: QualityTracker

  const makeSignal = (signal: FeedbackSignal["signal"], topic = "test", daysAgo = 0): FeedbackSignal => ({
    interactionId: `i-${Math.random()}`,
    timestamp: Date.now() - daysAgo * 24 * 60 * 60 * 1000,
    signal,
    reason: "test reason",
    topic,
    promptVersion: "v1",
  })

  beforeEach(() => {
    tracker = new QualityTracker()
  })

  it("records and retrieves signals within window", () => {
    tracker.record(makeSignal("positive", "coding"))
    tracker.record(makeSignal("negative", "coding"))
    expect(tracker.getSignals(7)).toHaveLength(2)
  })

  it("filters out signals older than window", () => {
    tracker.record(makeSignal("positive", "coding", 8))
    expect(tracker.getSignals(7)).toHaveLength(0)
  })

  it("detectRephraseSignal returns true for similar messages", () => {
    const r = tracker.detectRephraseSignal("u1", "how do I install python packages", "how to install python packages")
    expect(r).toBe(true)
  })

  it("detectRephraseSignal returns false for unrelated messages", () => {
    const r = tracker.detectRephraseSignal("u1", "what is the weather", "tell me about quantum physics")
    expect(r).toBe(false)
  })

  it("getTopicStats computes negative rate", () => {
    tracker.record(makeSignal("positive", "math"))
    tracker.record(makeSignal("negative", "math"))
    const stats = tracker.getTopicStats()
    expect(stats.math?.rate).toBeCloseTo(0.5)
    expect(stats.math?.negative).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// PromptVersioning
// ---------------------------------------------------------------------------
describe("PromptVersioning", () => {
  let versioning: PromptVersioning

  const makeVersion = (zone: string, id: string): PromptVersion => ({
    id,
    timestamp: new Date().toISOString(),
    zone,
    oldContent: "old",
    newContent: "new",
    reason: "test",
    evidence: { sampleSize: 50, negativeRate: 0.3, improvementEstimate: 0.7 },
  })

  beforeEach(() => {
    versioning = new PromptVersioning()
  })

  it("save and getLatest", () => {
    versioning.save(makeVersion("response_style", "v1"))
    versioning.save(makeVersion("response_style", "v2"))
    expect(versioning.getLatest("response_style")?.id).toBe("v2")
  })

  it("rollback returns second-to-last version", () => {
    versioning.save(makeVersion("response_style", "v1"))
    versioning.save(makeVersion("response_style", "v2"))
    const restored = versioning.rollback("response_style")
    expect(restored?.id).toBe("v1")
  })

  it("rollback to specific versionId", () => {
    versioning.save(makeVersion("response_style", "v1"))
    versioning.save(makeVersion("response_style", "v2"))
    versioning.save(makeVersion("response_style", "v3"))
    const restored = versioning.rollback("response_style", "v1")
    expect(restored?.id).toBe("v1")
  })

  it("rollback returns undefined when fewer than 2 versions", () => {
    versioning.save(makeVersion("response_style", "v1"))
    expect(versioning.rollback("response_style")).toBeUndefined()
  })

  it("enforces max 30 versions per zone", () => {
    for (let i = 0; i < 35; i++) {
      versioning.save(makeVersion("tool_selection", `v${i}`))
    }
    expect(versioning.list("tool_selection")).toHaveLength(30)
  })

  it("list without zone returns all versions", () => {
    versioning.save(makeVersion("response_style", "r1"))
    versioning.save(makeVersion("tool_selection", "t1"))
    expect(versioning.list().length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// PromptOptimizer — frozen zone check
// ---------------------------------------------------------------------------
describe("PromptOptimizer", () => {
  it("isFrozen returns true for all frozen zones", () => {
    const optimizer = new PromptOptimizer()
    for (const zone of FROZEN_ZONES) {
      expect(optimizer.isFrozen(zone)).toBe(true)
    }
  })

  it("isFrozen returns false for mutable zones", () => {
    const optimizer = new PromptOptimizer()
    expect(optimizer.isFrozen("response_style")).toBe(false)
    expect(optimizer.isFrozen("tool_selection")).toBe(false)
  })

  it("optimize returns null for frozen zone without calling LLM", async () => {
    const optimizer = new PromptOptimizer()
    const result = await optimizer.optimize("identity", "some prompt")
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GapDetector
// ---------------------------------------------------------------------------
describe("GapDetector", () => {
  let detector: GapDetector

  beforeEach(() => {
    detector = new GapDetector()
  })

  it("records gaps and returns sorted by count", () => {
    detector.record("quantum-computing", "what is superposition")
    detector.record("quantum-computing", "explain entanglement")
    detector.record("blockchain", "how does mining work")
    const gaps = detector.getGaps()
    expect(gaps[0]?.topic).toBe("quantum-computing")
    expect(gaps[0]?.count).toBe(2)
  })

  it("clear removes gap from active list", () => {
    detector.record("topic-x", "example question")
    detector.clear("topic-x")
    expect(detector.getGaps().find((g) => g.topic === "topic-x")).toBeUndefined()
  })

  it("re-recording a cleared gap makes it active again", () => {
    detector.record("topic-y", "question 1")
    detector.clear("topic-y")
    detector.record("topic-y", "question 2")
    expect(detector.getGaps().find((g) => g.topic === "topic-y")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// PatternDetector
// ---------------------------------------------------------------------------
describe("PatternDetector", () => {
  let detector: PatternDetector

  beforeEach(() => {
    detector = new PatternDetector()
  })

  it("detect finds patterns with more than 3 occurrences", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("user1", `what is python ${i}`, "python-questions")
    }
    const patterns = detector.detect()
    expect(patterns.some((p) => p.description === "python-questions")).toBe(true)
  })

  it("does not surface patterns with 3 or fewer occurrences", () => {
    for (let i = 0; i < 3; i++) {
      detector.record("user1", `question ${i}`, "rare-topic")
    }
    const patterns = detector.detect()
    expect(patterns.some((p) => p.description === "rare-topic")).toBe(false)
  })

  it("markRejected changes status to rejected", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("user1", `msg ${i}`, "some-topic")
    }
    const patterns = detector.detect()
    const p = patterns[0]
    if (p) {
      detector.markRejected(p.id)
      const re = detector.detect()
      // After rejection the pattern still appears — status is managed externally
      expect(re.find((x) => x.id === p.id)?.status).toBe("rejected")
    }
  })

  it("markApproved changes status to approved", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("user1", `query ${i}`, "approved-topic")
    }
    const [p] = detector.detect()
    if (p) {
      detector.markApproved(p.id)
      const re = detector.detect()
      expect(re.find((x) => x.id === p.id)?.status).toBe("approved")
    }
  })
})
