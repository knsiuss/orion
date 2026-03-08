/**
 * @file briefing-scheduler.ts
 * @description Schedules morning briefings and other protocol deliveries.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Integrates with daemon's background loop for time-based triggers.
 *   Checks schedule every minute using setInterval.
 *   Reads MORNING_BRIEFING_TIME and DEFAULT_USER_ID from config.
 */
import { createLogger } from '../logger.js'
import config from '../config.js'
import { morningBriefing } from './morning-briefing.js'

const log = createLogger('protocols.briefing-scheduler')

class BriefingScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  /** Start the briefing scheduler. Checks every minute for scheduled deliveries. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.checkSchedule().catch(err =>
        log.warn('briefing schedule check failed', { err }),
      )
    }, 60_000)
    log.info('briefing scheduler started')
  }

  /** Stop the scheduler and clear the timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Check if a briefing should be delivered right now. */
  private async checkSchedule(): Promise<void> {
    const enabled = config.MORNING_BRIEFING_ENABLED === 'true'
    if (!enabled) return

    const timeParts = (config.MORNING_BRIEFING_TIME ?? '07:00').split(':')
    const targetHour = Number(timeParts[0] ?? '7')
    const targetMin = Number(timeParts[1] ?? '0')
    const now = new Date()

    if (now.getHours() === targetHour && now.getMinutes() === targetMin) {
      const userId = config.DEFAULT_USER_ID
      log.info('delivering scheduled morning briefing', { userId })
      await morningBriefing.deliver(userId)
    }
  }
}

/** Singleton briefing scheduler. */
export const briefingScheduler = new BriefingScheduler()
