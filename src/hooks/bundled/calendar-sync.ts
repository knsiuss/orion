/**
 * @file calendar-sync.ts
 * @description Bundled hook — Calendar event reminders and pre-meeting briefings.
 * Fires on 'on_session_start' to inject upcoming events into context.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered automatically by hookLoader.loadBundled() at startup.
 *   Checks calendarEvents array in context data and identifies events
 *   starting within the next 30 minutes for immediate notification.
 */
import { createLogger } from '../../logger.js'
import type { HookContext } from '../types.js'

const log = createLogger('hooks.bundled.calendar-sync')

/** An upcoming calendar event from context data. */
interface CalendarEvent {
  title: string
  startTime: Date | string
}

/**
 * Calendar sync hook — identifies imminent calendar events.
 * @param ctx - Hook context with userId and optional calendarEvents
 * @returns Modified data with imminentEvents and calendarNote injection
 */
export default async function calendarSyncHook(
  ctx: HookContext,
): Promise<Record<string, unknown>> {
  const { userId, data } = ctx

  log.debug('calendar sync hook', { userId })

  const now = new Date()
  const soon = new Date(now.getTime() + 30 * 60 * 1000)

  const upcomingEvents = (data['calendarEvents'] as CalendarEvent[] | undefined) ?? []
  const imminent = upcomingEvents.filter((e) => {
    const start = new Date(e.startTime)
    return start >= now && start <= soon
  })

  if (imminent.length > 0) {
    log.info('imminent calendar events detected', { userId, count: imminent.length })
  }

  return {
    ...data,
    imminentEvents: imminent,
    calendarInjected: true,
    calendarNote:
      imminent.length > 0
        ? `${imminent.length} event(s) starting in <30 min: ${imminent.map((e) => e.title).join(', ')}`
        : undefined,
  }
}

/** Hook manifest for auto-registration. */
export const manifest = {
  id: 'calendar-sync',
  name: 'Calendar Sync',
  events: ['on_session_start'] as string[],
  enabled: true,
  priority: 20,
  path: 'src/hooks/bundled/calendar-sync.ts',
}
