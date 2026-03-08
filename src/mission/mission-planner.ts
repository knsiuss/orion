/**
 * @file mission-planner.ts
 * @description Decomposes a high-level user goal into a DAG of executable steps.
 *   Uses the LLM orchestrator to generate a structured plan with tool assignments.
 *
 * ARCHITECTURE:
 *   - Input: userId + goal text
 *   - Output: MissionPlan with steps DAG and resource budget
 *   - Called by MissionManager.startMission()
 *   - Steps are assigned to available tools from skillLoader
 *
 * PAPER BASIS:
 *   - LATS: arXiv:2310.04406 — Language Agent Tree Search
 *   - HuggingGPT: arXiv:2303.04671 — LLM as task planner + tool dispatcher
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { MissionPlan, MissionStep } from "./mission-schema.js"

const log = createLogger("mission.planner")

/** Default budget limits for new missions. */
const DEFAULT_MAX_TOOL_CALLS = 20
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_NETWORK_REQUESTS = 10

/** Minimum step count that makes sense for a mission. */
const MIN_STEPS = 1

/** Maximum step count to prevent runaway plans. */
const MAX_STEPS = 15

/**
 * System prompt template for mission decomposition.
 * Instructs the LLM to return a JSON array of steps.
 */
const PLANNING_SYSTEM_PROMPT = `You are a task planning assistant. Given a high-level goal, decompose it into a list of concrete, executable steps.

Each step must have:
- id: unique step ID (step_1, step_2, ...)
- description: what the step does
- toolName: the tool/skill to use (e.g., "web_search", "file_write", "code_execute", "email_send", "memory_save")
- params: JSON object with input parameters for the tool
- dependsOn: array of step IDs this step depends on (empty for first steps)

Rules:
1. Steps must be ordered by dependency (no circular dependencies)
2. Use parallel steps (same dependsOn) when possible
3. Limit to ${MAX_STEPS} steps maximum
4. Return ONLY a JSON array — no prose, no explanation

Example response:
[
  {"id":"step_1","description":"Search for info","toolName":"web_search","params":{"query":"topic"},"dependsOn":[]},
  {"id":"step_2","description":"Save results","toolName":"memory_save","params":{"content":"{{step_1.output}}"},"dependsOn":["step_1"]}
]`

interface RawStep {
  id?: unknown
  description?: unknown
  toolName?: unknown
  params?: unknown
  dependsOn?: unknown
}

/**
 * Validates and normalizes a raw step object from LLM output.
 *
 * @param raw - Raw object from parsed JSON
 * @param index - Step index for fallback ID
 * @returns Normalized MissionStep
 */
function normalizeStep(raw: RawStep, index: number): MissionStep {
  const id = typeof raw.id === "string" && raw.id.trim().length > 0
    ? raw.id.trim()
    : `step_${index + 1}`

  const description = typeof raw.description === "string" && raw.description.trim().length > 0
    ? raw.description.trim()
    : `Step ${index + 1}`

  const toolName = typeof raw.toolName === "string" && raw.toolName.trim().length > 0
    ? raw.toolName.trim()
    : "noop"

  const params = raw.params !== null && typeof raw.params === "object" && !Array.isArray(raw.params)
    ? raw.params as Record<string, unknown>
    : {}

  const dependsOn = Array.isArray(raw.dependsOn)
    ? (raw.dependsOn as unknown[]).filter((d): d is string => typeof d === "string")
    : []

  return {
    id,
    description,
    toolName,
    params,
    dependsOn,
    maxRetries: 2,
    retryCount: 0,
    status: "pending",
  }
}

/**
 * MissionPlanner — decomposes a user goal into a structured MissionPlan.
 *
 * Uses the LLM orchestrator ("reasoning" task type) to generate a step DAG.
 * Validates and normalizes LLM output into typed MissionStep objects.
 */
export class MissionPlanner {
  /**
   * Plans a mission by decomposing the goal into executable steps.
   *
   * @param userId - User requesting the mission
   * @param goal - High-level goal text
   * @param title - Short mission title
   * @returns MissionPlan with steps DAG
   */
  async plan(userId: string, goal: string, title: string): Promise<MissionPlan> {
    log.info("planning mission", { userId, title, goalLength: goal.length })

    const steps = await this.generateSteps(goal)
    const now = new Date()

    const plan: MissionPlan = {
      id: randomUUID(),
      userId,
      title: title.slice(0, 200),
      goal,
      steps,
      budget: {
        maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
        maxDurationMs: DEFAULT_MAX_DURATION_MS,
        maxNetworkRequests: DEFAULT_MAX_NETWORK_REQUESTS,
        usedToolCalls: 0,
        usedNetworkRequests: 0,
      },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }

    log.info("mission plan generated", {
      userId,
      missionId: plan.id,
      stepCount: steps.length,
    })

    return plan
  }

  /**
   * Generates a list of MissionStep objects from the LLM.
   *
   * @param goal - High-level goal text
   * @returns Array of normalized MissionStep objects
   */
  private async generateSteps(goal: string): Promise<MissionStep[]> {
    try {
      const raw = await orchestrator.generate("reasoning", {
        prompt: `Goal: ${goal}\n\nDecompose this goal into executable steps.`,
        systemPrompt: PLANNING_SYSTEM_PROMPT,
        maxTokens: 2000,
        temperature: 0.2,
      })

      const steps = this.parseStepsFromResponse(raw)

      if (steps.length < MIN_STEPS) {
        log.warn("LLM returned no valid steps, using fallback", { goalLength: goal.length })
        return this.fallbackSteps(goal)
      }

      return steps.slice(0, MAX_STEPS)
    } catch (err) {
      log.warn("step generation failed, using fallback", { err })
      return this.fallbackSteps(goal)
    }
  }

  /**
   * Parses and normalizes LLM JSON output into MissionStep array.
   *
   * @param raw - Raw LLM response string
   * @returns Array of MissionStep objects
   */
  private parseStepsFromResponse(raw: string): MissionStep[] {
    // Extract JSON array from response (may be wrapped in markdown)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return []
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[]
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
        .filter((item): item is RawStep => item !== null && typeof item === "object")
        .map((item, index) => normalizeStep(item as RawStep, index))
    } catch {
      return []
    }
  }

  /**
   * Fallback single-step plan when LLM fails.
   *
   * @param goal - User goal text
   * @returns Single-step plan using the reasoning tool
   */
  private fallbackSteps(goal: string): MissionStep[] {
    return [
      {
        id: "step_1",
        description: `Execute goal: ${goal.slice(0, 100)}`,
        toolName: "llm_reasoning",
        params: { goal },
        dependsOn: [],
        maxRetries: 1,
        retryCount: 0,
        status: "pending",
      },
    ]
  }
}

/** Singleton MissionPlanner instance. */
export const missionPlanner = new MissionPlanner()
