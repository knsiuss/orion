/**
 * @file anticipation-queue.ts
 * @description Queues predicted user needs for proactive delivery.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Receives predictions from pattern-learner.ts and intent-predictor.ts.
 *   Items in the queue are candidates for proactive delivery by the daemon.
 */
import { createLogger } from "../logger.js"

const log = createLogger("predictive.anticipation-queue")

export interface AnticipationItem {
  id: string
  userId: string
  prediction: string
  confidence: number
  expiresAt: Date
  delivered: boolean
}

class AnticipationQueue {
  private queue: AnticipationItem[] = []
  private counter = 0

  enqueue(userId: string, prediction: string, confidence: number, ttlMs = 3600_000): void {
    this.queue.push({
      id: `ant-${++this.counter}`,
      userId,
      prediction,
      confidence,
      expiresAt: new Date(Date.now() + ttlMs),
      delivered: false,
    })
    log.debug("item queued", { userId, prediction, confidence })
  }

  /** Get undelivered, unexpired items for a user above the confidence threshold. */
  peek(userId: string, minConfidence = 0.5): AnticipationItem[] {
    const now = Date.now()
    return this.queue.filter(
      item => item.userId === userId
        && !item.delivered
        && item.confidence >= minConfidence
        && item.expiresAt.getTime() > now,
    )
  }

  markDelivered(id: string): void {
    const item = this.queue.find(i => i.id === id)
    if (item) item.delivered = true
  }

  /** Remove expired and delivered items. */
  cleanup(): number {
    const before = this.queue.length
    const now = Date.now()
    this.queue = this.queue.filter(i => !i.delivered && i.expiresAt.getTime() > now)
    return before - this.queue.length
  }
}

export const anticipationQueue = new AnticipationQueue()
