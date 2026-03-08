import { beforeEach, describe, expect, it, vi } from "vitest"

import { camelGuard } from "../../security/camel-guard.js"

const { generateReasoningMock } = vi.hoisted(() => ({
  generateReasoningMock: vi.fn(async () => ""),
}))

vi.mock("../tools/index.js", () => ({
  executeToolByName: vi.fn(async () => ({ success: true, output: "ok", taintSources: [] })),
  getCurrentToolObservation: vi.fn(async () => null),
  getToolDescriptions: vi.fn(() => "Available tools:\n- browser\n- fileAgent\n- codeRunner"),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: generateReasoningMock,
  },
}))

import * as toolIndex from "../tools/index.js"
import { orchestrator } from "../../engines/orchestrator.js"
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
    taintedSources: [],
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
  beforeEach(() => {
    vi.clearAllMocks()
    generateReasoningMock.mockResolvedValue("")
  })

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
    expect(result.error).toContain("CaMeL guard blocked")
  })

  it("merges tainted observation context into the next proposed action set", async () => {
    const planner = new LATSPlanner({ expansionBranches: 1 }, {
      proposeActions: async () => [makeAction("codeRunner", { script: "print(1)" })],
    })

    const root = makeNode({
      state: {
        summary: "browser returned unsafe instruction",
        timestamp: 1,
        taintedSources: ["web_content"],
      },
    })

    const children = await (planner as any).expandNode(root, "summarize the page")
    expect(children[0].action?.taintedSources).toEqual(["web_content"])
  })

  it("parses default orchestrator proposals and merges reflection taint metadata", async () => {
    generateReasoningMock.mockResolvedValueOnce("```json\n[\n  {\n    \"toolName\": \"browser\",\n    \"params\": { \"action\": \"extract\", \"extractType\": \"text\" },\n    \"reasoning\": \"Read the current page carefully.\",\n    \"taintedSources\": [\"code_output\", 42]\n  },\n  {\n    \"params\": { \"ignored\": true }\n  }\n]\n```")
    const planner = new LATSPlanner({ expansionBranches: 2 })
    const node = makeNode({
      state: {
        summary: "page contains suspicious instructions",
        timestamp: 10,
        taintedSources: ["web_content"],
      },
      reflection: "Prefer extraction before taking actions.",
    })

    const actions = await (planner as any).proposeActions("summarize the current page", node)

    expect(actions).toEqual([
      {
        toolName: "browser",
        params: { action: "extract", extractType: "text" },
        reasoning: "Read the current page carefully.",
        taintedSources: ["web_content", "code_output"],
      },
    ])
    expect(vi.mocked(orchestrator.generate)).toHaveBeenCalledWith("reasoning", {
      prompt: expect.stringContaining("Previous lesson: Prefer extraction before taking actions."),
    })
  })

  it("captures browser observations into planner snapshots with taint metadata", async () => {
    const planner = new LATSPlanner()
    const snapshot = await (planner as any).captureSnapshot({
      success: true,
      output: "ok",
      taintSources: ["web_content"],
      observation: {
        title: "GitHub",
        url: "https://github.com",
        content: "EDITH repo description",
        elements: [
          {
            id: "e01",
            tag: "a",
            text: "EDITH",
            role: "link",
            ariaLabel: "",
            placeholder: "",
            href: "https://github.com/knsiuss/orion",
            isVisible: true,
          },
        ],
        timestamp: 123,
      },
    })

    expect(snapshot.summary).toContain("GitHub")
    expect(snapshot.url).toBe("https://github.com")
    expect(snapshot.taintedSources).toEqual(["web_content"])
    expect(snapshot.elements?.[0].id).toBe("e01")
  })

  it("allows a tainted destructive action when a valid capability token is present", async () => {
    const token = camelGuard.issueCapabilityToken({
      actorId: "lats",
      toolName: "fileAgent",
      action: "delete",
      taintedSources: ["web_content"],
    })
    const planner = new LATSPlanner({}, {
      executeTool: async () => ({ success: true, output: "deleted", taintSources: [] }),
    })
    const node = makeNode({
      action: {
        toolName: "fileAgent",
        params: { action: "delete", path: "./workspace/a.txt", capabilityToken: token },
        reasoning: "authorized cleanup",
        taintedSources: ["web_content"],
      },
    })

    const result = await (planner as any).simulateNode(node)
    expect(result.success).toBe(true)
    expect(result.output).toBe("deleted")
  })

  it("injects reflection into the next expansion prompt after a failure", async () => {
    const proposeCalls: Array<{ reflection: string }> = []
    const planner = new LATSPlanner({ expansionBranches: 1 }, {
      proposeActions: async (input) => {
        proposeCalls.push({ reflection: input.reflection })
        return [makeAction("browser", { action: "extract", extractType: "text" })]
      },
    })

    const node = makeNode({
      id: "failed-node",
      state: makeState("browser failed"),
      reflection: "Use a different selector after element-not-found.",
    })

    await (planner as any).proposeActions("recover from browser failure", node)
    expect(proposeCalls[0]?.reflection).toContain("different selector")
  })

  it("marks a node terminal when a successful step reaches the terminal threshold", async () => {
    const planner = new LATSPlanner({}, {
      captureSnapshot: async () => makeState("done"),
      proposeActions: async () => [makeAction("browser", { action: "extract" })],
      executeTool: async () => ({ success: true, output: "done", taintSources: ["web_content"] }),
      evaluateCandidate: async () => 0.9,
      evaluateState: async () => 0.98,
    })

    const result = await planner.run("extract the repository description")
    expect(result.success).toBe(true)
    expect(result.totalSteps).toBe(1)
  })

  it("solves the mocked GitHub description flow end-to-end", async () => {
    let step = 0
    const planner = new LATSPlanner({ maxEpisodes: 3, expansionBranches: 1 }, {
      captureSnapshot: async () => {
        if (step === 0) {
          return { summary: "blank page", timestamp: 1, taintedSources: [] }
        }
        return {
          summary: "GitHub repo page with description: Personal AI companion platform.",
          timestamp: 2,
          taintedSources: ["web_content"],
        }
      },
      proposeActions: async ({ state }) => {
        if (state.summary.includes("blank page")) {
          return [makeAction("browser", { action: "navigate", url: "https://github.com/knsiuss/orion" })]
        }
        return [makeAction("browser", { action: "extract", extractType: "text" })]
      },
      executeTool: async (action) => {
        step += 1
        if (action.params.action === "navigate") {
          return { success: true, output: "navigated", taintSources: ["web_content"] }
        }
        return { success: true, output: "Personal AI companion platform.", taintSources: ["web_content"] }
      },
      evaluateCandidate: async () => 0.85,
      evaluateState: async ({ result }) => result.output.includes("Personal AI companion platform") ? 0.99 : 0.6,
    })

    const result = await planner.run("open github and get the repository description")
    expect(result.success).toBe(true)
    expect(result.output).toContain("Personal AI companion platform")
  })

  it("tries an alternative path after the first browser action fails", async () => {
    const actionOrder: string[] = []
    const planner = new LATSPlanner({ maxEpisodes: 3, expansionBranches: 2 }, {
      captureSnapshot: async () => ({ summary: "github search results", timestamp: Date.now(), taintedSources: ["web_content"] }),
      proposeActions: async () => [
        makeAction("browser", { action: "click_element", edithId: "e404" }),
        makeAction("browser", { action: "extract", extractType: "text" }),
      ],
      executeTool: async (action) => {
        actionOrder.push(String(action.params.action))
        if (action.params.action === "click_element") {
          return { success: false, output: "", error: "element not found", taintSources: [] }
        }
        return { success: true, output: "repo description found", taintSources: ["web_content"] }
      },
      evaluateCandidate: async ({ action }) => action.params.action === "click_element" ? 0.8 : 0.7,
      evaluateState: async ({ result }) => result.success ? 0.99 : 0.1,
      reflect: async () => "element not found; try extracting current page instead",
    })

    const result = await planner.run("get the repo description")
    expect(result.success).toBe(true)
    expect(actionOrder).toEqual(["click_element", "extract"])
    expect(result.totalSteps).toBe(2)
  })

  it("blocks tainted code execution without a capability token", async () => {
    const planner = new LATSPlanner()
    const node = makeNode({
      action: {
        toolName: "codeRunner",
        params: { language: "python", code: "print('boom')" },
        reasoning: "execute code copied from the page",
        taintedSources: ["web_content"],
      },
    })

    const result = await (planner as any).simulateNode(node)
    expect(result.success).toBe(false)
    expect(result.error).toContain("codeRunner.execute")
  })

  it("scores fileAgent delete lower than reversible file actions", async () => {
    const planner = new LATSPlanner()
    const node = makeNode({ state: makeState("workspace tree") })

    await expect((planner as any).evaluateCandidate(node, "inspect page", makeAction("browser", { action: "extract" }))).resolves.toBe(0.75)
    await expect((planner as any).evaluateCandidate(node, "clean up", makeAction("fileAgent", { action: "delete" }))).resolves.toBe(0.25)
    await expect((planner as any).evaluateCandidate(node, "write summary", makeAction("fileAgent", { action: "write" }))).resolves.toBe(0.6)
    await expect((planner as any).evaluateCandidate(node, "run script", makeAction("codeRunner", { language: "python" }))).resolves.toBe(0.55)
  })

  it("uses the default evaluator to parse JSON scores from the reasoning model", async () => {
    generateReasoningMock.mockResolvedValueOnce("```json\n{\"score\": 0.88}\n```")
    const planner = new LATSPlanner()
    const node = makeNode({
      action: makeAction("browser", { action: "extract" }),
      state: makeState("repository description visible"),
      executionResult: { success: true, output: "description found", taintSources: ["web_content"] },
    })

    const score = await (planner as any).evaluateState(node, "get the repository description")

    expect(score).toBe(0.88)
    expect(vi.mocked(orchestrator.generate)).toHaveBeenCalledWith("reasoning", {
      prompt: expect.stringContaining("Observation: repository description visible"),
    })
  })

  it("captures browser observation from the tool registry when no direct result observation exists", async () => {
    vi.mocked(toolIndex.getCurrentToolObservation).mockResolvedValueOnce({
      title: "GitHub Repo",
      url: "https://github.com/knsiuss/orion",
      content: "Repo description here",
      elements: [],
      timestamp: 77,
    })
    const planner = new LATSPlanner()

    const snapshot = await (planner as any).captureSnapshot()

    expect(snapshot.title).toBe("GitHub Repo")
    expect(snapshot.taintedSources).toEqual(["web_content"])
  })

  it("falls back to raw tool output when no browser observation is available", async () => {
    vi.mocked(toolIndex.getCurrentToolObservation).mockResolvedValueOnce(null)
    const planner = new LATSPlanner()

    const snapshot = await (planner as any).captureSnapshot({
      success: false,
      output: "",
      error: "no observation returned",
      taintSources: ["code_output"],
    })

    expect(snapshot.summary).toContain("no observation returned")
    expect(snapshot.taintedSources).toEqual(["code_output"])
  })
})