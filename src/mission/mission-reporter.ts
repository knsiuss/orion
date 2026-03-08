/**
 * @file mission-reporter.ts
 * @description Generates human-readable mission completion reports.
 *   Summarizes what was done, what succeeded, what failed, and resource usage.
 *
 * ARCHITECTURE:
 *   - Input: Completed or failed MissionPlan
 *   - Output: MissionReport with summary text + structured outcome data
 *   - Called by MissionManager on mission completion
 *   - Optionally uses LLM for natural-language summary generation
 *
 * PAPER BASIS:
 *   - Lost-in-Middle: arXiv:2307.03172 — report ordering for context retention
 */

import { createLogger } from "../logger.js"
import type { MissionPlan, MissionReport } from "./mission-schema.js"

const log = createLogger("mission.reporter")

/**
 * MissionReporter — produces structured and narrative reports for completed missions.
 */
export class MissionReporter {
  /**
   * Generates a MissionReport from a completed, failed, or cancelled MissionPlan.
   *
   * @param plan - The finished MissionPlan
   * @returns MissionReport with summary and structured outcome data
   */
  generateReport(plan: MissionPlan): MissionReport {
    const stepsCompleted = plan.steps.filter((s) => s.status === "completed").length
    const stepsFailed = plan.steps.filter((s) => s.status === "failed").length
    const stepsTotal = plan.steps.length

    const durationMs = plan.budget.startedAt
      ? (plan.completedAt ?? new Date()).getTime() - plan.budget.startedAt.getTime()
      : 0

    const finalStatus = this.resolveFinalStatus(plan)

    const summary = this.buildSummary(plan, stepsCompleted, stepsFailed, stepsTotal, durationMs)

    const outputs = plan.steps
      .filter((s) => s.status === "completed" && s.output !== undefined)
      .map((s) => ({
        stepId: s.id,
        description: s.description,
        output: s.output,
      }))

    const report: MissionReport = {
      missionId: plan.id,
      title: plan.title,
      status: finalStatus,
      stepsCompleted,
      stepsFailed,
      stepsTotal,
      durationMs: Math.max(0, durationMs),
      budgetUsed: { ...plan.budget },
      summary,
      outputs,
      generatedAt: new Date(),
    }

    log.info("mission report generated", {
      missionId: plan.id,
      status: finalStatus,
      stepsCompleted,
      stepsFailed,
      durationMs,
    })

    return report
  }

  /**
   * Formats a MissionReport into a human-readable string for display to the user.
   *
   * @param report - MissionReport to format
   * @returns Formatted string for channel delivery
   */
  format(report: MissionReport): string {
    const statusEmoji = report.status === "completed" ? "✅" : report.status === "failed" ? "❌" : "⚠️"
    const durationSec = Math.round(report.durationMs / 1000)

    const lines: string[] = [
      `${statusEmoji} Mission: ${report.title}`,
      `Status: ${report.status.toUpperCase()}`,
      `Progress: ${report.stepsCompleted}/${report.stepsTotal} steps completed`,
      `Duration: ${durationSec}s | Tool calls: ${report.budgetUsed.usedToolCalls}/${report.budgetUsed.maxToolCalls}`,
      "",
      report.summary,
    ]

    if (report.outputs.length > 0) {
      lines.push("", "Key outputs:")
      for (const output of report.outputs.slice(0, 3)) {
        lines.push(`  • ${output.description}: ${JSON.stringify(output.output).slice(0, 80)}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Resolves the final status for the report from the plan status.
   *
   * @param plan - Completed or failed plan
   * @returns "completed" | "failed" | "cancelled"
   */
  private resolveFinalStatus(plan: MissionPlan): "completed" | "failed" | "cancelled" {
    if (plan.status === "completed") {
      return "completed"
    }
    if (plan.status === "cancelled") {
      return "cancelled"
    }
    return "failed"
  }

  /**
   * Builds a narrative summary string for the mission report.
   *
   * @param plan - Mission plan
   * @param stepsCompleted - Count of successful steps
   * @param stepsFailed - Count of failed steps
   * @param stepsTotal - Total step count
   * @param durationMs - Mission duration in milliseconds
   * @returns Human-readable summary string
   */
  private buildSummary(
    plan: MissionPlan,
    stepsCompleted: number,
    stepsFailed: number,
    stepsTotal: number,
    durationMs: number,
  ): string {
    const parts: string[] = []

    if (plan.status === "completed") {
      parts.push(`Mission "${plan.title}" completed successfully.`)
    } else if (plan.status === "cancelled") {
      parts.push(`Mission "${plan.title}" was cancelled.`)
    } else {
      parts.push(`Mission "${plan.title}" failed.`)
    }

    parts.push(
      `Executed ${stepsCompleted} of ${stepsTotal} steps in ${Math.round(durationMs / 1000)} seconds.`,
    )

    if (stepsFailed > 0) {
      const failedSteps = plan.steps
        .filter((s) => s.status === "failed")
        .map((s) => `"${s.description}" (${s.error ?? "unknown error"})`)
        .slice(0, 3)
        .join("; ")
      parts.push(`Failed steps: ${failedSteps}.`)
    }

    if (plan.statusMessage) {
      parts.push(plan.statusMessage)
    }

    return parts.join(" ")
  }
}

/** Singleton MissionReporter instance. */
export const missionReporter = new MissionReporter()
