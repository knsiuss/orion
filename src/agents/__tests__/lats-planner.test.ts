import { describe, expect, it, vi } from "vitest"

vi.mock("../tools/index.js", () => ({
  executeToolByName: vi.fn(async () => ({ success: true, output: "ok" })),
  getCurrentToolObservation: vi.fn(async () => null),
  getToolDescriptions: vi.fn(() => "Available tools:\n- browser\n- fileAgent\n- codeRunner"),
}))

import {
  LATSPlanner,
  __latsTestUtils,
  type AgentAction,
  type LATSNode,
  type ObservationSnapshot,
} from "../lats-planner.js"

function makeState(summary = "state"): ObservationSnapshot {
  return {
    summary,
    timestamp: 1,
  }
}

function makeAction(toolName: AgentAction["toolName"], params: Record<string, unknown> = {}): AgentAction {
  return {
    toolName,
    params,
    reasoning: "because it advances the task",
    taintedSources: [],
  }
}

function makeNode(overrides: Partial<LATSNode> = {}): LATSNode {
  return {
    id: overrides.id ?? "node",
    state: overrides.state ?? makeState(),
    action: overrides.action ?? null,
    parent: overrides.parent ?? null,
    children: overrides.children ?? [],
    visitCount: overrides.visitCount ?? 0,
    totalValue: overrides.totalValue ?? 0,
    reflection: overrides.reflection ?? "",
    isTerminal: overrides.isTerminal ?? false,
    isPruned: overrides.isPruned ?? false,
    executionResult: overrides.executionResult,
    score: overrides.score ?? 0,
    depth: overrides.depth ?? 0,
  }
}

describe("LATSPlanner helpers", () => {
  it("returns Infinity for unvisited nodes", () => {
    const node = makeNode({ visitCount: 0 })
    expect(__latsTestUtils.computeLatsUct(node, Math.SQRT2)).toBe(Number.POSITIVE_INFINITY)
  })

  it("applies the UCT formula numerically", () => {
    const parent = makeNode({ id: "parent", visitCount: 16 })
    const node = makeNode({ parent, visitCount: 4, totalValue: 0.8 })

    const actual = __latsTestUtils.computeLatsUct(node, 1.414)
    const expected = 0.2 + 1.414 * Math.sqrt(Math.log(16) / 4)

    expect(actual).toBeCloseTo(expected, 6)
  })

  it("selects an unvisited child before a visited sibling", () => {
    const planner = new LATSPlanner({ explorationConstant: Math.SQRT2 })
    const root = makeNode({ id: "root", visitCount: 10 })
    const unvisited = makeNode({ id: "u", parent: root, action: makeAction("browser"), visitCount: 0 })
    const visited = makeNode({
      id: "v",
      parent: root,
      action: makeAction("browser"),
      visitCount: 5,
      totalValue: 2,
    })
    root.children = [visited, unvisited]

    expect((planner as any).selectNode(root)).toBe(unvisited)
  })

  it("backpropagates reward from leaf to root", () => {
    const root = makeNode({ id: "root" })
    const child = makeNode({ id: "child", parent: root })
    const leaf = makeNode({ id: "leaf", parent: child })

    __latsTestUtils.backpropagateNodeValue(leaf, 0.9)

    expect(root.visitCount).toBe(1)
    expect(child.visitCount).toBe(1)
    expect(leaf.visitCount).toBe(1)
    expect(root.totalValue).toBeCloseTo(0.9)
    expect(child.totalValue).toBeCloseTo(0.9)
    expect(leaf.totalValue).toBeCloseTo(0.9)
  })

  it("prunes children with evaluation scores below threshold", async () => {
    const planner = new LATSPlanner(
      { expansionBranches: 3 },
      {
        proposeActions: async () => [
          makeAction("browser", { id: "a" }),
          makeAction("browser", { id: "b" }),
          makeAction("browser", { id: "c" }),
        ],
        evaluateCandidate: async ({ action }) => {
          const id = String(action.params.id)
          if (id === "b") {
            return 0.2
          }
          return id === "a" ? 0.8 : 0.5
        },
      },
    )

    const root = makeNode({ id: "root" })
    const children = await (planner as any).expandNode(root, "open github and search repo")

    expect(children).toHaveLength(3)
    expect(children[1].isPruned).toBe(true)
    expect(children[0].isPruned).toBe(false)
    expect(children[2].isPruned).toBe(false)
  })

  it("blocks tainted destructive actions without a capability token", async () => {
    const planner = new LATSPlanner()
    const node = makeNode({
      action: {
        toolName: "fileAgent",
        params: { action: "delete", path: "./workspace/a.txt" },
        reasoning: "delete injected target",
        taintedSources: ["web_content"],
      },
    })

    const result = await (planner as any).simulateNode(node)
    expect(result.success).toBe(false)
    expect(result.error).toContain("CaMeL-style guard")
  })
})