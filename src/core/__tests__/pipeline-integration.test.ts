import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock ALL external dependencies before importing SUT ──────────────
// IMPORTANT: vi.mock factories are hoisted; do NOT reference top-level variables.

vi.mock("../../config.js", () => ({
  default: {
    PERSONA_ENABLED: true,
    SESSION_COMPACTION_ENABLED: false,
    KNOWLEDGE_BASE_ENABLED: false,
    SESSION_CONTEXT_WINDOW_TOKENS: 32_000,
    PERSONALIZATION_ENABLED: false,
  },
}))

vi.mock("../../database/index.js", () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("EDITH response here"),
    generateStream: vi.fn().mockReturnValue(null),
  },
}))

vi.mock("../../memory/store.js", () => ({
  memory: {
    buildContext: vi.fn().mockResolvedValue({
      systemContext: "retrieved-memory-context",
      messages: [{ role: "user", content: "prior context" }],
      retrievedMemoryIds: ["mem-001", "mem-002"],
    }),
    save: vi.fn().mockResolvedValue("saved-id"),
    registerPendingFeedback: vi.fn(),
  },
}))

vi.mock("../../memory/profiler.js", () => ({
  profiler: {
    getProfile: vi.fn().mockResolvedValue({
      currentTopics: ["technology"],
    }),
    formatForContext: vi.fn().mockResolvedValue("User is interested in tech"),
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
    sanitized: "hello edith",
    affordance: { shouldBlock: false },
  }),
}))

vi.mock("../../security/output-scanner.js", () => ({
  outputScanner: {
    scan: vi.fn().mockReturnValue({
      safe: true,
      sanitized: "EDITH response here",
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
      finalResponse: "EDITH response here",
      refined: false,
      critique: { score: 0.9 },
      iterations: 0,
    }),
  },
}))

vi.mock("../persona.js", () => ({
  personaEngine: {
    detectMood: vi.fn().mockReturnValue("neutral"),
    detectExpertise: vi.fn().mockReturnValue("intermediate"),
    detectTopicCategory: vi.fn().mockReturnValue("technology"),
    detectSituation: vi.fn().mockReturnValue("routine"),
    buildDynamicContext: vi.fn().mockReturnValue("dynamic persona context"),
  },
}))

vi.mock("../system-prompt-builder.js", () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue("You are EDITH, a helpful AI assistant."),
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

vi.mock("../task-classifier.js", () => ({
  classifyTask: vi.fn().mockReturnValue("reasoning"),
  needsRetrieval: vi.fn().mockReturnValue(true),
}))

vi.mock("../classifier-feedback.js", () => ({
  classifierFeedback: {
    recordSimple: vi.fn(),
    record: vi.fn(),
  },
}))

vi.mock("../../channels/streaming-delivery.js", () => ({
  streamingDelivery: {
    collect: vi.fn().mockResolvedValue({ fullText: "streamed response" }),
  },
}))

// ── Imports AFTER all mocks ──────────────────────────────────────────

import { processMessage } from "../message-pipeline.js"
import { filterPromptWithAffordance } from "../../security/prompt-filter.js"
import { outputScanner } from "../../security/output-scanner.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { saveMessage } from "../../database/index.js"
import { memory } from "../../memory/store.js"
import { sessionStore } from "../../sessions/session-store.js"
import { buildSystemPrompt } from "../system-prompt-builder.js"
import { personaEngine } from "../persona.js"
import { profiler } from "../../memory/profiler.js"
import { responseCritic } from "../critic.js"

const filterMock = vi.mocked(filterPromptWithAffordance)
const scanMock = vi.mocked(outputScanner.scan)
const generateMock = vi.mocked(orchestrator.generate)
const buildContextMock = vi.mocked(memory.buildContext)
const critiqueMock = vi.mocked(responseCritic.critiqueAndRefine)
const saveMessageMock = vi.mocked(saveMessage)
const addMessageMock = vi.mocked(sessionStore.addMessage)
const buildSystemPromptMock = vi.mocked(buildSystemPrompt)
const memorySaveMock = vi.mocked(memory.save)

// ── Integration test suite ───────────────────────────────────────────

describe("Pipeline Integration (Stages 1-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to defaults after clearAllMocks
    filterMock.mockResolvedValue({
      safe: true,
      sanitized: "hello edith",
      affordance: { shouldBlock: false },
    } as never)
    generateMock.mockResolvedValue("EDITH response here")
    buildContextMock.mockResolvedValue({
      systemContext: "retrieved-memory-context",
      messages: [{ role: "user", content: "prior context" }],
      retrievedMemoryIds: ["mem-001", "mem-002"],
    })
    scanMock.mockReturnValue({
      safe: true,
      sanitized: "EDITH response here",
      issues: [],
    })
    critiqueMock.mockResolvedValue({
      finalResponse: "EDITH response here",
      refined: false,
      critique: { score: 0.9 },
      iterations: 0,
    } as never)
  })

  it("processes a message through all 9 stages and returns a complete PipelineResult", async () => {
    const result = await processMessage("user-1", "hello edith", {
      channel: "cli",
      sessionMode: "dm",
    })

    // Stage 1: Input safety filter was called
    expect(filterMock).toHaveBeenCalledWith("hello edith", "user-1")

    // Stage 2: Memory context built + user message persisted
    expect(buildContextMock).toHaveBeenCalledWith("user-1", "hello edith")
    expect(saveMessageMock).toHaveBeenCalledWith(
      "user-1",
      "user",
      "hello edith",
      "cli",
      expect.objectContaining({ role: "user" }),
    )

    // Stage 3 + 4: Persona detection and system prompt assembly
    expect(vi.mocked(profiler.getProfile)).toHaveBeenCalledWith("user-1")
    expect(vi.mocked(personaEngine.detectMood)).toHaveBeenCalled()
    expect(buildSystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionMode: "dm",
        includeSkills: true,
        includeSafety: true,
        userId: "user-1",
      }),
    )

    // Stage 5: LLM generation
    expect(generateMock).toHaveBeenCalledWith(
      "reasoning",
      expect.objectContaining({
        prompt: expect.stringContaining("hello edith"),
        systemPrompt: "You are EDITH, a helpful AI assistant.",
      }),
    )

    // Stage 6: Critique
    expect(critiqueMock).toHaveBeenCalledWith(
      "hello edith",
      "EDITH response here",
      2,
    )

    // Stage 7: Output safety scan
    expect(scanMock).toHaveBeenCalledWith("EDITH response here")

    // Stage 8: Assistant response persisted
    expect(saveMessageMock).toHaveBeenCalledWith(
      "user-1",
      "assistant",
      "EDITH response here",
      "cli",
      expect.objectContaining({ role: "assistant" }),
    )
    expect(memorySaveMock).toHaveBeenCalled()
    expect(addMessageMock).toHaveBeenCalledTimes(2) // user + assistant

    // Final result
    expect(result.response).toBe("EDITH response here")
    expect(result.retrievedMemoryIds).toEqual(["mem-001", "mem-002"])
    expect(result.provisionalReward).toBeGreaterThan(0)
  })

  it("returns BLOCKED_RESPONSE when input is flagged as unsafe with shouldBlock", async () => {
    filterMock.mockResolvedValueOnce({
      safe: false,
      sanitized: "blocked content",
      affordance: { shouldBlock: true, risk: "critical", category: "harmful" },
    } as never)

    const result = await processMessage("user-1", "dangerous input", {
      channel: "webchat",
    })

    // Should return blocked response
    expect(result.response).toContain("tidak bisa bantu")
    expect(result.retrievedMemoryIds).toEqual([])
    expect(result.provisionalReward).toBe(0)

    // LLM generation should NOT have been called
    expect(generateMock).not.toHaveBeenCalled()
    // Memory should NOT have been built
    expect(buildContextMock).not.toHaveBeenCalled()
  })

  it("returns timeout response when pipeline exceeds PIPELINE_TIMEOUT_MS", async () => {
    // Make the LLM generation hang for longer than the 60s timeout
    generateMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve("late response"), 70_000)),
    )

    const result = await processMessage("user-1", "slow query", {
      channel: "cli",
    })

    // The timeout handler should return the Indonesian timeout message
    expect(result.response).toContain("terlalu lama")
    expect(result.retrievedMemoryIds).toEqual([])
    expect(result.provisionalReward).toBe(0)
  }, 65_000)

  it("sanitizes output when output scanner detects issues", async () => {
    scanMock.mockReturnValueOnce({
      safe: false,
      sanitized: "EDITH response with [REDACTED]",
      issues: ["API key detected"],
    })

    const result = await processMessage("user-1", "show me the key", {
      channel: "cli",
    })

    // The sanitized version should be returned
    expect(result.response).toBe("EDITH response with [REDACTED]")
  })

  it("uses refined response when critic improves it", async () => {
    critiqueMock.mockResolvedValueOnce({
      finalResponse: "Improved EDITH response",
      refined: true,
      critique: { score: 0.6 },
      iterations: 1,
    } as never)
    scanMock.mockReturnValueOnce({
      safe: true,
      sanitized: "Improved EDITH response",
      issues: [],
    })

    const result = await processMessage("user-1", "explain quantum physics", {
      channel: "webchat",
    })

    expect(result.response).toBe("Improved EDITH response")
    expect(scanMock).toHaveBeenCalledWith("Improved EDITH response")
  })

  it("sets provisionalReward to 0 when no memories are retrieved", async () => {
    buildContextMock.mockResolvedValueOnce({
      systemContext: "",
      messages: [],
      retrievedMemoryIds: [],
    })

    const result = await processMessage("user-1", "hello", { channel: "cli" })

    expect(result.provisionalReward).toBe(0)
    expect(result.retrievedMemoryIds).toEqual([])
  })

  it("still processes when input is unsafe but affordance says don't block", async () => {
    filterMock.mockResolvedValueOnce({
      safe: false,
      sanitized: "cleaned input",
      affordance: { shouldBlock: false, risk: "low", category: "unknown" },
    } as never)

    const result = await processMessage("user-1", "mildly sketchy", {
      channel: "cli",
    })

    // Pipeline should proceed with the sanitized text
    expect(generateMock).toHaveBeenCalled()
    expect(result.response).toBe("EDITH response here")
  })
})
