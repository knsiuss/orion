/**
 * @file task-planner.test.ts
 * @description Unit tests for TaskPlanner — DAG construction, validation,
 * cycle detection, fallback, and execution order.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mock orchestrator ─────────────────────────────────────────────────────────
const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: { generate: generateMock },
}))

import { TaskPlanner } from "../task-planner.js"

// ─────────────────────────────────────────────────────────────────────────────
describe("TaskPlanner.plan()", () => {
  let planner: TaskPlanner

  beforeEach(() => {
    planner = new TaskPlanner()
    vi.clearAllMocks()
  })

  it("parses a valid JSON plan from the LLM", async () => {
    generateMock.mockResolvedValue(
      JSON.stringify([
        { id: "t1", task: "Research topic", agentType: "researcher", dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "Write summary", agentType: "writer", dependsOn: ["t1"], maxRetries: 1 },
      ])
    )

    const dag = await planner.plan("Write a report on AI")

    expect(dag.rootGoal).toBe("Write a report on AI")
    expect(dag.nodes).toHaveLength(2)
    expect(dag.nodes[0]?.id).toBe("t1")
    expect(dag.nodes[1]?.agentType).toBe("writer")
    expect(dag.nodes[1]?.dependsOn).toEqual(["t1"])
  })

  it("strips markdown fences from LLM response", async () => {
    generateMock.mockResolvedValue(
      "```json\n[{\"id\":\"t1\",\"task\":\"do it\",\"agentType\":\"analyst\",\"dependsOn\":[],\"maxRetries\":1}]\n```"
    )

    const dag = await planner.plan("Do something")
    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]?.agentType).toBe("analyst")
  })

  it("falls back to single-task DAG when LLM returns invalid JSON", async () => {
    generateMock.mockResolvedValue("not json at all")

    const dag = await planner.plan("Build an app")
    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]?.id).toBe("t1")
    expect(dag.nodes[0]?.task).toBe("Build an app")
  })

  it("falls back when LLM returns empty array", async () => {
    generateMock.mockResolvedValue("[]")

    const dag = await planner.plan("Do something")
    expect(dag.nodes).toHaveLength(1)
  })

  it("falls back when orchestrator throws", async () => {
    generateMock.mockRejectedValue(new Error("network error"))

    const dag = await planner.plan("Goal")
    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]?.task).toBe("Goal")
  })

  it("defaults unknown agentType to analyst fallback node on parse error", async () => {
    generateMock.mockResolvedValue(
      JSON.stringify([
        { id: "t1", task: "Do it", agentType: "INVALID_TYPE", dependsOn: [], maxRetries: 1 },
      ])
    )
    const dag = await planner.plan("Do something")
    // validateDAG or normalizeNodes throws → fallback kicks in
    expect(dag.nodes[0]?.agentType).toBe("analyst")
  })

  it("caps nodes at 8 even if LLM returns more", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i + 1}`,
      task: `Task ${i + 1}`,
      agentType: "analyst",
      dependsOn: [],
      maxRetries: 1,
    }))
    generateMock.mockResolvedValue(JSON.stringify(nodes))

    const dag = await planner.plan("Big goal")
    expect(dag.nodes.length).toBeLessThanOrEqual(8)
  })

  it("rejects plans with duplicate node IDs (fallback)", async () => {
    generateMock.mockResolvedValue(
      JSON.stringify([
        { id: "t1", task: "First", agentType: "analyst", dependsOn: [], maxRetries: 1 },
        { id: "t1", task: "Duplicate", agentType: "writer", dependsOn: [], maxRetries: 1 },
      ])
    )
    const dag = await planner.plan("Test duplicates")
    // Duplicate IDs trigger fallback, single-node result
    expect(dag.nodes).toHaveLength(1)
  })

  it("rejects plans with unknown dependency references (fallback)", async () => {
    generateMock.mockResolvedValue(
      JSON.stringify([
        { id: "t1", task: "Task", agentType: "analyst", dependsOn: ["t99"], maxRetries: 1 },
      ])
    )
    const dag = await planner.plan("Test bad deps")
    expect(dag.nodes).toHaveLength(1)
  })

  it("rejects circular dependencies (fallback)", async () => {
    generateMock.mockResolvedValue(
      JSON.stringify([
        { id: "t1", task: "Task 1", agentType: "analyst", dependsOn: ["t2"], maxRetries: 1 },
        { id: "t2", task: "Task 2", agentType: "analyst", dependsOn: ["t1"], maxRetries: 1 },
      ])
    )
    const dag = await planner.plan("Circular test")
    // Circular deps trigger fallback
    expect(dag.nodes).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("TaskPlanner.getExecutionOrder()", () => {
  let planner: TaskPlanner

  beforeEach(() => {
    planner = new TaskPlanner()
  })

  it("returns independent tasks in the first wave", () => {
    const dag = {
      rootGoal: "test",
      nodes: [
        { id: "t1", task: "A", agentType: "analyst" as const, dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "B", agentType: "writer" as const, dependsOn: [], maxRetries: 1 },
      ],
    }
    const waves = planner.getExecutionOrder(dag)
    expect(waves).toHaveLength(1)
    expect(waves[0]).toHaveLength(2)
  })

  it("separates dependent tasks into sequential waves", () => {
    const dag = {
      rootGoal: "test",
      nodes: [
        { id: "t1", task: "A", agentType: "analyst" as const, dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "B", agentType: "writer" as const, dependsOn: ["t1"], maxRetries: 1 },
        { id: "t3", task: "C", agentType: "reviewer" as const, dependsOn: ["t2"], maxRetries: 1 },
      ],
    }
    const waves = planner.getExecutionOrder(dag)
    expect(waves).toHaveLength(3)
    expect(waves[0]?.[0]?.id).toBe("t1")
    expect(waves[1]?.[0]?.id).toBe("t2")
    expect(waves[2]?.[0]?.id).toBe("t3")
  })

  it("groups parallel tasks in the same wave", () => {
    const dag = {
      rootGoal: "test",
      nodes: [
        { id: "t1", task: "Root", agentType: "analyst" as const, dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "Branch A", agentType: "writer" as const, dependsOn: ["t1"], maxRetries: 1 },
        { id: "t3", task: "Branch B", agentType: "coder" as const, dependsOn: ["t1"], maxRetries: 1 },
        { id: "t4", task: "Final", agentType: "reviewer" as const, dependsOn: ["t2", "t3"], maxRetries: 1 },
      ],
    }
    const waves = planner.getExecutionOrder(dag)
    expect(waves).toHaveLength(3)
    expect(waves[1]).toHaveLength(2) // t2 and t3 in parallel
  })
})
