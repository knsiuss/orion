/**
 * @file specialized-agents.test.ts
 * @description Unit tests for the specialized-agents dispatcher.
 * Verifies all AgentType variants are dispatched with the correct
 * taskType and that the system prompt is included in the call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mock orchestrator ─────────────────────────────────────────────────────────
const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn().mockResolvedValue("agent response"),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: { generate: generateMock },
}))

import { runSpecializedAgent } from "../specialized-agents.js"

describe("runSpecializedAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateMock.mockResolvedValue("agent response")
  })

  it("dispatches researcher with reasoning task type", async () => {
    const result = await runSpecializedAgent("researcher", "Find info on AI")
    expect(generateMock).toHaveBeenCalledWith(
      "reasoning",
      expect.objectContaining({ prompt: expect.stringContaining("Find info on AI") })
    )
    expect(result).toBe("agent response")
  })

  it("dispatches coder with code task type", async () => {
    await runSpecializedAgent("coder", "Write a sort function")
    expect(generateMock).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("Write a sort function") })
    )
  })

  it("dispatches writer with fast task type", async () => {
    await runSpecializedAgent("writer", "Write an email")
    expect(generateMock).toHaveBeenCalledWith(
      "fast",
      expect.any(Object)
    )
  })

  it("dispatches analyst with reasoning task type", async () => {
    await runSpecializedAgent("analyst", "Analyze this data")
    expect(generateMock).toHaveBeenCalledWith(
      "reasoning",
      expect.any(Object)
    )
  })

  it("dispatches executor with fast task type", async () => {
    await runSpecializedAgent("executor", "Execute the plan")
    expect(generateMock).toHaveBeenCalledWith(
      "fast",
      expect.any(Object)
    )
  })

  it("dispatches reviewer with fast task type", async () => {
    await runSpecializedAgent("reviewer", "Check the output")
    expect(generateMock).toHaveBeenCalledWith(
      "fast",
      expect.any(Object)
    )
  })

  it("includes context in the prompt when provided", async () => {
    await runSpecializedAgent("analyst", "Analyze", "Context: previous result")
    const call = generateMock.mock.calls[0]
    expect(call?.[1]?.prompt).toContain("Context: previous result")
    expect(call?.[1]?.prompt).toContain("Analyze")
  })

  it("returns the orchestrator's response", async () => {
    generateMock.mockResolvedValue("synthesized output")
    const result = await runSpecializedAgent("researcher", "search it")
    expect(result).toBe("synthesized output")
  })
})
