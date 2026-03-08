/**
 * @file execution.test.ts
 * @description Vitest unit tests for agent execution modules: TaskPlanner, ExecutionMonitor, AgentRunner.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - TaskPlanner (task-planner.ts): decomposes goals into TaskDAG via LLM, validates
 *     structure and detects circular dependencies.
 *   - ExecutionMonitor (execution-monitor.ts): executes individual TaskDAG nodes via
 *     specialized-agents.ts with configurable retry logic and LoopDetector integration.
 *   - AgentRunner (runner.ts): top-level orchestrator — runSingle, runParallel,
 *     runSequential, runWithSupervisor, and ACP message routing.
 *
 *   All external I/O (orchestrator, specialized-agents, ACP router, database, ai SDK,
 *   critic, system-prompt-builder) is mocked so these are pure unit tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoist mock factory refs so vi.mock() closures can reference them
// ---------------------------------------------------------------------------
const { generateMock, runSpecializedAgentMock, critiqueAndRefineMock } = vi.hoisted(() => ({
  generateMock: vi.fn().mockResolvedValue("synthesized result"),
  runSpecializedAgentMock: vi.fn().mockResolvedValue("agent output"),
  critiqueAndRefineMock: vi.fn().mockImplementation(async (_req: unknown, output: string) => ({
    finalResponse: output,
    refined: false,
    iterations: 1,
    critique: { score: 8 },
  })),
}))

// ---------------------------------------------------------------------------
// Module mocks — all declared before the SUT imports
// ---------------------------------------------------------------------------

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: generateMock,
    route: vi.fn().mockReturnValue({}),
  },
}))

vi.mock("../specialized-agents.js", () => ({
  runSpecializedAgent: runSpecializedAgentMock,
}))

vi.mock("../../acp/router.js", () => ({
  acpRouter: {
    registerAgent: vi.fn().mockReturnValue({
      agentId: "runner",
      secret: "test-secret-000000000000000000000000000000000000000000000000000000",
      capabilities: ["runner.execute", "runner.parallel", "runner.supervise", "runner.status", "runner.lats"],
    }),
    send: vi.fn().mockResolvedValue(null),
    request: vi.fn().mockResolvedValue({ payload: { result: "ok" } }),
  },
}))

vi.mock("../../database/index.js", () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../tools.js", () => ({
  edithTools: {},
}))

vi.mock("../../security/tool-guard.js", () => ({
  wrapWithGuard: vi.fn().mockImplementation((tools: unknown) => tools),
}))

vi.mock("../../security/dual-agent-reviewer.js", () => ({
  dualAgentReviewer: {},
  wrapWithDualAgentReview: vi.fn().mockImplementation((tools: unknown) => tools),
}))

vi.mock("../../core/system-prompt-builder.js", () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue("You are EDITH."),
}))

vi.mock("../../core/critic.js", () => ({
  responseCritic: {
    critiqueAndRefine: critiqueAndRefineMock,
  },
}))

vi.mock("../../config/edith-config.js", () => ({
  loadEDITHConfig: vi.fn().mockResolvedValue({ computerUse: {} }),
}))

vi.mock("../lats-planner.js", () => ({
  LATSPlanner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: false, output: "lats failed" }),
  })),
}))

vi.mock("../../security/prompt-filter.js", () => ({
  filterToolResult: vi.fn().mockReturnValue({ safe: true }),
}))

vi.mock("../../sessions/input-provenance.js", () => ({
  tagProvenance: vi.fn().mockImplementation((content: string) => ({
    content,
    provenance: {},
  })),
  provenanceToMetadata: vi.fn().mockReturnValue({}),
}))

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "ai-sdk result" }),
}))

// ---------------------------------------------------------------------------
// SUT imports — after all mocks
// ---------------------------------------------------------------------------

import { TaskPlanner } from "../task-planner.js"
import { ExecutionMonitor } from "../execution-monitor.js"
import { AgentRunner } from "../runner.js"
import { LoopDetector } from "../../core/loop-detector.js"
import type { TaskNode } from "../task-planner.js"
import type { TaskResult } from "../execution-monitor.js"
import type { AgentTask } from "../runner.js"
import type { ACPMessage } from "../../acp/protocol.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal valid TaskNode. */
function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "t1",
    task: "do something",
    agentType: "analyst",
    dependsOn: [],
    maxRetries: 1,
    ...overrides,
  }
}

/** Minimal completed TaskResult for dependency maps. */
function makeResult(nodeId: string, output = "result text", success = true): TaskResult {
  return { nodeId, success, output, attempts: 1, errorHistory: [] }
}

/** Serialise nodes array into the JSON the LLM mock will return. */
function planJson(
  nodes: Array<{
    id: string
    task: string
    agentType: string
    dependsOn: string[]
    maxRetries: number
  }>,
): string {
  return JSON.stringify(nodes)
}

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

describe("TaskPlanner", () => {
  let planner: TaskPlanner

  beforeEach(() => {
    vi.clearAllMocks()
    planner = new TaskPlanner()
  })

  // --- plan() happy path ---------------------------------------------------

  it("plan() returns a valid TaskDAG with correct rootGoal", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([
        { id: "t1", task: "research topic", agentType: "researcher", dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "write summary", agentType: "writer", dependsOn: ["t1"], maxRetries: 1 },
      ]),
    )

    const dag = await planner.plan("research and summarize AI trends")

    expect(dag.rootGoal).toBe("research and summarize AI trends")
    expect(dag.nodes).toHaveLength(2)
    expect(dag.nodes[0]!.id).toBe("t1")
    expect(dag.nodes[1]!.agentType).toBe("writer")
    expect(dag.nodes[1]!.dependsOn).toEqual(["t1"])
  })

  it("plan() strips ```json code-fence wrappers from LLM output", async () => {
    generateMock.mockResolvedValueOnce(
      "```json\n" +
        planJson([{ id: "t1", task: "task", agentType: "coder", dependsOn: [], maxRetries: 1 }]) +
        "\n```",
    )

    const dag = await planner.plan("write some code")

    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]!.agentType).toBe("coder")
  })

  it("plan() clamps maxRetries to 1 for any value other than 2", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([
        { id: "t1", task: "task", agentType: "executor", dependsOn: [], maxRetries: 99 },
      ]),
    )

    const dag = await planner.plan("do a task")

    // normalizeNodes: node.maxRetries === 2 ? 2 : 1
    expect(dag.nodes[0]!.maxRetries).toBe(1)
  })

  // --- plan() fallback on bad LLM output ----------------------------------

  it("plan() falls back to single-task DAG when LLM returns invalid JSON", async () => {
    generateMock.mockResolvedValueOnce("not valid json { broken }")

    const dag = await planner.plan("do the thing")

    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]!.id).toBe("t1")
    expect(dag.nodes[0]!.task).toBe("do the thing")
    expect(dag.nodes[0]!.agentType).toBe("analyst")
  })

  it("plan() falls back to single-task DAG when LLM returns an empty array", async () => {
    generateMock.mockResolvedValueOnce("[]")

    const dag = await planner.plan("a goal")

    expect(dag.nodes).toHaveLength(1)
  })

  it("plan() falls back to single-task DAG when LLM returns a non-array value", async () => {
    generateMock.mockResolvedValueOnce(JSON.stringify({ error: "sorry" }))

    const dag = await planner.plan("a goal")

    expect(dag.nodes).toHaveLength(1)
  })

  // --- plan() max task count enforcement ----------------------------------

  it("plan() enforces a maximum of 8 nodes, silently slicing extras", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i + 1}`,
      task: `task ${i + 1}`,
      agentType: "analyst",
      dependsOn: [],
      maxRetries: 1,
    }))
    generateMock.mockResolvedValueOnce(planJson(nodes))

    const dag = await planner.plan("big goal")

    expect(dag.nodes.length).toBeLessThanOrEqual(8)
  })

  // --- Circular dependency detection --------------------------------------

  it("plan() detects self-dependency and falls back to single-task DAG", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([{ id: "t1", task: "bad", agentType: "analyst", dependsOn: ["t1"], maxRetries: 1 }]),
    )

    const dag = await planner.plan("a goal")

    // validateDAG throws on self-dep → fallback fires
    expect(dag.nodes).toHaveLength(1)
  })

  it("plan() detects A→B→A circular dependency and falls back", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([
        { id: "t1", task: "task 1", agentType: "researcher", dependsOn: ["t2"], maxRetries: 1 },
        { id: "t2", task: "task 2", agentType: "writer", dependsOn: ["t1"], maxRetries: 1 },
      ]),
    )

    const dag = await planner.plan("cyclic goal")

    expect(dag.nodes).toHaveLength(1)
  })

  it("plan() rejects references to non-existent dependency IDs and falls back", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([
        { id: "t1", task: "task", agentType: "analyst", dependsOn: ["ghost"], maxRetries: 1 },
      ]),
    )

    const dag = await planner.plan("goal")

    expect(dag.nodes).toHaveLength(1)
  })

  // --- Single-task plans --------------------------------------------------

  it("plan() processes a single-node plan with empty dependsOn", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([{ id: "t1", task: "just one task", agentType: "executor", dependsOn: [], maxRetries: 1 }]),
    )

    const dag = await planner.plan("simple goal")

    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]!.dependsOn).toEqual([])
  })

  // --- Multi-task plans with dependencies ---------------------------------

  it("plan() builds a three-node sequential dependency chain correctly", async () => {
    generateMock.mockResolvedValueOnce(
      planJson([
        { id: "t1", task: "research", agentType: "researcher", dependsOn: [], maxRetries: 1 },
        { id: "t2", task: "analyze", agentType: "analyst", dependsOn: ["t1"], maxRetries: 2 },
        { id: "t3", task: "review", agentType: "reviewer", dependsOn: ["t2"], maxRetries: 1 },
      ]),
    )

    const dag = await planner.plan("research analyze review")

    expect(dag.nodes).toHaveLength(3)
    expect(dag.nodes[1]!.dependsOn).toContain("t1")
    expect(dag.nodes[2]!.dependsOn).toContain("t2")
  })

  // --- getExecutionOrder --------------------------------------------------

  it("getExecutionOrder() groups independent tasks in the first wave", () => {
    const dag = {
      rootGoal: "goal",
      nodes: [
        makeNode({ id: "t1", dependsOn: [] }),
        makeNode({ id: "t2", dependsOn: [] }),
        makeNode({ id: "t3", dependsOn: ["t1", "t2"] }),
      ],
    }

    const waves = planner.getExecutionOrder(dag)

    expect(waves[0]!.map((n) => n.id).sort()).toEqual(["t1", "t2"])
    expect(waves[1]!.map((n) => n.id)).toEqual(["t3"])
  })

  it("getExecutionOrder() returns a single wave for a single-node DAG", () => {
    const dag = { rootGoal: "goal", nodes: [makeNode({ id: "t1", dependsOn: [] })] }

    const waves = planner.getExecutionOrder(dag)

    expect(waves).toHaveLength(1)
    expect(waves[0]!).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// ExecutionMonitor
// ---------------------------------------------------------------------------

describe("ExecutionMonitor", () => {
  let monitor: ExecutionMonitor

  beforeEach(() => {
    vi.clearAllMocks()
    monitor = new ExecutionMonitor()
    runSpecializedAgentMock.mockResolvedValue("agent output")
  })

  // --- executeNode() success on first try ---------------------------------

  it("executeNode() returns a successful TaskResult on the first attempt", async () => {
    const node = makeNode({ id: "t1", maxRetries: 1 })

    const result = await monitor.executeNode(node, new Map())

    expect(result.success).toBe(true)
    expect(result.nodeId).toBe("t1")
    expect(result.output).toBe("agent output")
    expect(result.attempts).toBe(1)
    expect(result.errorHistory).toHaveLength(0)
  })

  it("executeNode() calls runSpecializedAgent with the correct agentType and task", async () => {
    const node = makeNode({ id: "t1", agentType: "researcher", task: "find info", maxRetries: 1 })

    await monitor.executeNode(node, new Map())

    // No deps and no node.context → context arg is undefined (empty depContext branch)
    expect(runSpecializedAgentMock).toHaveBeenCalledWith(
      "researcher",
      "find info",
      undefined,
    )
  })

  // --- executeNode() retry on failure -------------------------------------

  it("executeNode() retries after a single failure and returns success on second attempt", async () => {
    runSpecializedAgentMock
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce("recovered output")

    const node = makeNode({ id: "t1", maxRetries: 1 })

    const result = await monitor.executeNode(node, new Map())

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)
    expect(result.output).toBe("recovered output")
    expect(result.errorHistory).toHaveLength(1)
  })

  it("executeNode() exhausts retries and returns failure after all attempts (maxRetries=2 → 3 total)", async () => {
    runSpecializedAgentMock.mockRejectedValue(new Error("persistent error"))

    const node = makeNode({ id: "t1", maxRetries: 2 })

    const result = await monitor.executeNode(node, new Map())

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(3)
    expect(result.output).toContain("3 attempts")
  })

  it("executeNode() accumulates all per-attempt errors in errorHistory", async () => {
    runSpecializedAgentMock
      .mockRejectedValueOnce(new Error("error one"))
      .mockRejectedValueOnce(new Error("error two"))
      .mockRejectedValueOnce(new Error("error three"))

    const node = makeNode({ id: "t1", maxRetries: 2 })

    const result = await monitor.executeNode(node, new Map())

    expect(result.errorHistory).toHaveLength(3)
    const joined = result.errorHistory.join(" ")
    expect(joined).toContain("error one")
    expect(joined).toContain("error two")
    expect(joined).toContain("error three")
  })

  // --- executeNode() dependency context -----------------------------------

  it("executeNode() injects dep output as context for dependent nodes", async () => {
    const deps = new Map([["dep1", makeResult("dep1", "dependency output")]])
    const node = makeNode({ id: "t2", dependsOn: ["dep1"] })

    await monitor.executeNode(node, deps)

    const context = runSpecializedAgentMock.mock.calls[0]?.[2] as string | undefined
    expect(context).toContain("dep1")
    expect(context).toContain("dependency output")
  })

  it("executeNode() provides full completedResults context to reviewer agents (all nodes, not just deps)", async () => {
    const completedResults = new Map([
      ["a1", makeResult("a1", "first result")],
      ["a2", makeResult("a2", "second result")],
    ])
    // reviewer with dependsOn=[] should still get all completed results
    const node = makeNode({ id: "t3", agentType: "reviewer", dependsOn: [] })

    await monitor.executeNode(node, completedResults)

    const context = runSpecializedAgentMock.mock.calls[0]?.[2] as string | undefined
    expect(context).toContain("a1")
    expect(context).toContain("a2")
  })

  it("executeNode() provides full completedResults context to analyst agents", async () => {
    const completedResults = new Map([["x1", makeResult("x1", "data point A")]])
    const node = makeNode({ id: "t2", agentType: "analyst", dependsOn: [] })

    await monitor.executeNode(node, completedResults)

    const context = runSpecializedAgentMock.mock.calls[0]?.[2] as string | undefined
    expect(context).toContain("x1")
  })

  // --- executeNode() LoopDetector integration -----------------------------

  it("executeNode() completes normally when LoopDetector returns null (no loop detected)", async () => {
    const loopDetector = new LoopDetector()
    const node = makeNode({ id: "t1" })

    const result = await monitor.executeNode(node, new Map(), loopDetector)

    expect(result.success).toBe(true)
    expect(result.loopBreak).toBeUndefined()
  })

  it("executeNode() sets loopBreak=true and success=false when circuit break fires (5 identical calls)", async () => {
    const loopDetector = new LoopDetector()
    // Pre-load 4 identical records; the 5th (from executeNode) triggers BREAK_THRESHOLD=5
    const identicalOutput = "x".repeat(60) // > MIN_PROGRESS_OUTPUT_CHARS (50)
    for (let i = 0; i < 4; i++) {
      loopDetector.record("specializedAgent", { outputLength: identicalOutput.length }, identicalOutput)
    }
    runSpecializedAgentMock.mockResolvedValue(identicalOutput)

    const node = makeNode({ id: "t1", maxRetries: 1 })
    const result = await monitor.executeNode(node, new Map(), loopDetector)

    expect(result.loopBreak).toBe(true)
    expect(result.success).toBe(false)
    expect(result.loopSignal).toBeDefined()
    expect(result.loopSignal!.shouldStop).toBe(true)
    expect(result.loopSignal!.pattern).toBe("identical-calls")
  })

  it("executeNode() works correctly without a LoopDetector argument (backward compat)", async () => {
    const node = makeNode({ id: "t1" })

    const result = await monitor.executeNode(node, new Map())

    expect(result.success).toBe(true)
    expect(result.loopBreak).toBeUndefined()
    expect(result.loopSignal).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

describe("AgentRunner", () => {
  let runner: AgentRunner

  beforeEach(() => {
    vi.clearAllMocks()
    runner = new AgentRunner()
    runSpecializedAgentMock.mockResolvedValue("task done")
    generateMock.mockResolvedValue("synthesized result")
    critiqueAndRefineMock.mockImplementation(async (_req: unknown, output: string) => ({
      finalResponse: output,
      refined: false,
      iterations: 1,
      critique: { score: 8 },
    }))
  })

  // --- runSingle() --------------------------------------------------------

  it("runSingle() returns an AgentResult with the correct id and a non-empty result", async () => {
    const result = await runner.runSingle({ id: "task-1", task: "explain recursion" })

    expect(result.id).toBe("task-1")
    expect(typeof result.result).toBe("string")
    expect(result.error).toBeUndefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("runSingle() surfaces the LLM output as result text (via critic pass-through)", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValueOnce({ text: "LLM answer here" } as never)
    critiqueAndRefineMock.mockResolvedValueOnce({
      finalResponse: "LLM answer here",
      refined: false,
      iterations: 1,
      critique: { score: 9 },
    })

    const result = await runner.runSingle({ id: "t1", task: "simple question" })

    expect(result.result).toBe("LLM answer here")
  })

  it("runSingle() falls back to orchestrator.generate when generateText throws", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockRejectedValueOnce(new Error("model unavailable"))
    generateMock.mockResolvedValueOnce("orchestrator fallback")
    critiqueAndRefineMock.mockResolvedValueOnce({
      finalResponse: "orchestrator fallback",
      refined: false,
      iterations: 1,
      critique: { score: 7 },
    })

    const result = await runner.runSingle({ id: "t-fallback", task: "question" })

    expect(result.result).toBe("orchestrator fallback")
    expect(result.error).toBeUndefined()
  })

  it("runSingle() returns approvalRequired error for system-scope tasks (sudo keyword)", async () => {
    delete process.env.EDITH_SYSTEM_TOOL_APPROVED

    const result = await runner.runSingle({ id: "sys-1", task: "run sudo restart daemon" })

    expect(result.id).toBe("sys-1")
    expect(result.error).toContain("approval")
  })

  it("runSingle() prefixes the prompt with context when context is provided", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValueOnce({ text: "context-aware answer" } as never)

    await runner.runSingle({
      id: "t-ctx",
      task: "answer the question",
      context: "User is a beginner",
    })

    const callArgs = vi.mocked(generateText).mock.calls[0]?.[0] as { prompt?: string } | undefined
    expect(callArgs?.prompt).toContain("User is a beginner")
    expect(callArgs?.prompt).toContain("answer the question")
  })

  // --- runParallel() -------------------------------------------------------

  it("runParallel() returns a result for every task supplied", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValue({ text: "parallel result" } as never)

    const results = await runner.runParallel([
      { id: "p1", task: "task one" },
      { id: "p2", task: "task two" },
      { id: "p3", task: "task three" },
    ])

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id).sort()).toEqual(["p1", "p2", "p3"])
  })

  it("runParallel() returns results for ALL tasks even when some throw internally", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "ok" } as never)
      .mockRejectedValueOnce(new Error("oops")) // p2 will use orchestrator fallback
      .mockResolvedValueOnce({ text: "ok again" } as never)

    generateMock.mockResolvedValueOnce("fallback for p2")

    const results = await runner.runParallel([
      { id: "p1", task: "task one" },
      { id: "p2", task: "task two" },
      { id: "p3", task: "task three" },
    ])

    expect(results).toHaveLength(3)
    results.forEach((r) => expect(r.id).toBeDefined())
  })

  // --- runSequential() ----------------------------------------------------

  it("runSequential() prepends the previous task result as context for the next task", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "first result" } as never)
      .mockResolvedValueOnce({ text: "second result" } as never)

    critiqueAndRefineMock
      .mockResolvedValueOnce({ finalResponse: "first result", refined: false, iterations: 1, critique: { score: 8 } })
      .mockResolvedValueOnce({ finalResponse: "second result", refined: false, iterations: 1, critique: { score: 8 } })

    const tasks: AgentTask[] = [
      { id: "s1", task: "step one" },
      { id: "s2", task: "step two" },
    ]

    await runner.runSequential(tasks)

    // runSequential mutates task.context in-place: `Previous: ${prev.result}`
    expect(tasks[1]!.context).toContain("first result")
  })

  it("runSequential() returns results in input order", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never)

    const results = await runner.runSequential([
      { id: "s1", task: "first" },
      { id: "s2", task: "second" },
      { id: "s3", task: "third" },
    ])

    expect(results.map((r) => r.id)).toEqual(["s1", "s2", "s3"])
  })

  // --- runWithSupervisor() ------------------------------------------------

  it("runWithSupervisor() returns a non-empty string after synthesizing a multi-node DAG", async () => {
    generateMock
      .mockResolvedValueOnce(
        planJson([
          { id: "t1", task: "research", agentType: "researcher", dependsOn: [], maxRetries: 1 },
          { id: "t2", task: "write", agentType: "writer", dependsOn: ["t1"], maxRetries: 1 },
        ]),
      )
      .mockResolvedValue("final synthesis")

    runSpecializedAgentMock.mockResolvedValue("node output")

    const output = await runner.runWithSupervisor("research and write about AI")

    expect(typeof output).toBe("string")
    expect(output.length).toBeGreaterThan(0)
  })

  it("runWithSupervisor() falls back gracefully when planning returns bad JSON", async () => {
    generateMock
      .mockResolvedValueOnce("not json")  // planner fallback → single-task DAG
      .mockResolvedValue("fallback synthesis")

    runSpecializedAgentMock.mockResolvedValue("fallback output")

    const output = await runner.runWithSupervisor("do a task")

    expect(typeof output).toBe("string")
  })

  it("runWithSupervisor() respects maxSubtasks and executes at most that many nodes", async () => {
    const manyNodes = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i + 1}`,
      task: `task ${i + 1}`,
      agentType: "analyst",
      dependsOn: i === 0 ? [] : [`t${i}`],
      maxRetries: 1,
    }))

    generateMock
      .mockResolvedValueOnce(planJson(manyNodes))
      .mockResolvedValue("synthesized")

    const executedTasks: string[] = []
    runSpecializedAgentMock.mockImplementation(async (_type: unknown, task: unknown) => {
      executedTasks.push(String(task))
      return "output"
    })

    await runner.runWithSupervisor("big goal", 2)

    expect(executedTasks.length).toBeLessThanOrEqual(2)
  })

  // --- ACP message routing ------------------------------------------------

  it("handleACPMessage routes runner.execute to runSingle and returns a signed response message", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValueOnce({ text: "acp result" } as never)
    critiqueAndRefineMock.mockResolvedValueOnce({
      finalResponse: "acp result",
      refined: false,
      iterations: 1,
      critique: { score: 8 },
    })

    const credential = runner.getCredential()
    const { signMessage } = await import("../../acp/protocol.js")

    const msgBase = {
      id: "msg-1",
      from: "runner",
      to: "runner",
      type: "request" as const,
      action: "runner.execute",
      payload: { id: "t1", task: "explain AI", userId: "u1" },
      timestamp: Date.now(),
      state: "requested" as const,
    }
    const message = { ...msgBase, signature: signMessage(msgBase, credential.secret) }

    const response = await (
      runner as unknown as {
        handleACPMessage: (m: typeof message) => Promise<ACPMessage>
      }
    ).handleACPMessage(message)

    expect(response.type).toBe("response")
    expect(response.action).toBe("runner.execute")
    expect(response.correlationId).toBe("msg-1")
    expect(response.state).toBe("done")
  })

  it("handleACPMessage routes runner.parallel to runParallel and returns array payload", async () => {
    const { generateText } = await import("ai")
    vi.mocked(generateText).mockResolvedValue({ text: "parallel acp" } as never)

    const credential = runner.getCredential()
    const { signMessage } = await import("../../acp/protocol.js")

    const msgBase = {
      id: "msg-2",
      from: "runner",
      to: "runner",
      type: "request" as const,
      action: "runner.parallel",
      payload: {
        tasks: [
          { id: "t1", task: "task one" },
          { id: "t2", task: "task two" },
        ],
      },
      timestamp: Date.now(),
      state: "requested" as const,
    }
    const message = { ...msgBase, signature: signMessage(msgBase, credential.secret) }

    const response = await (
      runner as unknown as {
        handleACPMessage: (m: typeof message) => Promise<ACPMessage>
      }
    ).handleACPMessage(message)

    expect(response.action).toBe("runner.parallel")
    expect(Array.isArray(response.payload)).toBe(true)
    expect((response.payload as AgentTask[]).length).toBe(2)
  })

  it("handleACPMessage returns an error payload for unrecognised actions", async () => {
    const credential = runner.getCredential()
    const { signMessage } = await import("../../acp/protocol.js")

    const msgBase = {
      id: "msg-3",
      from: "runner",
      to: "runner",
      type: "request" as const,
      action: "runner.unknown_action",
      payload: {},
      timestamp: Date.now(),
      state: "requested" as const,
    }
    const message = { ...msgBase, signature: signMessage(msgBase, credential.secret) }

    const response = await (
      runner as unknown as {
        handleACPMessage: (m: typeof message) => Promise<ACPMessage>
      }
    ).handleACPMessage(message)

    const payload = response.payload as Record<string, unknown>
    expect(payload).toHaveProperty("error")
    expect(String(payload["error"])).toContain("unknown action")
  })

  // --- limitDagSize() (tested via runWithSupervisor) ----------------------

  it("limitDagSize() strips out-of-bound dependency references from kept nodes without throwing", async () => {
    // t3 depends on t2 (in-bound) and t5 (out-of-bound after trim to maxSubtasks=2)
    const nodes = [
      { id: "t1", task: "t1", agentType: "researcher", dependsOn: [], maxRetries: 1 },
      { id: "t2", task: "t2", agentType: "analyst", dependsOn: ["t1"], maxRetries: 1 },
      { id: "t3", task: "t3", agentType: "writer", dependsOn: ["t2", "t5"], maxRetries: 1 },
      { id: "t4", task: "t4", agentType: "executor", dependsOn: [], maxRetries: 1 },
      { id: "t5", task: "t5", agentType: "reviewer", dependsOn: [], maxRetries: 1 },
    ]

    generateMock.mockResolvedValueOnce(planJson(nodes)).mockResolvedValue("done")
    runSpecializedAgentMock.mockResolvedValue("output")

    // Resolves without throwing because limitDagSize() filters the dangling ref
    await expect(runner.runWithSupervisor("goal", 2)).resolves.toBeDefined()
  })
})
