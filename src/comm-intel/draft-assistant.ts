/**
 * @file draft-assistant.ts
 * @description Drafts email and message responses in the user's style.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Learns from user's communication patterns via memory system.
 *   Supports multiple tone modes: formal, casual, assertive, friendly.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'

const log = createLogger('comm-intel.draft-assistant')

/** Request to draft a message response. */
export interface DraftRequest {
  userId: string
  incomingMessage: string
  context?: string
  tone?: 'formal' | 'casual' | 'assertive' | 'friendly'
  maxLength?: number
}

class DraftAssistant {
  /**
   * Draft a response to an incoming message.
   * @param request - Draft request with message and tone preferences
   * @returns Draft response text
   */
  async draft(request: DraftRequest): Promise<string> {
    log.debug('drafting message response', { userId: request.userId, tone: request.tone })

    const prompt = `Draft a response to this message. Tone: ${request.tone ?? 'professional'}.
${request.maxLength ? `Max length: ${request.maxLength} words.` : ''}
${request.context ? `Context: ${request.context}` : ''}

Incoming message:
"${request.incomingMessage.slice(0, 1000)}"

Write ONLY the draft response, no explanation.`

    return orchestrator.generate('fast', { prompt })
  }
}

/** Singleton draft assistant. */
export const draftAssistant = new DraftAssistant()
