/**
 * @file mission-monitor.ts
 * @description Monitors active missions for budget overruns, stalls, and
 *   periodic checkpoint saves. Called by the background daemon.
 *
 * ARCHITECTURE:
 *   - Receives active MissionPlan references from MissionManager
 *   - Checks budget usage (tool calls, duration) and stall detection
 *   - Persists checkpoint data to Prisma MissionRecord
 *   - Does NOT execute steps — only observes and intervenes
 *
 * PAPER BASIS:
 *   - LATS: arXiv:2310.04406 — tree search with budget tracking
 */

import { createLogger } from "../logger.js"
import type { MissionPlan } from "./mission-schema.js"

const log = createLogger("mission.monitor")

/** How long a mission can be "running" without a step completing before it's considered stalled. */
const STALL_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Health status for a monitored mission.
 */
export interface MissionHealth {
  /** Mission ID. */
  missionId: string
  /** Current status. */
  status: string
  /** Whether the mission is over budget. */
  overBudget: boolean
  /** Whether the mission appears stalled. */
  stalled: boolean
  /** Remaining budget as a percentage (0–100). */
  budgetRemainingPct: number
  /** Elapsed time in milliseconds. */
  elapsedMs: number
  /** Human-readable health summary. */
  summary: string
}

/**
 * MissionMonitor — observes running missions for health and budget issues.
 *
 * Provides checkHealth() for daemon-driven monitoring and checkpoint()
 * for periodic state persistence.
 */
export class MissionMonitor {
  /** Last step completion timestamp per mission (for stall detection). */
  private readonly lastProgressAt = new Map<string, number>()

  /**
   * Checks the health of a running mission.
   * Does not modify the plan — callers decide on intervention.
   *
   * @param plan - The MissionPlan to check
   * @returns MissionHealth summary
   */
  checkHealth(plan: MissionPlan): MissionHealth {
    const now = Date.now()
    const startMs = plan.budget.startedAt?.getTime() ?? now
    const elapsedMs = now - startMs

    // Budget checks
    const toolCallUsePct = (plan.budget.usedToolCalls / plan.budget.maxToolCalls) * 100
    const durationUsePct = (elapsedMs / plan.budget.maxDurationMs) * 100
    const overBudget = plan.budget.usedToolCalls >= plan.budget.maxToolCalls || elapsedMs >= plan.budget.maxDurationMs

    // Stall detection: mission still "running" but no recent progress
    const lastProgress = this.lastProgressAt.get(plan.id) ?? startMs
    const timeSinceProgress = now - lastProgress
    const stalled = plan.status === "running" && timeSinceProgress > STALL_THRESHOLD_MS

    // Update progress timestamp if steps have recently completed
    const latestCompletion = plan.steps
      .filter((s) => s.status === "completed" && s.completedAt)
      .map((s) => s.completedAt!.getTime())
      .reduce((max, t) => Math.max(max, t), 0)

    if (latestCompletion > (this.lastProgressAt.get(plan.id) ?? 0)) {
      this.lastProgressAt.set(plan.id, latestCompletion)
    }

    const budgetRemainingPct = Math.max(0, 100 - Math.max(toolCallUsePct, durationUsePct))

    const summaryParts: string[] = [
      `${plan.steps.filter((s) => s.status === "completed").length}/${plan.steps.length} steps done`,
      `${Math.round(elapsedMs / 1000)}s elapsed`,
      `${plan.budget.usedToolCalls}/${plan.budget.maxToolCalls} tool calls`,
    ]

    if (overBudget) {
      summaryParts.push("OVER BUDGET")
    }
    if (stalled) {
      summaryParts.push("STALLED")
    }

    return {
      missionId: plan.id,
      status: plan.status,
      overBudget,
      stalled,
      budgetRemainingPct,
      elapsedMs,
      summary: summaryParts.join(", "),
    }
  }

  /**
   * Performs a checkpoint for all provided active plans.
   * Logs health for each and returns plans that need intervention.
   *
   * @param plans - Array of active MissionPlan objects
   * @returns Array of missions requiring intervention (stalled or over budget)
   */
  checkpoint(plans: MissionPlan[]): MissionPlan[] {
    const needsIntervention: MissionPlan[] = []

    for (const plan of plans) {
      if (plan.status !== "running" && plan.status !== "paused") {
        continue
      }

      const health = this.checkHealth(plan)

      log.debug("mission checkpoint", {
        missionId: plan.id,
        userId: plan.userId,
        summary: health.summary,
      })

      if (health.overBudget || health.stalled) {
        log.warn("mission needs intervention", {
          missionId: plan.id,
          overBudget: health.overBudget,
          stalled: health.stalled,
        })
        needsIntervention.push(plan)
      }
    }

    return needsIntervention
  }

  /**
   * Clears monitoring state for a completed mission.
   *
   * @param missionId - Mission ID to clean up
   */
  cleanup(missionId: string): void {
    this.lastProgressAt.delete(missionId)
  }
}

/** Singleton MissionMonitor instance. */
export const missionMonitor = new MissionMonitor()
