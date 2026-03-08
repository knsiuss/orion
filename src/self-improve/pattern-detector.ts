/**
 * @file pattern-detector.ts
 * @description Detects recurring user message patterns that could become auto-generated skills.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - record() is called from message-pipeline launchAsyncSideEffects().
 *   - detect() is called by learning-report and skill-creator.
 *   - Patterns with >3 occurrences in 14 days are surfaced as candidates.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../logger.js"
import type { SkillPattern } from "./types.js"

const log = createLogger("self-improve.pattern-detector")

/** Minimum occurrences before a pattern is considered a candidate. */
const MIN_OCCURRENCES = 3
/** Number of days to look back when counting pattern occurrences. */
const LOOKBACK_DAYS = 14

/** Internal record of a single pattern observation. */
interface Observation {
  /** Pattern key (normalized topic + user). */
  key: string
  /** Original message example. */
  message: string
  /** Topic label. */
  topic: string
  /** Timestamp of observation. */
  timestamp: number
}

/**
 * Detects recurring message patterns and manages their lifecycle
 * (candidate → approved/rejected/archived).
 */
export class PatternDetector {
  /** All observations, time-bounded. */
  private readonly observations: Observation[] = []
  /** Managed patterns keyed by pattern ID. */
  private readonly patterns = new Map<string, SkillPattern>()

  /**
   * Record a user message for pattern analysis.
   *
   * @param _userId  - User identifier (reserved for multi-user support).
   * @param message - Raw user message.
   * @param topic   - Classified topic for this message.
   */
  record(_userId: string, message: string, topic: string): void {
    const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    // Prune old observations
    while (this.observations.length > 0 && this.observations[0]!.timestamp < cutoff) {
      this.observations.shift()
    }
    this.observations.push({ key: topic, message, topic, timestamp: Date.now() })
  }

  /**
   * Detect topics with sufficient occurrences to be considered skill patterns.
   *
   * @returns Array of SkillPattern candidates (including previously tracked ones).
   */
  detect(): SkillPattern[] {
    const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    const recent = this.observations.filter((o) => o.timestamp >= cutoff)

    // Count occurrences per topic
    const grouped = new Map<string, Observation[]>()
    for (const obs of recent) {
      if (!grouped.has(obs.topic)) grouped.set(obs.topic, [])
      grouped.get(obs.topic)!.push(obs)
    }

    const candidates: SkillPattern[] = []
    for (const [topic, obs] of grouped) {
      if (obs.length <= MIN_OCCURRENCES) continue

      // Find or create pattern
      const existing = [...this.patterns.values()].find((p) => p.description === topic)
      if (existing) {
        existing.occurrenceCount = obs.length
        existing.lastSeen = obs[obs.length - 1]!.timestamp
        candidates.push(existing)
        continue
      }

      const pattern: SkillPattern = {
        id: randomUUID(),
        description: topic,
        examples: obs.slice(-5).map((o) => o.message),
        occurrenceCount: obs.length,
        firstSeen: obs[0]!.timestamp,
        lastSeen: obs[obs.length - 1]!.timestamp,
        status: "candidate",
      }
      this.patterns.set(pattern.id, pattern)
      candidates.push(pattern)
      log.info("skill pattern detected", { topic, occurrences: obs.length })
    }

    return candidates
  }

  /**
   * Mark a pattern as rejected (will not be proposed as a skill again).
   *
   * @param patternId - Pattern ID to reject.
   */
  markRejected(patternId: string): void {
    const p = this.patterns.get(patternId)
    if (p) {
      p.status = "rejected"
      log.debug("pattern rejected", { patternId })
    }
  }

  /**
   * Mark a pattern as approved (user or system accepted it as a skill).
   *
   * @param patternId - Pattern ID to approve.
   */
  markApproved(patternId: string): void {
    const p = this.patterns.get(patternId)
    if (p) {
      p.status = "approved"
      log.info("pattern approved", { patternId, description: p.description })
    }
  }
}

/** Singleton pattern detector. */
export const patternDetector = new PatternDetector()
