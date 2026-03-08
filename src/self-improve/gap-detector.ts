/**
 * @file gap-detector.ts
 * @description Tracks knowledge gaps — topics EDITH consistently fails to answer well.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - record() is called from message-pipeline when a negative quality signal is detected.
 *   - getGaps() is used by learning-report.ts to surface improvement opportunities.
 *   - clear() marks a gap as resolved after knowledge is added.
 */

import { createLogger } from "../logger.js"
import type { KnowledgeGap } from "./types.js"

const log = createLogger("self-improve.gap-detector")

/** Maximum example messages stored per gap. */
const MAX_EXAMPLES_PER_GAP = 10

/** Internal gap entry with mutable counts. */
interface GapEntry extends KnowledgeGap {
  /** Whether this gap has been marked as resolved. */
  resolved: boolean
}

/**
 * Tracks topics where EDITH repeatedly fails to provide satisfactory answers.
 */
export class GapDetector {
  /** Gap entries keyed by normalized topic string. */
  private readonly gaps = new Map<string, GapEntry>()

  /**
   * Record a knowledge gap observation.
   * Multiple records for the same topic accumulate the count.
   *
   * @param topic   - Normalized topic string that was not answered well.
   * @param example - The specific question or message that exposed the gap.
   */
  record(topic: string, example: string): void {
    const normalized = topic.toLowerCase().trim()
    const existing = this.gaps.get(normalized)

    if (existing) {
      existing.count++
      if (existing.examples.length < MAX_EXAMPLES_PER_GAP) {
        existing.examples.push(example)
      }
      existing.resolved = false
    } else {
      this.gaps.set(normalized, {
        topic: normalized,
        count: 1,
        examples: [example],
        suggestedAction: `Research and add knowledge about "${normalized}" to the knowledge base.`,
        resolved: false,
      })
      log.debug("new knowledge gap detected", { topic: normalized })
    }
  }

  /**
   * Get all active (unresolved) knowledge gaps, sorted by occurrence count descending.
   *
   * @returns Array of KnowledgeGap objects, highest count first.
   */
  getGaps(): KnowledgeGap[] {
    return [...this.gaps.values()]
      .filter((g) => !g.resolved)
      .sort((a, b) => b.count - a.count)
      .map(({ resolved: _resolved, ...gap }) => gap)
  }

  /**
   * Mark a knowledge gap as resolved (e.g., after adding relevant knowledge).
   *
   * @param topic - Topic to mark as resolved.
   */
  clear(topic: string): void {
    const normalized = topic.toLowerCase().trim()
    const gap = this.gaps.get(normalized)
    if (gap) {
      gap.resolved = true
      log.info("knowledge gap resolved", { topic: normalized })
    }
  }
}

/** Singleton gap detector. */
export const gapDetector = new GapDetector()
