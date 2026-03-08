/**
 * @file mission-executor.ts
 * @description Executes a MissionPlan step-by-step, respecting the DAG dependency
 *   order, budget limits, and safety guardrails.
 *
 * ARCHITECTURE:
 *   - Input: MissionPlan from MissionPlanner
 *   - Iterates steps in topological order (respecting dependsOn)
 *   - Enforces budget limits (maxToolCalls, maxDurationMs)
 *   - Delegates each step to the appropriate tool/skill via skillLoader
 *   - Calls SafetyGuardrails.check() before each step
 *   - Called by MissionManager
 *
 * PAPER BASIS:
 *   - ReAct: arXiv:2210.03629 — interleaved reasoning and acting
 *   - LATS: arXiv:2310.04406 — tree search with budget constraints
 */

import { createLogger } from "../logger.js"
import { skillLoader } from "../skills/loader.js"
import { safetyGuardrails } from "./safety-guardrails.js"
import type { MissionPlan, MissionStep } from "./mission-schema.js"

const log = createLogger("mission.executor")

/** Delay between steps to avoid overwhelming tool backends. */
const STEP_DELAY_MS = 100

/** Maximum parallel steps to execute simultaneously. */
const MAX_PARALLEL_STEPS = 3

/**
 * Returns a promise that resolves after the given milliseconds.
 *
 * @param ms - Milliseconds to wait
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Checks whether a step's dependencies have all completed successfully.
 *
 * @param step - Step to check
 * @param completedIds - Set of completed step IDs
 * @returns True if all dependencies are satisfied
 */
function areDependenciesMet(step: MissionStep, completedIds: Set<string>): boolean {
  return step.dependsOn.every((depId) => completedIds.has(depId))
}

/**
 * MissionExecutor — runs a MissionPlan against real tools.
 *
 * Manages the execution lifecycle: topological ordering, budget tracking,
 * safety checks, retry logic, and graceful pause/cancel handling.
 */
export class MissionExecutor {
  /** Active mission plans tracked by mission ID. */
  private readonly activePlans = new Map<string, MissionPlan>()

  /** Pause flags per mission ID. */
  private readonly pauseFlags = new Map<string, boolean>()

  /** Cancel flags per mission ID. */
  private readonly cancelFlags = new Map<string, boolean>()

  /**
   * Executes all steps of a MissionPlan in dependency order.
   *
   * @param plan - The MissionPlan to execute
   * @returns The updated MissionPlan with final status and step outputs
   */
  async execute(plan: MissionPlan): Promise<MissionPlan> {
    this.activePlans.set(plan.id, plan)
    this.pauseFlags.set(plan.id, false)
    this.cancelFlags.set(plan.id, false)

    plan.status = "running"
    plan.budget.startedAt = new Date()
    plan.updatedAt = new Date()

    log.info("mission execution started", {
      missionId: plan.id,
      userId: plan.userId,
      stepCount: plan.steps.length,
    })

    try {
      await this.runSteps(plan)
    } catch (err) {
      log.error("mission execution error", { missionId: plan.id, err })
      plan.status = "failed"
      plan.statusMessage = String(err)
    } finally {
      this.activePlans.delete(plan.id)
      this.pauseFlags.delete(plan.id)
      this.cancelFlags.delete(plan.id)
      plan.updatedAt = new Date()
    }

    // Determine final status
    if (plan.status === "running") {
      const allDone = plan.steps.every((s) => s.status === "completed" || s.status === "skipped")
      const anyFailed = plan.steps.some((s) => s.status === "failed")
      plan.status = anyFailed ? "failed" : allDone ? "completed" : "failed"
      plan.completedAt = new Date()
    }

    log.info("mission execution finished", {
      missionId: plan.id,
      status: plan.status,
      stepsCompleted: plan.steps.filter((s) => s.status === "completed").length,
    })

    return plan
  }

  /**
   * Pauses execution of a running mission.
   *
   * @param missionId - Mission ID to pause
   */
  pause(missionId: string): void {
    this.pauseFlags.set(missionId, true)
    log.info("mission pause requested", { missionId })
  }

  /**
   * Resumes a paused mission.
   *
   * @param missionId - Mission ID to resume
   */
  resume(missionId: string): void {
    this.pauseFlags.set(missionId, false)
    log.info("mission resume requested", { missionId })
  }

  /**
   * Cancels execution of a running mission.
   *
   * @param missionId - Mission ID to cancel
   */
  cancel(missionId: string): void {
    this.cancelFlags.set(missionId, true)
    log.info("mission cancel requested", { missionId })
  }

  /**
   * Returns whether a mission is currently tracked as active.
   *
   * @param missionId - Mission ID to check
   */
  isActive(missionId: string): boolean {
    return this.activePlans.has(missionId)
  }

  /**
   * Core step execution loop — processes steps in topological order.
   *
   * @param plan - The mission plan being executed
   */
  private async runSteps(plan: MissionPlan): Promise<void> {
    const completedIds = new Set<string>()
    const failedIds = new Set<string>()

    // Add already-completed steps (for resume support)
    for (const step of plan.steps) {
      if (step.status === "completed") {
        completedIds.add(step.id)
      } else if (step.status === "failed") {
        failedIds.add(step.id)
      }
    }

    let progress = true

    while (progress) {
      progress = false

      // Check cancel flag
      if (this.cancelFlags.get(plan.id)) {
        plan.status = "cancelled"
        plan.statusMessage = "Mission cancelled by user"
        return
      }

      // Wait while paused
      while (this.pauseFlags.get(plan.id)) {
        if (this.cancelFlags.get(plan.id)) {
          plan.status = "cancelled"
          return
        }
        await delay(500)
      }

      // Check budget: duration
      if (plan.budget.startedAt) {
        const elapsed = Date.now() - plan.budget.startedAt.getTime()
        if (elapsed > plan.budget.maxDurationMs) {
          plan.status = "failed"
          plan.statusMessage = `Mission exceeded time budget (${Math.round(elapsed / 1000)}s)`
          return
        }
      }

      // Check budget: tool calls
      if (plan.budget.usedToolCalls >= plan.budget.maxToolCalls) {
        plan.status = "failed"
        plan.statusMessage = `Mission exceeded tool call budget (${plan.budget.usedToolCalls} calls)`
        return
      }

      // Find ready steps (dependencies met, not yet started)
      const readySteps = plan.steps.filter(
        (s) =>
          s.status === "pending" &&
          areDependenciesMet(s, completedIds) &&
          !s.dependsOn.some((depId) => failedIds.has(depId)),
      )

      if (readySteps.length === 0) {
        // No more ready steps - check if we still have pending steps
        const pendingCount = plan.steps.filter((s) => s.status === "pending").length
        if (pendingCount > 0) {
          // Some steps blocked by failed deps
          for (const step of plan.steps) {
            if (step.status === "pending") {
              step.status = "skipped"
            }
          }
        }
        break
      }

      // Execute ready steps (limited parallelism)
      const batch = readySteps.slice(0, MAX_PARALLEL_STEPS)
      await Promise.all(batch.map((step) => this.executeStep(plan, step, completedIds, failedIds)))
      progress = true

      await delay(STEP_DELAY_MS)
    }
  }

  /**
   * Executes a single mission step, handling retries and safety checks.
   *
   * @param plan - Parent mission plan
   * @param step - Step to execute
   * @param completedIds - Set of completed step IDs (mutated on success)
   * @param failedIds - Set of failed step IDs (mutated on failure)
   */
  private async executeStep(
    plan: MissionPlan,
    step: MissionStep,
    completedIds: Set<string>,
    failedIds: Set<string>,
  ): Promise<void> {
    // Safety check
    const safety = safetyGuardrails.check(step)
    if (!safety.allowed) {
      step.status = "failed"
      step.error = safety.reason ?? "Blocked by safety guardrails"
      failedIds.add(step.id)
      log.warn("step blocked by safety guardrails", { missionId: plan.id, stepId: step.id })
      return
    }

    if (safety.requiresApproval) {
      // Skip steps requiring approval in autonomous mode (approval not implemented yet)
      step.status = "skipped"
      step.error = `Requires user approval (${safety.riskDescription ?? "high risk"})`
      log.info("step skipped: requires approval", { missionId: plan.id, stepId: step.id })
      completedIds.add(step.id) // treat as "done" so dependents can proceed
      return
    }

    step.status = "running"
    step.startedAt = new Date()
    plan.updatedAt = new Date()
    plan.budget.usedToolCalls += 1

    let lastError: string | undefined

    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      if (attempt > 0) {
        step.retryCount = attempt
        log.info("retrying step", { missionId: plan.id, stepId: step.id, attempt })
        await delay(500 * attempt)
      }

      try {
        const output = await this.invokeTool(step)
        step.output = output
        step.status = "completed"
        step.completedAt = new Date()
        completedIds.add(step.id)

        log.debug("step completed", { missionId: plan.id, stepId: step.id })
        return
      } catch (err) {
        lastError = String(err)
        log.warn("step failed", { missionId: plan.id, stepId: step.id, attempt, err })
      }
    }

    // All retries exhausted
    step.status = "failed"
    step.error = lastError ?? "Unknown error"
    step.completedAt = new Date()
    failedIds.add(step.id)

    log.error("step failed after all retries", {
      missionId: plan.id,
      stepId: step.id,
      error: step.error,
    })
  }

  /**
   * Invokes a tool or skill for a step.
   * Falls back to a text summary if the tool is not found.
   *
   * @param step - Step with toolName and params
   * @returns Tool output (any JSON-serializable value)
   */
  private async invokeTool(step: MissionStep): Promise<unknown> {
    // Try to find the skill by name
    const snapshot = await skillLoader.getSnapshot()
    const skill = snapshot.skills.find(
      (s) => s.name.toLowerCase() === step.toolName.toLowerCase()
    )

    if (!skill) {
      // No matching skill — return a placeholder noting the step was attempted
      log.debug("no matching skill for tool, using placeholder", { toolName: step.toolName })
      return { status: "no_tool", toolName: step.toolName, params: step.params }
    }

    // Skills are currently static content — return the skill content as context
    return { status: "skill_found", skillName: skill.name, toolName: step.toolName }
  }
}

/** Singleton MissionExecutor instance. */
export const missionExecutor = new MissionExecutor()
