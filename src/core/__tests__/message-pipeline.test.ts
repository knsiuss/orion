import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock modules before importing SUT ────────────────────────────────

vi.mock("../../config.js", () => ({
  default: {
    PERSONA_ENABLED: false,
    SESSION_COMPACTION_ENABLED: false,
    KNOWLEDGE_BASE_ENABLED: false,
    SESSION_CONTEXT_WINDOW_TOKENS: 32_000,
  },
}))

vi.mock("../../database/index.js", () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("Hello from EDITH!"),
  },
}))

vi.mock("../../memory/store.js", () => ({
  memory: {
    buildContext: vi.fn().mockResolvedValue({
      systemContext: "memory-context",
      messages: [],
      retrievedMemoryIds: ["mem-1"],
    }),
    save: vi.fn().mockResolvedValue("saved-id"),
    registerPendingFeedback: vi.fn(),
  },
}))

vi.mock("../../memory/profiler.js", () => ({
  profiler: {
    getProfile: vi.fn().mockResolvedValue(null),
    formatForContext: vi.fn().mockResolvedValue(""),
    extractFromMessage: vi.fn().mockResolvedValue({ facts: [], opinions: [] }),
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../memory/causal-graph.js", () => ({
  causalGraph: {
    extractAndUpdate: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../memory/session-summarizer.js", () => ({
  sessionSummarizer: {
    compress: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../security/prompt-filter.js", () => ({
  filterPromptWithAffordance: vi.fn().mockResolvedValue({
    safe: true,
    sanitized: "test input",
    affordance: { shouldBlock: false },
  }),
}))

vi.mock("../../security/output-scanner.js", () => ({
  outputScanner: {
    scan: vi.fn().mockReturnValue({
      safe: true,
      sanitized: "Hello from EDITH!",
      issues: [],
    }),
  },
}))

vi.mock("../../sessions/session-store.js", () => ({
  sessionStore: {
    addMessage: vi.fn(),
    getSessionHistory: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("../critic.js", () => ({
  responseCritic: {
    critiqueAndRefine: vi.fn().mockResolvedValue({
      finalResponse: "Hello from EDITH!",
      refined: false,
      critique: { score: 1 },
      iterations: 0,
    }),
  },
}))

vi.mock("../persona.js", () => ({
  personaEngine: {
    detectMood: vi.fn().mockReturnValue("neutral"),
    detectExpertise: vi.fn().mockReturnValue("general"),
    detectTopicCategory: vi.fn().mockReturnValue("general"),
    buildDynamicContext: vi.fn().mockReturnValue(""),
  },
}))

vi.mock("../system-prompt-builder.js", () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue("system prompt"),
}))

vi.mock("../../memory/feedback-store.js", () => ({
  feedbackStore: {
    captureExplicit: vi.fn().mockResolvedValue(undefined),
    captureImplicit: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../background/habit-model.js", () => ({
  habitModel: {
    record: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../memory/user-preference.js", () => ({
  userPreferenceEngine: {
    setLanguage: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../personality-engine.js", () => ({
  personalityEngine: {
    detectLanguageFromMessage: vi.fn().mockReturnValue(null),
  },
}))

vi.mock("../../memory/knowledge/query-classifier.js", () => ({
  queryClassifier: {
    classify: vi.fn().mockReturnValue({ type: "chat", confidence: 0 }),
  },
}))

vi.mock("../../memory/knowledge/retrieval-engine.js", () => ({
  retrievalEngine: {
    retrieveContext: vi.fn().mockResolvedValue(""),
  },
}))

vi.mock("../../memory/knowledge/sync-scheduler.js", () => ({
  syncScheduler: {
    tick: vi.fn().mockResolvedValue(undefined),
  },
}))

// ── Imports AFTER mocks ──────────────────────────────────────────────

import { processMessage } from "../message-pipeline.js"
import { filterPromptWithAffordance } from "../../security/prompt-filter.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { memory } from "../../memory/store.js"

const filterMock = vi.mocked(filterPromptWithAffordance)
const generateMock = vi.mocked(orchestrator.generate)
const buildContextMock = vi.mocked(memory.buildContext)

// ── Test suite ───────────────────────────────────────────────────────

describe("processMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a response for a safe message", async () => {
    const result = await processMessage("user-1", "test input", { channel: "cli" })

    expect(result).toHaveProperty("response")
    expect(result).toHaveProperty("retrievedMemoryIds")
    expect(result).toHaveProperty("provisionalReward")
    expect(typeof result.response).toBe("string")
    expect(result.response).toBe("Hello from EDITH!")
  })

  it("blocks messages flagged by affordance checker", async () => {
    filterMock.mockResolvedValueOnce({
      safe: false,
      sanitized: "blocked",
      affordance: { shouldBlock: true, risk: "high", category: "harmful" },
    } as never)

    const result = await processMessage("user-1", "bad input", { channel: "cli" })

    expect(result.response).toContain("tidak bisa bantu")
    expect(result.retrievedMemoryIds).toEqual([])
    expect(result.provisionalReward).toBe(0)
  })

  it("allows unsafe input when affordance says don't block", async () => {
    filterMock.mockResolvedValueOnce({
      safe: false,
      sanitized: "sanitized input",
      affordance: { shouldBlock: false, risk: "low", category: "unknown" },
    } as never)

    const result = await processMessage("user-1", "slightly dodgy", { channel: "cli" })

    expect(result.response).toBe("Hello from EDITH!")
  })

  it("calls orchestrator.generate with reasoning task type", async () => {
    await processMessage("user-1", "hello", { channel: "cli" })

    expect(generateMock).toHaveBeenCalledWith(
      "reasoning",
      expect.objectContaining({ prompt: expect.any(String) }),
    )
  })

  it("sets provisionalReward > 0 when memories are retrieved", async () => {
    buildContextMock.mockResolvedValueOnce({
      systemContext: "ctx",
      messages: [],
      retrievedMemoryIds: ["m1", "m2"],
    })

    const result = await processMessage("user-1", "hello", { channel: "cli" })

    expect(result.provisionalReward).toBeGreaterThan(0)
    expect(result.retrievedMemoryIds).toEqual(["m1", "m2"])
  })

  it("sets provisionalReward = 0 when no memories retrieved", async () => {
    buildContextMock.mockResolvedValueOnce({
      systemContext: "ctx",
      messages: [],
      retrievedMemoryIds: [],
    })

    const result = await processMessage("user-1", "hello", { channel: "webchat" })

    expect(result.provisionalReward).toBe(0)
    expect(result.retrievedMemoryIds).toEqual([])
  })
})
