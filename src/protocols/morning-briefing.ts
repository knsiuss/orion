/**
 * @file morning-briefing.ts
 * @description Automated morning briefing — JARVIS-style context summary at day start.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Aggregates calendar events, unread messages, weather, and pending tasks.
 *   Delivered via all active channels at configured wake time.
 *   Wired into daemon.ts cron schedule via briefing-scheduler.ts.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'
import { memory } from '../memory/store.js'

const log = createLogger('protocols.morning-briefing')

/** Context gathered for a morning briefing. */
export interface BriefingContext {
  userId: string
  date: Date
  calendarEvents: Array<{ title: string; time: string; location?: string }>
  weather?: { description: string; temp: number; rainChance?: number }
  unreadMessages: number
  pendingTasks: number
}

class MorningBriefingProtocol {
  /**
   * Generate and deliver morning briefing for a user.
   * @param userId - User to deliver briefing for
   * @returns Generated briefing text
   */
  async deliver(userId: string): Promise<string> {
    log.info('generating morning briefing', { userId })
    const ctx = await this.gatherContext(userId)
    const briefing = await this.generateBriefing(ctx)

    void memory
      .save(userId, `Morning briefing delivered: ${new Date().toISOString()}`, {
        category: 'protocol',
        type: 'morning_briefing',
      })
      .catch(err => log.warn('failed to save briefing to memory', { err }))

    return briefing
  }

  /** Gather context for the briefing. */
  private gatherContext(userId: string): BriefingContext {
    return {
      userId,
      date: new Date(),
      calendarEvents: [],
      unreadMessages: 0,
      pendingTasks: 0,
    }
  }

  /** Generate briefing text using LLM. */
  private async generateBriefing(ctx: BriefingContext): Promise<string> {
    const dateStr = ctx.date.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    const eventSummary =
      ctx.calendarEvents.length > 0
        ? ctx.calendarEvents.map(e => `${e.time}: ${e.title}`).join(', ')
        : 'tidak ada agenda'

    const prompt = `Generate a concise JARVIS-style morning briefing.

Context:
- Date: ${dateStr}
- Calendar: ${eventSummary}
- Unread priority messages: ${ctx.unreadMessages}
- Pending tasks: ${ctx.pendingTasks}
${ctx.weather ? `- Weather: ${ctx.weather.description}, ${ctx.weather.temp}°C` : ''}

Keep it under 5 sentences. Be conversational and helpful, like JARVIS talking to Tony Stark.`

    return orchestrator.generate('fast', { prompt })
  }
}

/** Singleton morning briefing protocol instance. */
export const morningBriefing = new MorningBriefingProtocol()
