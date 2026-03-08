/**
 * @file mission-manager.ts
 * @description Facade for autonomous mission lifecycle: start/pause/resume/cancel/status.
 *
 * ARCHITECTURE:
 *   - Wraps MissionPlanner, MissionExecutor, MissionMonitor, and MissionReporter
 *   - Persists missions to MissionRecord via Prisma
 *   - Called from mission-skill.ts and daemon.ts
 *   - Maintains a registry of active mission plans in memory
 *
 * PAPER BASIS:
 *   - LATS: arXiv:2310.04406 — Language Agent Tree Search lifecycle management
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { Prisma } from "@prisma/client"
import { missionPlanner } from "./mission-planner.js"
import { missionExecutor } from "./mission-executor.js"
import { missionMonitor } from "./mission-monitor.js"
import { missionReporter } from "./mission-reporter.js"
import type { MissionPlan, MissionReport } from "./mission-schema.js"

const log = createLogger("mission.manager")

/**
 * Result of a startMission() call.
 */
export interface StartMissionResult {
  /** Mission ID assigned to this mission. */
  missionId: string
  /** Human-readable status message. */
  message: string
}

/**
 * MissionManager — central facade for the Phase 22 autonomous mission system.
 *
 * Coordinates planning → execution → monitoring → reporting.
 * Persists state to Prisma MissionRecord for audit and resumption.
 */
export class MissionManager {
  /** Active mission plans keyed by missionId. */
  private readonly activeMissions = new Map<string, MissionPlan>()

  /**
   * Plans and starts a new mission for the given user.
   * Execution runs asynchronously — returns immediately with the mission ID.
   *
   * @param userId - User requesting the mission
   * @param goal - High-level goal text
   * @param title - Short title for the mission
   * @returns StartMissionResult with missionId and status message
   */
  async startMission(userId: string, goal: string, title: string): Promise<StartMissionResult> {
    log.info("starting mission", { userId, title })

    // Plan the mission
    const plan = await missionPlanner.plan(userId, goal, title)
    this.activeMissions.set(plan.id, plan)

    // Persist initial state to Prisma
    await this.persistPlan(plan, null).catch((err) =>
      log.warn("failed to persist mission plan", { missionId: plan.id, err }),
    )

    // Execute asynchronously (fire-and-forget, with error capture)
    void this.runMissionAsync(plan)

    return {
      missionId: plan.id,
      message: `Mission "${title}" started with ${plan.steps.length} steps.`,
    }
  }

  /**
   * Pauses a running mission.
   *
   * @param missionId - ID of the mission to pause
   * @returns True if the mission was found and pause was requested
   */
  pauseMission(missionId: string): boolean {
    if (!this.activeMissions.has(missionId)) {
      log.warn("pauseMission: mission not found", { missionId })
      return false
    }

    missionExecutor.pause(missionId)
    const plan = this.activeMissions.get(missionId)!
    plan.status = "paused"
    plan.updatedAt = new Date()

    log.info("mission paused", { missionId })
    return true
  }

  /**
   * Resumes a paused mission.
   *
   * @param missionId - ID of the mission to resume
   * @returns True if the mission was found and resume was requested
   */
  resumeMission(missionId: string): boolean {
    if (!this.activeMissions.has(missionId)) {
      log.warn("resumeMission: mission not found", { missionId })
      return false
    }

    missionExecutor.resume(missionId)
    const plan = this.activeMissions.get(missionId)!
    plan.status = "running"
    plan.updatedAt = new Date()

    log.info("mission resumed", { missionId })
    return true
  }

  /**
   * Cancels a running or paused mission.
   *
   * @param missionId - ID of the mission to cancel
   * @returns True if the mission was found and cancel was requested
   */
  cancelMission(missionId: string): boolean {
    if (!this.activeMissions.has(missionId)) {
      log.warn("cancelMission: mission not found", { missionId })
      return false
    }

    missionExecutor.cancel(missionId)
    log.info("mission cancel requested", { missionId })
    return true
  }

  /**
   * Returns the current status of a mission.
   *
   * @param missionId - ID of the mission to query
   * @returns MissionPlan or null if not found in active registry
   */
  getMissionStatus(missionId: string): MissionPlan | null {
    return this.activeMissions.get(missionId) ?? null
  }

  /**
   * Returns all currently active mission plans.
   * Used by daemon for periodic checkpointing.
   */
  getActiveMissions(): MissionPlan[] {
    return Array.from(this.activeMissions.values())
  }

  /**
   * Performs a health checkpoint for all active missions.
   * Called by daemon.ts in the periodic cycle.
   * Cancels missions that are over budget or stalled.
   */
  async checkpointAll(): Promise<void> {
    const active = this.getActiveMissions()
    if (active.length === 0) {
      return
    }

    const needsIntervention = missionMonitor.checkpoint(active)

    for (const plan of needsIntervention) {
      log.warn("auto-cancelling over-budget or stalled mission", { missionId: plan.id })
      missionExecutor.cancel(plan.id)
    }
  }

  /**
   * Runs a mission asynchronously and handles completion/failure.
   * Persists the final state and report to Prisma on completion.
   *
   * @param plan - The mission plan to execute
   */
  private async runMissionAsync(plan: MissionPlan): Promise<void> {
    try {
      const completed = await missionExecutor.execute(plan)
      const report = missionReporter.generateReport(completed)

      await this.persistPlan(completed, report).catch((err) =>
        log.warn("failed to persist completed mission", { missionId: plan.id, err }),
      )

      log.info("mission async run finished", {
        missionId: completed.id,
        status: completed.status,
      })
    } catch (err) {
      log.error("mission async run threw", { missionId: plan.id, err })
    } finally {
      this.activeMissions.delete(plan.id)
      missionMonitor.cleanup(plan.id)
    }
  }

  /**
   * Persists a MissionPlan (and optional report) to Prisma MissionRecord.
   *
   * @param plan - The plan to persist
   * @param report - Optional MissionReport (null while running)
   */
  private async persistPlan(plan: MissionPlan, report: MissionReport | null): Promise<void> {
    const dagJson = plan.steps as unknown as Prisma.InputJsonValue
    const budgetJson = plan.budget as unknown as Prisma.InputJsonValue
    const reportJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = report
      ? (report as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull

    await prisma.missionRecord.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        userId: plan.userId,
        title: plan.title,
        goal: plan.goal,
        status: plan.status,
        dagJson,
        budgetJson,
        reportJson,
        updatedAt: plan.updatedAt,
      },
      update: {
        userId: plan.userId,
        title: plan.title,
        goal: plan.goal,
        status: plan.status,
        dagJson,
        budgetJson,
        reportJson,
        updatedAt: plan.updatedAt,
      },
    })
  }
}

/** Singleton MissionManager instance. */
export const missionManager = new MissionManager()
