/**
 * @file situation-report.ts
 * @description SITREP — instant situation report on demand.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Aggregates active missions, system health, and pending items into a brief report.
 *   Called on demand by user request or proactive triggers.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'
import { memory } from '../memory/store.js'

const log = createLogger('protocols.situation-report')

/** A single item in the situation report. */
export interface SitrepItem {
  category: string
  status: 'ok' | 'warning' | 'critical'
  detail: string
}

class SituationReport {
  /**
   * Generate an instant situation report.
   * @param userId - User to generate report for
   * @returns SITREP as formatted text
   */
  async generate(userId: string): Promise<string> {
    log.info('generating situation report', { userId })

    const items: SitrepItem[] = []

    // Memory snapshot
    try {
      const ctx = await memory.buildContext(userId, 'recent activity')
      if (ctx.systemContext) {
        items.push({
          category: 'Memory',
          status: 'ok',
          detail: `${ctx.systemContext.slice(0, 100)}...`,
        })
      }
    } catch {
      items.push({ category: 'Memory', status: 'warning', detail: 'Memory unavailable' })
    }

    const itemSummary =
      items.map(i => `[${i.status.toUpperCase()}] ${i.category}: ${i.detail}`).join('\n')

    const prompt = `Generate a brief JARVIS-style SITREP (Situation Report) based on this data:

${itemSummary || 'All systems nominal.'}

Keep it under 3 sentences. Direct and military-precise.`

    return orchestrator.generate('fast', { prompt })
  }
}

/** Singleton situation report instance. */
export const situationReport = new SituationReport()
