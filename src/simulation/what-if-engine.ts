/**
 * @file what-if-engine.ts
 * @description LLM-powered "what-if" scenario analysis and merge simulation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses orchestrator.generate('reasoning', ...) for scenario analysis.
 *   - analyze() is callable from skills or message-pipeline tool responses.
 *   - simulateMerge() helps with PR review and git merge planning.
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"

const log = createLogger("simulation.what-if")

/**
 * Analyzes hypothetical scenarios and simulates impacts using LLM reasoning.
 */
export class WhatIfEngine {
  /**
   * Analyze a "what if" scenario and return a Markdown impact analysis.
   *
   * @param scenario - Natural-language description of the scenario.
   * @param context  - Optional structured context to include in analysis.
   * @returns Markdown-formatted impact analysis string.
   */
  async analyze(scenario: string, context?: Record<string, unknown>): Promise<string> {
    const contextStr = context
      ? `\nContext: ${JSON.stringify(context, null, 2)}`
      : ""
    const prompt = [
      `Analyze the following "what if" scenario and provide a structured impact analysis.`,
      `Scenario: ${scenario}${contextStr}`,
      "",
      "Respond in Markdown with sections:",
      "## Likelihood",
      "## Potential Impact",
      "## Affected Systems",
      "## Mitigations",
      "## Recommendation",
    ].join("\n")

    try {
      const result = await orchestrator.generate("reasoning", { prompt })
      log.info("what-if analysis complete", { scenario: scenario.slice(0, 50) })
      return result
    } catch (err) {
      log.warn("what-if analysis failed", { err })
      return `## Analysis Failed\n\nUnable to analyze scenario: ${String(err)}`
    }
  }

  /**
   * Simulate a git pull request merge and surface potential risks.
   *
   * @param prDescription - Description of the PR changes.
   * @returns Object with risks and recommendations arrays.
   */
  async simulateMerge(prDescription: string): Promise<{ risks: string[]; recommendations: string[] }> {
    const prompt = [
      `You are reviewing a pull request before merge.`,
      `PR Description:\n${prDescription}`,
      "",
      "Identify:",
      "1. RISKS: potential regressions, breaking changes, security concerns (one per line, prefix 'RISK:')",
      "2. RECOMMENDATIONS: how to mitigate each risk (one per line, prefix 'REC:')",
      "",
      "Output ONLY the prefixed lines. No prose.",
    ].join("\n")

    try {
      const raw = await orchestrator.generate("reasoning", { prompt })
      const risks: string[] = []
      const recommendations: string[] = []

      for (const line of raw.split("\n")) {
        const trimmed = line.trim()
        if (trimmed.startsWith("RISK:")) {
          risks.push(trimmed.replace(/^RISK:\s*/, ""))
        } else if (trimmed.startsWith("REC:")) {
          recommendations.push(trimmed.replace(/^REC:\s*/, ""))
        }
      }

      log.info("merge simulation complete", { risks: risks.length, recommendations: recommendations.length })
      return { risks, recommendations }
    } catch (err) {
      log.warn("merge simulation failed", { err })
      return {
        risks: ["Unable to analyze PR — LLM call failed"],
        recommendations: ["Review the PR manually"],
      }
    }
  }
}

/** Singleton what-if engine. */
export const whatIfEngine = new WhatIfEngine()
