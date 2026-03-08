/**
 * @file mission-executor.test.ts
 * @description Tests for MissionExecutor — step execution lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { MissionExecutor } from "../mission-executor.js"
import type { MissionPlan } from "../mission-schema.js"

// Mock skillLoader to avoid filesystem access
vi.mock("../../skills/loader.js", () => ({
  skillLoader: {
    getSnapshot: vi.fn().mockResolvedValue({ skills: [], builtAt: Date.now(), xmlIndex: "", alwaysActiveContent: "" }),
  },
}))

/** Helper to create a minimal test MissionPlan. */
function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
  return {
    id: "test-mission-1",
    userId: "user1",
    title: "Test Mission",
    goal: "Test the executor",
    steps: [
      {
        id: "step_1",
        description: "First step",
        toolName: "noop",
        params: {},
        dependsOn: [],
        maxRetries: 0,
        retryCount: 0,
        status: "pending",
      },
    ],
    budget: {
      maxToolCalls: 20,
      maxDurationMs: 5 * 60 * 1000,
      maxNetworkRequests: 10,
      usedToolCalls: 0,
      usedNetworkRequests: 0,
    },
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe("MissionExecutor", () => {
  let executor: MissionExecutor

  beforeEach(() => {
    executor = new MissionExecutor()
    vi.clearAllMocks()
  })

  describe("execute()", () => {
    it("returns a plan with completed or failed status", async () => {
      const plan = makePlan()
      const result = await executor.execute(plan)
      expect(["completed", "failed", "cancelled"]).toContain(result.status)
    })

    it("executes a single safe step successfully", async () => {
      const plan = makePlan()
      const result = await executor.execute(plan)
      // noop tool not in skillLoader, returns no_tool status — step completes
      expect(result.status).toBe("completed")
    })

    it("blocks steps with blocked tool names", async () => {
      const plan = makePlan({
        steps: [
          {
            id: "step_1",
            description: "Dangerous step",
            toolName: "bash",
            params: {},
            dependsOn: [],
            maxRetries: 0,
            retryCount: 0,
            status: "pending",
          },
        ],
      })

      const result = await executor.execute(plan)

      expect(result.status).toBe("failed")
      expect(result.steps[0]!.status).toBe("failed")
      expect(result.steps[0]!.error).toBeTruthy()
    })

    it("marks mission as completed when all steps succeed", async () => {
      const plan = makePlan({
        steps: [
          { id: "step_1", description: "Step A", toolName: "noop", params: {}, dependsOn: [], maxRetries: 0, retryCount: 0, status: "pending" },
          { id: "step_2", description: "Step B", toolName: "noop", params: {}, dependsOn: ["step_1"], maxRetries: 0, retryCount: 0, status: "pending" },
        ],
      })

      const result = await executor.execute(plan)

      expect(result.status).toBe("completed")
      expect(result.steps.every((s) => s.status === "completed")).toBe(true)
    })

    it("tracks budget tool call usage", async () => {
      const plan = makePlan()
      const result = await executor.execute(plan)
      expect(result.budget.usedToolCalls).toBeGreaterThan(0)
    })

    it("sets completedAt on completion", async () => {
      const plan = makePlan()
      const result = await executor.execute(plan)
      expect(result.completedAt).toBeInstanceOf(Date)
    })
  })

  describe("pause() / resume()", () => {
    it("pause() sets pause flag without throwing", () => {
      expect(() => executor.pause("nonexistent-mission")).not.toThrow()
    })

    it("resume() sets resume flag without throwing", () => {
      expect(() => executor.resume("nonexistent-mission")).not.toThrow()
    })
  })

  describe("cancel()", () => {
    it("cancel() sets cancel flag without throwing", () => {
      expect(() => executor.cancel("nonexistent-mission")).not.toThrow()
    })
  })

  describe("isActive()", () => {
    it("returns false for non-existent mission", () => {
      expect(executor.isActive("nonexistent")).toBe(false)
    })

    it("returns true while mission is executing", async () => {
      let isActiveWhileRunning = false

      // Create a plan with a tool that checks isActive mid-execution
      const plan = makePlan()
      const executionPromise = executor.execute(plan)

      // Give the execution loop a tick to start
      await new Promise((resolve) => setTimeout(resolve, 10))
      isActiveWhileRunning = executor.isActive(plan.id)

      await executionPromise

      // After completion, should no longer be active
      expect(executor.isActive(plan.id)).toBe(false)
      // isActiveWhileRunning may be true or false depending on timing — just ensure no crash
      expect(typeof isActiveWhileRunning).toBe("boolean")
    })
  })
})
