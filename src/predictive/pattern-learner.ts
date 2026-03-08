/**
 * @file pattern-learner.ts
 * @description Learns recurring user behavior patterns for proactive suggestions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Analyzes activity records from HabitModel and interaction patterns.
 *   Feeds anticipation-queue.ts with predicted user needs.
 */
import { createLogger } from "../logger.js"

const log = createLogger("predictive.pattern-learner")

export interface Pattern {
  name: string
  frequency: number
  confidence: number
  lastSeen: Date
  context: string[]
}

class PatternLearner {
  private patterns = new Map<string, Pattern[]>()

  record(userId: string, action: string, context: string): void {
    const userPatterns = this.patterns.get(userId) ?? []
    const existing = userPatterns.find(p => p.name === action)

    if (existing) {
      existing.frequency++
      existing.confidence = Math.min(1, existing.confidence + 0.02)
      existing.lastSeen = new Date()
      if (!existing.context.includes(context)) {
        existing.context.push(context)
      }
    } else {
      userPatterns.push({
        name: action,
        frequency: 1,
        confidence: 0.1,
        lastSeen: new Date(),
        context: [context],
      })
    }

    this.patterns.set(userId, userPatterns)
    log.debug("pattern recorded", { userId, action })
  }

  getPatterns(userId: string, minConfidence = 0.3): Pattern[] {
    return (this.patterns.get(userId) ?? []).filter(p => p.confidence >= minConfidence)
  }
}

export const patternLearner = new PatternLearner()
