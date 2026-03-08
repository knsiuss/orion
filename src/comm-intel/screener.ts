/**
 * @file screener.ts
 * @description Priority scoring for all incoming messages — JARVIS communication screening.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Scores 0-100: 100 = requires immediate attention, 0 = can safely ignore.
 *   Fast regex pattern matching first, LLM fallback for ambiguous messages.
 *   Used in message pipeline to surface high-priority items.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'

const log = createLogger('comm-intel.screener')

/** Priority score result for a message. */
export interface MessageScore {
  priority: number
  category: 'urgent' | 'important' | 'normal' | 'spam' | 'promotional'
  reason: string
  requiresAction: boolean
}

class CommunicationScreener {
  private readonly URGENT_PATTERNS = [
    /urgent|asap|emergency|critical|deadline today/i,
    /please respond|reply asap|need you now/i,
    /server down|outage|incident|breach/i,
  ]

  /**
   * Score a message for priority.
   * @param message - Message text to evaluate
   * @param _sender - Optional sender identifier (for future use)
   * @returns Priority score with category and reason
   */
  async score(message: string, _sender?: string): Promise<MessageScore> {
    for (const pattern of this.URGENT_PATTERNS) {
      if (pattern.test(message)) {
        return {
          priority: 90,
          category: 'urgent',
          reason: 'Contains urgent keywords',
          requiresAction: true,
        }
      }
    }

    if (message.length < 10 || /click here|unsubscribe|special offer/i.test(message)) {
      return { priority: 5, category: 'promotional', reason: 'Promotional pattern', requiresAction: false }
    }

    try {
      const response = await orchestrator.generate('fast', {
        prompt: `Rate this message priority 0-100. Reply ONLY with JSON: {"priority": N, "category": "urgent|important|normal|spam", "reason": "brief", "requiresAction": true|false}

Message: "${message.slice(0, 500)}"`,
      })
      return JSON.parse(response) as MessageScore
    } catch (err) {
      log.warn('priority scoring failed, using default', { err })
      return { priority: 50, category: 'normal', reason: 'Default', requiresAction: false }
    }
  }
}

/** Singleton communication screener. */
export const communicationScreener = new CommunicationScreener()
