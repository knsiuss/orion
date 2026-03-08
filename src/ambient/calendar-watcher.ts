/**
 * @file calendar-watcher.ts
 * @description Watches calendar events and delivers timely alerts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Polls calendar service at regular intervals. Feeds morning-briefing.ts
 *   and triggers push notifications before events.
 */
import { createLogger } from "../logger.js"

const log = createLogger("ambient.calendar-watcher")

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  location?: string
}

class CalendarWatcher {
  private running = false
  private intervalHandle: ReturnType<typeof setInterval> | null = null

  async start(pollIntervalMs = 300_000): Promise<void> {
    if (this.running) return
    this.running = true

    this.intervalHandle = setInterval(() => {
      void this.check().catch(err => log.warn("calendar check failed", { err }))
    }, pollIntervalMs)
    this.intervalHandle.unref()

    log.info("calendar watcher started", { pollIntervalMs })
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.running = false
    log.info("calendar watcher stopped")
  }

  private async check(): Promise<void> {
    // Placeholder: will integrate with calendarService
    log.debug("calendar check tick")
  }
}

export const calendarWatcher = new CalendarWatcher()
