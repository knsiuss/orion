/**
 * @file meeting-prep.ts
 * @description Pre-meeting briefing generator — summarizes participants and context.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses memory + calendar data to generate meeting prep notes via LLM.
 *   Returns structured notes with summary, key points, and suggested questions.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'
import { memory } from '../memory/store.js'

const log = createLogger('comm-intel.meeting-prep')

/** Input for meeting preparation. */
export interface MeetingPrepInput {
  userId: string
  title: string
  participants: string[]
  agenda?: string
  durationMinutes?: number
}

/** Structured meeting preparation notes. */
export interface MeetingPrepNotes {
  summary: string
  keyPoints: string[]
  suggestedQuestions: string[]
}

class MeetingPrepService {
  /**
   * Generate meeting prep notes for an upcoming meeting.
   * @param input - Meeting details
   * @returns Structured prep notes
   */
  async prepare(input: MeetingPrepInput): Promise<MeetingPrepNotes> {
    log.info('preparing meeting notes', { userId: input.userId, title: input.title })

    const ctx = await memory.buildContext(
      input.userId,
      `meeting ${input.title} ${input.participants.join(' ')}`,
    )

    const prompt = `Generate meeting prep notes for the following meeting:

Title: ${input.title}
Participants: ${input.participants.join(', ')}
${input.agenda ? `Agenda: ${input.agenda}` : ''}
${input.durationMinutes ? `Duration: ${input.durationMinutes} minutes` : ''}

Relevant context from memory:
${ctx.systemContext.slice(0, 500)}

Reply with JSON only:
{
  "summary": "2-3 sentence overview",
  "keyPoints": ["key point 1", "key point 2", "key point 3"],
  "suggestedQuestions": ["question 1", "question 2"]
}`

    try {
      const response = await orchestrator.generate('fast', { prompt })
      return JSON.parse(response) as MeetingPrepNotes
    } catch {
      return {
        summary: `Preparing for ${input.title} with ${input.participants.join(', ')}.`,
        keyPoints: ['Review agenda', 'Prepare questions', 'Check relevant materials'],
        suggestedQuestions: ['What are the key decisions needed?', 'What are the blockers?'],
      }
    }
  }
}

/** Singleton meeting prep service. */
export const meetingPrepService = new MeetingPrepService()
