/**
 * @file mission-planner.test.ts
 * @description Tests for MissionPlanner — goal decomposition into step DAG.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { MissionPlanner } from "../mission-planner.js"

// Mock orchestrator to avoid real LLM calls
vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

import { orchestrator } from "../../engines/orchestrator.js"

const mockOrchestrator = vi.mocked(orchestrator)

describe("MissionPlanner", () => {
  let planner: MissionPlanner

  beforeEach(() => {
    planner = new MissionPlanner()
    vi.clearAllMocks()
  })

  describe("plan()", () => {
    it("returns a valid MissionPlan with required fields", async () => {
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify([
          { id: "step_1", description: "Search the web", toolName: "web_search", params: { query: "test" }, dependsOn: [] },
          { id: "step_2", description: "Save results", toolName: "memory_save", params: { content: "result" }, dependsOn: ["step_1"] },
        ]),
      )

      const plan = await planner.plan("user1", "Research topic X", "Research X")

      expect(plan.id).toBeTruthy()
      expect(plan.userId).toBe("user1")
      expect(plan.goal).toBe("Research topic X")
      expect(plan.title).toBe("Research X")
      expect(plan.steps.length).toBeGreaterThan(0)
      expect(plan.status).toBe("pending")
      expect(plan.budget).toBeDefined()
      expect(plan.createdAt).toBeInstanceOf(Date)
      expect(plan.updatedAt).toBeInstanceOf(Date)
    })

    it("parses steps with correct fields", async () => {
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify([
          { id: "step_1", description: "Do thing", toolName: "my_tool", params: { key: "val" }, dependsOn: [] },
        ]),
      )

      const plan = await planner.plan("user1", "Do something", "Something")

      const step = plan.steps[0]
      expect(step).toBeDefined()
      expect(step!.id).toBe("step_1")
      expect(step!.description).toBe("Do thing")
      expect(step!.toolName).toBe("my_tool")
      expect(step!.params).toEqual({ key: "val" })
      expect(step!.dependsOn).toEqual([])
      expect(step!.status).toBe("pending")
      expect(step!.retryCount).toBe(0)
    })

    it("uses fallback steps when LLM returns empty array", async () => {
      mockOrchestrator.generate.mockResolvedValue("[]")

      const plan = await planner.plan("user1", "Do something", "Title")

      expect(plan.steps.length).toBe(1)
      expect(plan.steps[0]!.toolName).toBe("llm_reasoning")
    })

    it("uses fallback steps when LLM throws", async () => {
      mockOrchestrator.generate.mockRejectedValue(new Error("LLM offline"))

      const plan = await planner.plan("user1", "Do something", "Title")

      expect(plan.steps.length).toBeGreaterThanOrEqual(1)
    })

    it("caps steps at MAX_STEPS (15)", async () => {
      const manySteps = Array.from({ length: 20 }, (_, i) => ({
        id: `step_${i + 1}`,
        description: `Step ${i + 1}`,
        toolName: "noop",
        params: {},
        dependsOn: i > 0 ? [`step_${i}`] : [],
      }))

      mockOrchestrator.generate.mockResolvedValue(JSON.stringify(manySteps))

      const plan = await planner.plan("user1", "Many steps", "Title")

      expect(plan.steps.length).toBeLessThanOrEqual(15)
    })

    it("sets default budget values", async () => {
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify([
          { id: "step_1", description: "Step", toolName: "noop", params: {}, dependsOn: [] },
        ]),
      )

      const plan = await planner.plan("user1", "Goal", "Title")

      expect(plan.budget.maxToolCalls).toBe(20)
      expect(plan.budget.usedToolCalls).toBe(0)
      expect(plan.budget.usedNetworkRequests).toBe(0)
    })

    it("handles non-JSON LLM response gracefully", async () => {
      mockOrchestrator.generate.mockResolvedValue("I cannot plan this task.")

      const plan = await planner.plan("user1", "Goal", "Title")

      // Should fall back to the fallback step
      expect(plan.steps.length).toBeGreaterThanOrEqual(1)
    })

    it("normalizes steps with missing fields", async () => {
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify([
          { description: "No ID step", toolName: "noop" },
        ]),
      )

      const plan = await planner.plan("user1", "Goal", "Title")

      const step = plan.steps[0]
      expect(step).toBeDefined()
      expect(step!.id).toBeTruthy() // Should get a fallback ID
      expect(step!.dependsOn).toEqual([])
      expect(step!.params).toEqual({})
    })
  })
})
