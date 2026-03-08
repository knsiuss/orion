/**
 * @file prompt-optimizer.ts
 * @description LLM-driven system prompt optimizer with frozen-zone protection.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Reads signals from quality-tracker.ts to decide when optimization is needed.
 *   - Generates candidate prompts via orchestrator.generate('reasoning', ...).
 *   - Saves approved versions to prompt-versioning.ts.
 *   - NEVER touches FROZEN_ZONES — always checked before any mutation.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import { qualityTracker } from "./quality-tracker.js"
import { promptVersioning } from "./prompt-versioning.js"
import { FROZEN_ZONES } from "./types.js"

const log = createLogger("self-improve.prompt-optimizer")

/** Minimum negative rate that triggers optimization analysis. */
const NEGATIVE_RATE_THRESHOLD = 0.25
/** Minimum sample size required before optimization is considered. */
const MIN_SAMPLE_SIZE = 20
/** Confidence threshold above which auto-apply is allowed. */
const AUTO_APPLY_CONFIDENCE = 0.8

/**
 * Optimizes system prompt zones based on quality signal analysis.
 * Frozen zones are never modified, ensuring safety and identity integrity.
 */
export class PromptOptimizer {
  /**
   * Analyze a zone to determine whether optimization is warranted.
   *
   * @param zone - Prompt zone name to analyze.
   * @returns Analysis result with recommendation and sample stats.
   */
  async analyze(zone: string): Promise<{
    shouldOptimize: boolean
    negativeRate: number
    sampleSize: number
  }> {
    if (this.isFrozen(zone)) {
      return { shouldOptimize: false, negativeRate: 0, sampleSize: 0 }
    }

    const signals = qualityTracker.getSignals(14)
    const zoneSignals = signals.filter((s) => s.topic === zone)
    const sampleSize = zoneSignals.length

    if (sampleSize < MIN_SAMPLE_SIZE) {
      return { shouldOptimize: false, negativeRate: 0, sampleSize }
    }

    const negativeCount = zoneSignals.filter(
      (s) => s.signal === "negative" || s.signal === "strong_negative",
    ).length
    const negativeRate = negativeCount / sampleSize

    return {
      shouldOptimize: negativeRate > NEGATIVE_RATE_THRESHOLD,
      negativeRate,
      sampleSize,
    }
  }

  /**
   * Optimize a zone by generating LLM variants and selecting the best.
   * Returns null if the zone is frozen or optimization is not warranted.
   *
   * @param zone          - Prompt zone to optimize.
   * @param currentPrompt - Current content of the zone.
   * @returns New prompt content, or null if optimization was skipped.
   */
  async optimize(zone: string, currentPrompt: string): Promise<string | null> {
    if (this.isFrozen(zone)) {
      log.warn("optimization blocked: frozen zone", { zone })
      return null
    }

    const { shouldOptimize, negativeRate, sampleSize } = await this.analyze(zone)
    if (!shouldOptimize) {
      log.debug("optimization skipped: insufficient signal", { zone, negativeRate, sampleSize })
      return null
    }

    const prompt = [
      `You are optimizing the "${zone}" section of an AI assistant's system prompt.`,
      `Current negative feedback rate: ${(negativeRate * 100).toFixed(1)}% (${sampleSize} samples).`,
      `\nCurrent prompt section:\n---\n${currentPrompt}\n---`,
      "\nGenerate an improved version that addresses quality issues.",
      "Output ONLY the new prompt text. No explanation.",
    ].join("\n")

    try {
      const newContent = await orchestrator.generate("reasoning", { prompt })
      log.info("prompt optimized", { zone, negativeRate, sampleSize })
      return newContent.trim()
    } catch (err) {
      log.warn("prompt optimization LLM call failed", { zone, err })
      return null
    }
  }

  /**
   * Check whether a zone is frozen (immutable).
   *
   * @param zone - Zone name to check.
   * @returns True if the zone is in FROZEN_ZONES.
   */
  isFrozen(zone: string): boolean {
    return (FROZEN_ZONES as readonly string[]).includes(zone)
  }

  /**
   * Run a full optimization cycle across all mutable zones.
   * Auto-applies changes only when confidence exceeds AUTO_APPLY_CONFIDENCE.
   */
  async run(): Promise<void> {
    log.info("prompt optimization cycle started")
    const { MUTABLE_ZONES } = await import("./types.js")

    for (const zone of MUTABLE_ZONES) {
      try {
        const { shouldOptimize, negativeRate, sampleSize } = await this.analyze(zone)
        if (!shouldOptimize) continue

        const confidence = Math.min(1, sampleSize / 100) * (1 - negativeRate)
        const currentVersion = promptVersioning.getLatest(zone)
        const currentContent = currentVersion?.newContent ?? ""

        const newContent = await this.optimize(zone, currentContent)
        if (!newContent) continue

        if (confidence >= AUTO_APPLY_CONFIDENCE) {
          promptVersioning.save({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            zone,
            oldContent: currentContent,
            newContent,
            reason: `Auto-optimized: ${(negativeRate * 100).toFixed(1)}% negative rate over ${sampleSize} samples`,
            evidence: {
              sampleSize,
              negativeRate,
              improvementEstimate: confidence,
            },
          })
          log.info("prompt auto-applied", { zone, confidence: confidence.toFixed(2) })
        } else {
          log.info("prompt optimization skipped — confidence too low", {
            zone,
            confidence: confidence.toFixed(2),
            required: AUTO_APPLY_CONFIDENCE,
          })
        }
      } catch (err) {
        log.warn("optimization cycle error for zone", { zone, err })
      }
    }
  }
}

/** Singleton prompt optimizer. */
export const promptOptimizer = new PromptOptimizer()
