/**
 * @file learning-report.ts
 * @description Compiles and formats weekly self-improvement reports.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Aggregates data from quality-tracker, prompt-versioning, pattern-detector, gap-detector.
 *   - generate() is called from daemon.ts on Sunday midnight.
 *   - format() returns a Markdown string suitable for sending via any channel.
 */

import { createLogger } from "../logger.js"
import { qualityTracker } from "./quality-tracker.js"
import { promptVersioning } from "./prompt-versioning.js"
import { patternDetector } from "./pattern-detector.js"
import { gapDetector } from "./gap-detector.js"
import type { LearningReport as LearningReportData } from "./types.js"

const log = createLogger("self-improve.learning-report")

/**
 * Generates and formats weekly AI self-improvement reports.
 */
export class LearningReport {
  /**
   * Compile a weekly learning report from all subsystems.
   *
   * @returns LearningReportData covering the last 7 days.
   */
  generate(): LearningReportData {
    const signals = qualityTracker.getSignals(7)
    const totalInteractions = signals.length
    const positive = signals.filter((s) => s.signal === "positive").length
    const negative = signals.length - positive

    const positiveRate = totalInteractions > 0 ? positive / totalInteractions : 0
    const negativeRate = totalInteractions > 0 ? negative / totalInteractions : 0

    const versions = promptVersioning.list()
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentVersions = versions.filter((v) => new Date(v.timestamp).getTime() >= weekAgo)
    const improvements = recentVersions.map((v) => `${v.zone}: ${v.reason}`)

    const patterns = patternDetector.detect().filter((p) => p.status === "approved")
    const newSkills = patterns.map((p) => p.description)

    const gaps = gapDetector.getGaps()
    const gapsClosed: string[] = [] // cleared gaps aren't tracked in getGaps() — would need a separate log
    const topOpportunities = gaps.slice(0, 5).map(
      (g) => `${g.topic} (${g.count} failures) — ${g.suggestedAction}`,
    )

    const weekOf = new Date(weekAgo).toISOString().split("T")[0] ?? ""

    const report: LearningReportData = {
      weekOf,
      totalInteractions,
      positiveRate,
      negativeRate,
      improvements,
      newSkills,
      gapsClosed,
      topOpportunities,
    }

    log.info("weekly learning report generated", {
      weekOf,
      totalInteractions,
      improvements: improvements.length,
    })
    return report
  }

  /**
   * Format a LearningReportData as a Markdown string.
   *
   * @param report - Report data to format.
   * @returns Human-readable Markdown report.
   */
  format(report: LearningReportData): string {
    const pct = (r: number): string => `${(r * 100).toFixed(1)}%`
    const list = (items: string[]): string =>
      items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- None"

    return [
      `# Weekly Learning Report — ${report.weekOf}`,
      "",
      `## Summary`,
      `- Total interactions: **${report.totalInteractions}**`,
      `- Positive rate: **${pct(report.positiveRate)}**`,
      `- Negative rate: **${pct(report.negativeRate)}**`,
      "",
      `## Prompt Improvements Applied`,
      list(report.improvements),
      "",
      `## New Skills`,
      list(report.newSkills),
      "",
      `## Gaps Closed`,
      list(report.gapsClosed),
      "",
      `## Top Opportunities`,
      list(report.topOpportunities),
    ].join("\n")
  }
}

/** Singleton learning report generator. */
export const learningReport = new LearningReport()
