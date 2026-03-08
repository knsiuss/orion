/**
 * @file quality-tracker.ts
 * @description Records and queries interaction quality signals for self-improvement.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - FeedbackSignals from message-pipeline (explicit/implicit) are recorded here.
 *   - prompt-optimizer.ts reads getSignals() to decide when to optimize.
 *   - learning-report.ts reads getTopicStats() for weekly summaries.
 */

import { createLogger } from "../logger.js"
import type { FeedbackSignal } from "./types.js"

const log = createLogger("self-improve.quality-tracker")

/** Maximum number of signals retained in memory. */
const MAX_SIGNALS = 10_000

/** Days to look back when no window is specified. */
const DEFAULT_LOOKBACK_DAYS = 7

/**
 * Collects and queries interaction quality feedback signals.
 * Signals are stored in-memory and trimmed to MAX_SIGNALS.
 */
export class QualityTracker {
  /** In-memory ring buffer of feedback signals. */
  private readonly signals: FeedbackSignal[] = []

  /**
   * Record a new feedback signal.
   * Oldest signal is evicted when buffer exceeds MAX_SIGNALS.
   *
   * @param signal - Feedback signal to record.
   */
  record(signal: FeedbackSignal): void {
    this.signals.push(signal)
    if (this.signals.length > MAX_SIGNALS) {
      this.signals.shift()
    }
    log.debug("quality signal recorded", {
      topic: signal.topic,
      signal: signal.signal,
      reason: signal.reason,
    })
  }

  /**
   * Retrieve signals from the last N days.
   *
   * @param days - Lookback window in days (default 7).
   * @returns Signals within the window, newest first.
   */
  getSignals(days = DEFAULT_LOOKBACK_DAYS): FeedbackSignal[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return this.signals.filter((s) => s.timestamp >= cutoff)
  }

  /**
   * Compute per-topic signal counts and negative rates.
   *
   * @returns Map of topic → { positive, negative, rate }.
   */
  getTopicStats(): Record<string, { positive: number; negative: number; rate: number }> {
    const stats: Record<string, { positive: number; negative: number; rate: number }> = {}
    for (const sig of this.signals) {
      if (!stats[sig.topic]) {
        stats[sig.topic] = { positive: 0, negative: 0, rate: 0 }
      }
      const entry = stats[sig.topic]!
      if (sig.signal === "positive") {
        entry.positive++
      } else {
        entry.negative++
      }
    }
    for (const entry of Object.values(stats)) {
      const total = entry.positive + entry.negative
      entry.rate = total > 0 ? entry.negative / total : 0
    }
    return stats
  }

  /**
   * Detect if the user is rephrasing a question (indicating the previous answer was poor).
   * Uses word-overlap Jaccard similarity — threshold 0.6.
   *
   * @param _userId         - User ID (reserved for future per-user tracking).
   * @param newMessage      - The new message from the user.
   * @param previousMessage - The previous message to compare against.
   * @returns True if the messages share > 60% vocabulary.
   */
  detectRephraseSignal(_userId: string, newMessage: string, previousMessage: string): boolean {
    const tokenize = (text: string): Set<string> =>
      new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2))

    const a = tokenize(newMessage)
    const b = tokenize(previousMessage)
    if (a.size === 0 || b.size === 0) return false

    let intersection = 0
    for (const word of a) {
      if (b.has(word)) intersection++
    }
    const union = new Set([...a, ...b]).size
    const jaccard = intersection / union
    return jaccard > 0.6
  }
}

/** Singleton quality tracker. */
export const qualityTracker = new QualityTracker()
