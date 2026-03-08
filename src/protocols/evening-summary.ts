/**
 * @file evening-summary.ts
 * @description Automated evening summary — JARVIS-style end-of-day recap.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Complements morning-briefing.ts. Summarizes the day's activities,
 *   completed tasks, spending, and notable events.
 *   Delivered via active channels at configured wind-down time.
 */
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import { memory } from "../memory/store.js"

const log = createLogger("protocols.evening-summary")

export interface EveningSummaryContext {
  userId: string
  date: Date
  messagesCount: number
  tasksCompleted: number
  spending?: number
  highlights: string[]
}

class EveningSummaryProtocol {
  async deliver(userId: string): Promise<string> {
    log.info("generating evening summary", { userId })
    const ctx = this.gatherContext(userId)
    const summary = await this.generateSummary(ctx)

    void memory
      .save(userId, `Evening summary delivered: ${new Date().toISOString()}`, {
        category: "protocol",
        type: "evening_summary",
      })
      .catch(err => log.warn("failed to save summary to memory", { err }))

    return summary
  }

  private gatherContext(userId: string): EveningSummaryContext {
    return {
      userId,
      date: new Date(),
      messagesCount: 0,
      tasksCompleted: 0,
      highlights: [],
    }
  }

  private async generateSummary(ctx: EveningSummaryContext): Promise<string> {
    const dateStr = ctx.date.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })

    const prompt = `Generate a concise JARVIS-style evening summary.

Context:
- Date: ${dateStr}
- Messages handled today: ${ctx.messagesCount}
- Tasks completed: ${ctx.tasksCompleted}
${ctx.spending ? `- Total spending: ${ctx.spending}` : ""}
${ctx.highlights.length > 0 ? `- Highlights: ${ctx.highlights.join(", ")}` : ""}

Keep it under 5 sentences. Be conversational like JARVIS wrapping up the day.`

    try {
      return await orchestrator.generate("fast", { prompt })
    } catch (err) {
      log.error("evening summary generation failed", { err })
      return `Good evening, Sir. Today's summary is temporarily unavailable.`
    }
  }
}

export const eveningSummary = new EveningSummaryProtocol()
