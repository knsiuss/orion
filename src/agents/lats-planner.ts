import crypto from "node:crypto"

import { createLogger } from "../logger.js"
import { camelGuard, type TaintSource } from "../security/camel-guard.js"
import {
  executeToolByName,
  getCurrentToolObservation,
  getToolDescriptions,
  type ToolName,
  type ToolResult,
} from "./tools/index.js"

const log = createLogger("agents.lats-planner")

const DEFAULT_MAX_EPISODES = 30
const DEFAULT_MAX_STEPS_PER_EPISODE = 20
const DEFAULT_EXPLORATION_CONSTANT = Math.SQRT2
const DEFAULT_EXPANSION_BRANCHES = 3
const DEFAULT_TASK_TIMEOUT_MS = 120_000
const DEFAULT_PRUNE_THRESHOLD = 0.3
const DEFAULT_TERMINAL_THRESHOLD = 0.95

export interface ObservationSnapshot {
  summary: string
  timestamp: number
  taintedSources: TaintSource[]
  url?: string
  title?: string
  elements?: Array<{
    id: string
    description: string
  }>
}

export interface AgentAction {
  toolName: ToolName
  params: Record<string, unknown>
  reasoning: string
  taintedSources: TaintSource[]
}

export interface LATSNode {
  id: string
  state: ObservationSnapshot
  action: AgentAction | null
  parent: LATSNode | null
  children: LATSNode[]
  visitCount: number
  totalValue: number
  reflection: string
  isTerminal: boolean
  isPruned: boolean
  executionResult?: ToolResult
  score: number
  depth: number
}

export interface LATSResult {
  success: boolean
  output: string
  path: LATSNode[]
  totalEpisodes: number
  totalSteps: number
  durationMs: number
}

export interface ComputerUseConfig {
  enabled?: boolean
  planner?: "lats" | "dag"
  fallbackPlanner?: "dag"
  maxEpisodes?: number
  maxStepsPerEpisode?: number
  explorationConstant?: number
  expansionBranches?: number
  taskTimeoutMs?: number
}

export interface LATSDeps {
  actorId?: string
  captureSnapshot?: () => Promise<ObservationSnapshot>
  proposeActions?: (input: {
    goal: string
    state: ObservationSnapshot
    reflection: string
    branchCount: number
    toolDescriptions: string
  }) => Promise<AgentAction[]>
  evaluateCandidate?: (input: {
    goal: string
    state: ObservationSnapshot
    action: AgentAction
  }) => Promise<number>
  evaluateState?: (input: {
    goal: string
    node: LATSNode
    result: ToolResult
  }) => Promise<number>
  reflect?: (input: {
    goal: string
    node: LATSNode
    result: ToolResult
  }) => Promise<string>
  executeTool?: (action: AgentAction) => Promise<ToolResult>
}

function clipText(value: string, maxChars = 1_200): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars - 3)}...`
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function generateReasoningText(prompt: string): Promise<string> {
  const { orchestrator } = await import("../engines/orchestrator.js")
  return orchestrator.generate("reasoning", { prompt })
}

function normalizeCandidateScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function summarizeAction(action: AgentAction): string {
  return `${action.toolName}: ${clipText(JSON.stringify(action.params), 180)}`
}

function buildPath(node: LATSNode): LATSNode[] {
  const path: LATSNode[] = []
  let current: LATSNode | null = node

  while (current) {
    path.push(current)
    current = current.parent
  }

  return path.reverse()
}

function mergeTaintSources(...taintLists: TaintSource[][]): TaintSource[] {
  return Array.from(new Set(taintLists.flat()))
}

function summarizeBrowserObservation(observation: {
  title: string
  url: string
  content: string
  elements: Array<{ id: string; text: string; role: string; tag: string }>
}): string {
  const elementSummary = observation.elements
    .slice(0, 10)
    .map((element) => `${element.id}:${element.tag}:${element.text || element.role || "untitled"}`)
    .join(", ")

  return clipText([
    `Title: ${observation.title}`,
    `URL: ${observation.url}`,
    `Content: ${observation.content}`,
    elementSummary ? `Elements: ${elementSummary}` : "",
  ].filter(Boolean).join("\n"))
}

export function computeLatsUct(node: LATSNode, explorationConstant: number): number {
  if (node.visitCount === 0) {
    return Number.POSITIVE_INFINITY
  }

  const parentVisits = Math.max(node.parent?.visitCount ?? node.visitCount, 1)
  const averageValue = node.totalValue / node.visitCount

  // Tony Stark rule: every branch earns its place via measured progress, not vibes.
  // UCT(v) = V(v) + c * sqrt(ln(N_parent) / N(v))
  return averageValue + explorationConstant * Math.sqrt(Math.log(parentVisits) / node.visitCount)
}

export function backpropagateNodeValue(node: LATSNode, reward: number): void {
  let current: LATSNode | null = node

  while (current) {
    current.visitCount += 1

    // Elon-style first principles: keep the running sum, derive the mean from physics.
    // V(s) = (V_old(s) * (N(s)-1) + r) / N(s)
    current.totalValue += reward
    current = current.parent
  }
}

export class LATSPlanner {
  private readonly config: Required<ComputerUseConfig>
  private readonly deps: LATSDeps

  /**
   * LATSPlanner — tree search for iterative computer-use goals.
   * Think like Tony Stark: keep the suit modular. Think like Elon Musk: strip the loop to first principles.
   */
  constructor(config: ComputerUseConfig = {}, deps: LATSDeps = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      planner: config.planner ?? "lats",
      fallbackPlanner: config.fallbackPlanner ?? "dag",
      maxEpisodes: Math.max(1, config.maxEpisodes ?? DEFAULT_MAX_EPISODES),
      maxStepsPerEpisode: Math.max(1, config.maxStepsPerEpisode ?? DEFAULT_MAX_STEPS_PER_EPISODE),
      explorationConstant: config.explorationConstant ?? DEFAULT_EXPLORATION_CONSTANT,
      expansionBranches: Math.max(1, config.expansionBranches ?? DEFAULT_EXPANSION_BRANCHES),
      taskTimeoutMs: Math.max(1_000, config.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS),
    }
    this.deps = deps
  }

  /**
   * Main entry point for LATS execution.
   */
  async run(goal: string): Promise<LATSResult> {
    const startedAt = Date.now()
    const root = this.createRootNode(await this.captureSnapshot())
    let bestNode = root
    let totalSteps = 0

    for (let episode = 1; episode <= this.config.maxEpisodes; episode += 1) {
      if (Date.now() - startedAt > this.config.taskTimeoutMs) {
        throw new Error(`LATS timed out after ${this.config.taskTimeoutMs}ms`)
      }

      const node = this.selectNode(root)
      let candidate: LATSNode | undefined

      if (node.action && node.visitCount === 0) {
        candidate = node
      } else {
        const children = node.children.length > 0 ? node.children : await this.expandNode(node, goal)
        candidate = children
          .filter((child) => !child.isPruned)
          .sort((left, right) => right.score - left.score)[0]
      }

      if (!candidate) {
        node.isPruned = true
        continue
      }

      const result = await this.simulateNode(candidate)
      totalSteps += 1
      candidate.executionResult = result
      candidate.state = await this.captureSnapshot(result)
      candidate.score = await this.evaluateState(candidate, goal)
      candidate.isTerminal = candidate.score >= DEFAULT_TERMINAL_THRESHOLD && result.success
      candidate.reflection = await this.reflectNode(candidate, result, goal)
      this.backpropagate(candidate, candidate.score)

      if (candidate.score >= bestNode.score) {
        bestNode = candidate
      }

      log.info("lats episode completed", {
        episode,
        tool: candidate.action?.toolName,
        success: result.success,
        score: candidate.score,
      })

      if (candidate.isTerminal || totalSteps >= this.config.maxStepsPerEpisode) {
        return this.buildResult(bestNode, episode, totalSteps, startedAt)
      }
    }

    return this.buildResult(bestNode, this.config.maxEpisodes, totalSteps, startedAt)
  }

  /**
   * UCT(v) = V(v) + c * sqrt(ln(N_parent) / N(v))
   */
  private computeUCT(node: LATSNode): number {
    return computeLatsUct(node, this.config.explorationConstant)
  }

  private createRootNode(state: ObservationSnapshot): LATSNode {
    return {
      id: crypto.randomUUID(),
      state,
      action: null,
      parent: null,
      children: [],
      visitCount: 0,
      totalValue: 0,
      reflection: "",
      isTerminal: false,
      isPruned: false,
      score: 0,
      depth: 0,
    }
  }

  private selectNode(root: LATSNode): LATSNode {
    let current = root

    while (current.children.length > 0) {
      const candidates = current.children.filter((child) => !child.isPruned)
      if (candidates.length === 0) {
        return current
      }

      const next = candidates.reduce((best, child) =>
        this.computeUCT(child) > this.computeUCT(best) ? child : best,
      )

      if (next.visitCount === 0 || next.isTerminal || next.children.length === 0) {
        return next
      }

      current = next
    }

    return current
  }

  private async expandNode(node: LATSNode, goal: string): Promise<LATSNode[]> {
    const actions = await this.proposeActions(goal, node)
    const children: LATSNode[] = []

    for (const action of actions.slice(0, this.config.expansionBranches)) {
      const score = await this.evaluateCandidate(node, goal, action)
      const child: LATSNode = {
        id: crypto.randomUUID(),
        state: node.state,
        action,
        parent: node,
        children: [],
        visitCount: 0,
        totalValue: 0,
        reflection: "",
        isTerminal: false,
        isPruned: score < DEFAULT_PRUNE_THRESHOLD,
        score,
        depth: node.depth + 1,
      }
      children.push(child)
    }

    node.children = children
    return children
  }

  private async simulateNode(node: LATSNode): Promise<ToolResult> {
    if (!node.action) {
      return {
        success: false,
        output: "",
        error: "Root node does not have an action",
        taintSources: [],
      }
    }

    if (this.isTaintedActionBlocked(node.action)) {
      const actionName = typeof node.action.params.action === "string" ? node.action.params.action : "execute"
      const guardResult = camelGuard.check({
        actorId: this.deps.actorId ?? "lats",
        toolName: node.action.toolName,
        action: actionName,
        taintedSources: node.action.taintedSources,
        capabilityToken:
          typeof node.action.params.capabilityToken === "string" ? node.action.params.capabilityToken : undefined,
      })
      return {
        success: false,
        output: "",
        error: guardResult.reason ?? "CaMeL-style guard blocked tainted action without capability token",
        taintSources: [],
      }
    }

    if (this.deps.executeTool) {
      return this.deps.executeTool(node.action)
    }

    return executeToolByName(node.action.toolName, node.action.params, {
      actorId: this.deps.actorId ?? "lats",
    })
  }

  private async reflectNode(node: LATSNode, result: ToolResult, goal: string): Promise<string> {
    if (result.success) {
      return ""
    }

    if (this.deps.reflect) {
      return this.deps.reflect({ goal, node, result })
    }

    const prompt = [
      "You are reflecting on a failed computer-use step.",
      `Goal: ${goal}`,
      `Attempted action: ${node.action ? summarizeAction(node.action) : "unknown"}`,
      `Failure: ${result.error ?? result.output}`,
      "Return one short lesson learned sentence.",
    ].join("\n")

    return clipText(await generateReasoningText(prompt), 240)
  }

  /**
   * V(s) = (V_old(s) * (N(s)-1) + r) / N(s)
   */
  private backpropagate(node: LATSNode, reward: number): void {
    backpropagateNodeValue(node, reward)
  }

  private async evaluateState(node: LATSNode, goal: string): Promise<number> {
    const result = node.executionResult ?? { success: false, output: "", taintSources: [] }

    if (this.deps.evaluateState) {
      return normalizeCandidateScore(await this.deps.evaluateState({ goal, node, result }))
    }

    if (!result.success) {
      return 0.1
    }

    const prompt = [
      "Score this post-action state for progress toward the goal on a 0..1 scale.",
      `Goal: ${goal}`,
      `Action: ${node.action ? summarizeAction(node.action) : "unknown"}`,
      `Observation: ${clipText(node.state.summary, 900)}`,
      "Return JSON only: {\"score\":0.0}",
    ].join("\n")

    const raw = await generateReasoningText(prompt)
    const parsed = safeJsonParse<{ score?: number }>(raw.replace(/```json|```/g, "").trim(), {})
    return normalizeCandidateScore(parsed.score ?? 0.5)
  }

  private async proposeActions(goal: string, node: LATSNode): Promise<AgentAction[]> {
    if (this.deps.proposeActions) {
      const proposedActions = await this.deps.proposeActions({
        goal,
        state: node.state,
        reflection: node.reflection,
        branchCount: this.config.expansionBranches,
        toolDescriptions: getToolDescriptions(),
      })

      return proposedActions.map((action) => ({
        ...action,
        taintedSources: mergeTaintSources(node.state.taintedSources, action.taintedSources ?? []),
      }))
    }

    const prompt = [
      "You are planning the next computer-use move.",
      `Goal: ${goal}`,
      `Current state: ${clipText(node.state.summary, 900)}`,
      node.reflection ? `Previous lesson: ${node.reflection}` : "",
      getToolDescriptions(),
      `Return up to ${this.config.expansionBranches} JSON actions only.`,
      "Schema: [{\"toolName\":\"browser\",\"params\":{},\"reasoning\":\"...\",\"taintedSources\":[]}]",
    ]
      .filter(Boolean)
      .join("\n")

    const raw = await generateReasoningText(prompt)
    const parsed = safeJsonParse<AgentAction[]>(raw.replace(/```json|```/g, "").trim(), [])

    return parsed
      .filter((action) => action && typeof action.toolName === "string")
      .map((action) => ({
        toolName: action.toolName,
        params: action.params ?? {},
        reasoning: clipText(action.reasoning ?? "", 240),
        taintedSources: mergeTaintSources(
          node.state.taintedSources,
          Array.isArray(action.taintedSources)
            ? action.taintedSources.filter((item): item is TaintSource => typeof item === "string")
            : [],
        ),
      }))
  }

  private async evaluateCandidate(
    node: LATSNode,
    goal: string,
    action: AgentAction,
  ): Promise<number> {
    if (this.deps.evaluateCandidate) {
      return normalizeCandidateScore(await this.deps.evaluateCandidate({ goal, state: node.state, action }))
    }

    if (action.toolName === "browser") {
      return 0.75
    }

    if (action.toolName === "fileAgent") {
      const operation = typeof action.params.action === "string" ? action.params.action : ""
      return operation === "delete" ? 0.25 : 0.6
    }

    return 0.55
  }

  private async captureSnapshot(result?: ToolResult): Promise<ObservationSnapshot> {
    if (this.deps.captureSnapshot) {
      return this.deps.captureSnapshot()
    }

    const observation = result?.observation ?? await getCurrentToolObservation("browser")
    if (observation) {
      return {
        summary: summarizeBrowserObservation(observation),
        timestamp: observation.timestamp,
        url: observation.url,
        title: observation.title,
        elements: observation.elements.map((element) => ({
          id: element.id,
          description: clipText(`${element.tag} ${element.text || element.ariaLabel || element.role || "untitled"}`, 120),
        })),
        taintedSources: result?.taintSources ?? ["web_content"],
      }
    }

    return {
      summary: clipText(result?.output || result?.error || "No external observation available."),
      timestamp: Date.now(),
      taintedSources: result?.taintSources ?? [],
    }
  }

  private buildResult(
    node: LATSNode,
    totalEpisodes: number,
    totalSteps: number,
    startedAt: number,
  ): LATSResult {
    const path = buildPath(node)
    const output = node.executionResult?.output || node.executionResult?.error || node.state.summary

    return {
      success: node.isTerminal,
      output,
      path,
      totalEpisodes,
      totalSteps,
      durationMs: Date.now() - startedAt,
    }
  }

  private isTaintedActionBlocked(action: AgentAction): boolean {
    if (action.taintedSources.length === 0) {
      return false
    }

    const actionName = typeof action.params.action === "string" ? action.params.action : "execute"
    return !camelGuard.check({
      actorId: this.deps.actorId ?? "lats",
      toolName: action.toolName,
      action: actionName,
      taintedSources: action.taintedSources,
      capabilityToken: typeof action.params.capabilityToken === "string" ? action.params.capabilityToken : undefined,
    }).allowed
  }
}

export const __latsTestUtils = {
  computeLatsUct,
  backpropagateNodeValue,
}