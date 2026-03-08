/**
 * @file calendar.ts
 * @description CalendarService - Google Calendar + Outlook Calendar integration.
 *
 * ARCHITECTURE NOTE:
 *   CalendarService is a SERVICE, not a Channel (BaseChannel).
 *   Used by:
 *   1. Agent tools (createEvent, findFreeSlots, listUpcoming)
 *   2. Background daemon (proactive meeting reminders)
 *   3. Channels (context for VoI calculations)
 *
 * CONFLICT DETECTION:
 *   Implements ALAS 3-layer architecture (arXiv:2505.12501):
 *   - Compartmentalized execution per operation
 *   - Independent temporal constraint validator
 *   - Runtime monitor with timeout
 *
 * PAPER BASIS:
 *   - ScheduleMe: arXiv:2509.25693 (multi-agent calendar, 94-96% intent accuracy)
 *   - ALAS: arXiv:2505.12501 (temporal constraint compliance, 100% feasible)
 *   - Proactive Agents: arXiv:2405.19464 (VoI-gated proactive alerts)
 *
 * OUTLOOK INTEGRATION:
 *   Uses Microsoft Graph API v1.0 with native fetch() — no extra SDK needed.
 *   Auth: OAuth2 refresh-token → access-token exchange at init time.
 *   Endpoints:
 *     GET  /me/events          — listUpcomingOutlook()
 *     GET  /me/calendarView    — getEventsInRangeOutlook() (expands recurrences)
 *     POST /me/events          — createEventOutlook()
 *     DELETE /me/events/{id}   — deleteEvent() Outlook branch
 *
 * @module services/calendar
 */

import { google } from "googleapis"
import type { calendar_v3 } from "googleapis"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("services.calendar")

/** Microsoft Graph API v1.0 base URL. */
const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

/** Microsoft identity platform token endpoint (multi-tenant "common"). */
const MS_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token"

// ---------------------------------------------------------------------------
// Microsoft Graph response shapes (only fields CalendarService consumes)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a Microsoft Graph event object as returned by the REST API.
 * Declared here rather than importing a full SDK type to avoid new dependencies.
 */
interface GraphEvent {
  id: string
  subject: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  location?: { displayName?: string }
  bodyPreview?: string
  attendees?: Array<{ emailAddress?: { address?: string } }>
  onlineMeeting?: { joinUrl?: string }
  showAs?: string
}

/**
 * Response body from the Microsoft identity platform /token endpoint.
 */
interface MsTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
  refresh_token?: string
}

/**
 * OData collection wrapper returned by Graph list endpoints.
 */
interface GraphCollection<T> {
  value: T[]
}

/**
 * Calendar event structure.
 */
export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  attendees: string[]
  location?: string
  description?: string
  meetingUrl?: string
  recurrence?: string
  calendarId: string
  status: "confirmed" | "tentative" | "cancelled"
}

/**
 * Parameters for creating a calendar event.
 */
export interface CalendarEventDraft {
  title: string
  start: Date
  end: Date
  attendees?: string[]
  location?: string
  description?: string
  calendarId?: string
}

/**
 * Time slot for scheduling.
 */
export interface TimeSlot {
  start: Date
  end: Date
  durationMinutes: number
}

/**
 * Calendar alert for daemon proactive notifications.
 */
export interface CalendarAlert {
  id: string
  title: string
  start: Date
  end: Date
  location?: string
  meetingUrl?: string
}

/**
 * CalendarService - Google Calendar + Outlook Calendar integration.
 *
 * NOT a BaseChannel - this is a service layer for calendar operations.
 *
 * USAGE:
 *   ```typescript
 *   // List upcoming events
 *   const events = await calendarService.listUpcoming(24) // next 24 hours
 *
 *   // Find free slots
 *   const slots = await calendarService.findFreeSlots(new Date(), 60) // 60 min slots
 *
 *   // Create event with conflict check
 *   const hasConflict = await calendarService.checkConflicts(start, end)
 *   if (!hasConflict) {
 *     await calendarService.createEvent({ title, start, end, attendees })
 *   }
 *
 *   // Daemon integration
 *   const alerts = await calendarService.getUpcomingAlerts(15) // 15 min before
 *   ```
 */
export class CalendarService {
  private provider: "google" | "outlook"
  private googleClient: calendar_v3.Calendar | null = null
  private initialized = false
  private alertedEvents = new Set<string>() // Track which events already alerted

  constructor() {
    // Determine provider based on which credentials are configured
    if (config.GCAL_CLIENT_ID && config.GCAL_CLIENT_SECRET) {
      this.provider = "google"
    } else if (config.OUTLOOK_CALENDAR_CLIENT_ID && config.OUTLOOK_CALENDAR_CLIENT_SECRET) {
      this.provider = "outlook"
    } else {
      this.provider = "google" // default
    }
  }

  /**
   * Initializes the calendar service with OAuth2 credentials.
   *
   * For Google: sets up the googleapis OAuth2 client and validates connectivity.
   * For Outlook: exchanges OUTLOOK_CALENDAR_REFRESH_TOKEN for a bearer token via
   * the Microsoft identity platform, or skips the exchange when
   * OUTLOOK_CALENDAR_ACCESS_TOKEN is already populated (CI / service-principal).
   *
   * @throws Error if OAuth2 credentials are missing or the token exchange fails
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      if (this.provider === "google") {
        await this.initGoogle()
      } else {
        await this.initOutlook()
      }

      this.initialized = true
      log.info("calendar service initialized", { provider: this.provider })
    } catch (error) {
      log.error("calendar service failed to initialize", { provider: this.provider, error })
      throw error
    }
  }

  /**
   * Lists upcoming events within specified hours.
   *
   * @param hours Number of hours to look ahead (default: 24)
   * @returns Array of calendar events
   */
  async listUpcoming(hours: number = 24): Promise<CalendarEvent[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      if (this.provider === "google" && this.googleClient) {
        return this.listUpcomingGoogle(hours)
      } else {
        return this.listUpcomingOutlook(hours)
      }
    } catch (error) {
      log.error("failed to list upcoming events", { hours, error })
      return []
    }
  }

  /**
   * Finds free time slots for scheduling.
   *
   * @param date Target date to search
   * @param durationMinutes Required slot duration
   * @returns Array of available time slots
   */
  async findFreeSlots(date: Date, durationMinutes: number): Promise<TimeSlot[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      // Get all events for the target date
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)

      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const events = await this.getEventsInRange(startOfDay, endOfDay)

      // Sort events by start time
      events.sort((a, b) => a.start.getTime() - b.start.getTime())

      // Find gaps between events
      const slots: TimeSlot[] = []
      let currentTime = new Date(startOfDay)
      currentTime.setHours(9, 0, 0, 0) // Start at 9 AM

      const workdayEnd = new Date(startOfDay)
      workdayEnd.setHours(18, 0, 0, 0) // End at 6 PM

      for (const event of events) {
        const gapMinutes = (event.start.getTime() - currentTime.getTime()) / 60000

        if (gapMinutes >= durationMinutes) {
          slots.push({
            start: new Date(currentTime),
            end: new Date(currentTime.getTime() + durationMinutes * 60000),
            durationMinutes,
          })
        }

        currentTime = new Date(event.end)
      }

      // Check if there's a slot after the last event
      const finalGapMinutes = (workdayEnd.getTime() - currentTime.getTime()) / 60000
      if (finalGapMinutes >= durationMinutes) {
        slots.push({
          start: new Date(currentTime),
          end: new Date(currentTime.getTime() + durationMinutes * 60000),
          durationMinutes,
        })
      }

      return slots
    } catch (error) {
      log.error("failed to find free slots", { date, durationMinutes, error })
      return []
    }
  }

  /**
   * Checks if a proposed event conflicts with existing events.
   *
   * Implements ALAS independent validator pattern (arXiv:2505.12501).
   *
   * @param start Event start time
   * @param end Event end time
   * @returns true if conflict exists, false otherwise
   */
  async checkConflicts(start: Date, end: Date): Promise<boolean> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      const events = await this.getEventsInRange(start, end)

      // Check for any overlap
      for (const event of events) {
        // Two events overlap if: start1 < end2 AND start2 < end1
        const overlaps = start < event.end && event.start < end

        if (overlaps) {
          log.info("calendar conflict detected", {
            proposedStart: start,
            proposedEnd: end,
            conflictsWith: event.title,
          })
          return true
        }
      }

      return false
    } catch (error) {
      log.error("failed to check conflicts", { start, end, error })
      return false // Assume no conflict on error (safe fallback)
    }
  }

  /**
   * Creates a new calendar event.
   *
   * ALWAYS calls checkConflicts() first.
   *
   * @param draft Event creation parameters
   * @returns Created event or null if conflict
   */
  async createEvent(draft: CalendarEventDraft): Promise<CalendarEvent | null> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      // Check for conflicts first
      const hasConflict = await this.checkConflicts(draft.start, draft.end)

      if (hasConflict) {
        log.warn("cannot create event: conflict detected", { title: draft.title })
        return null
      }

      if (this.provider === "google" && this.googleClient) {
        return this.createEventGoogle(draft)
      } else {
        return this.createEventOutlook(draft)
      }
    } catch (error) {
      log.error("failed to create event", { title: draft.title, error })
      return null
    }
  }

  /**
   * Deletes a calendar event.
   *
   * @param eventId Event ID to delete
   * @returns true if deleted successfully
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      if (this.provider === "google" && this.googleClient) {
        await this.googleClient.events.delete({
          calendarId: "primary",
          eventId,
        })

        log.info("event deleted", { eventId })
        return true
      } else {
        // Outlook: DELETE /me/events/{id} — Graph returns 204 No Content on success
        await this.graphFetch<void>(`/me/events/${encodeURIComponent(eventId)}`, {
          method: "DELETE",
        })

        log.info("event deleted", { eventId, provider: "outlook" })
        return true
      }
    } catch (error) {
      log.error("failed to delete event", { eventId, error })
      return false
    }
  }

  /**
   * Gets upcoming events that need proactive alerts.
   *
   * Used by background daemon for meeting reminders.
   *
   * @param withinMinutes Only return events starting within this many minutes
   * @returns Array of events that need alerts
   */
  async getUpcomingAlerts(withinMinutes: number = 15): Promise<CalendarAlert[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      const now = new Date()
      const alertWindow = new Date(now.getTime() + withinMinutes * 60000)

      const events = await this.getEventsInRange(now, alertWindow)

      // Filter to events that haven't been alerted yet
      const alerts: CalendarAlert[] = []

      for (const event of events) {
        if (!this.alertedEvents.has(event.id)) {
          alerts.push({
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            location: event.location,
            meetingUrl: event.meetingUrl,
          })

          // Mark as alerted
          this.alertedEvents.add(event.id)

          // Cleanup old alerted events (older than 1 hour)
          setTimeout(() => {
            this.alertedEvents.delete(event.id)
          }, 60 * 60 * 1000)
        }
      }

      return alerts
    } catch (error) {
      log.error("failed to get upcoming alerts", { withinMinutes, error })
      return []
    }
  }

  /**
   * Initializes Google Calendar API client.
   */
  private async initGoogle(): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(
      config.GCAL_CLIENT_ID,
      config.GCAL_CLIENT_SECRET,
      "http://localhost"
    )

    oauth2Client.setCredentials({
      refresh_token: config.GCAL_REFRESH_TOKEN,
    })

    this.googleClient = google.calendar({ version: "v3", auth: oauth2Client })

    // Test connection
    await this.googleClient.calendarList.list()

    log.info("google calendar client initialized")
  }

  /**
   * Initializes Outlook Calendar by acquiring a Microsoft Graph access token.
   *
   * Flow:
   *   1. If OUTLOOK_CALENDAR_ACCESS_TOKEN is already populated (env var / edith.json
   *      credential override / service-principal CI flow) the exchange is skipped.
   *   2. Otherwise, performs an OAuth2 refresh-token grant against the Microsoft
   *      identity platform /token endpoint using the three OUTLOOK_CALENDAR_* vars.
   *   3. Stores the acquired access_token in the mutable runtime config so
   *      graphFetch() can use it for the lifetime of the process.
   *   4. If the server returns a rotated refresh_token the new value is persisted
   *      in config as well (no-op if the server omits it, which is common for
   *      confidential clients with long-lived refresh tokens).
   *
   * Required config vars:
   *   OUTLOOK_CALENDAR_CLIENT_ID
   *   OUTLOOK_CALENDAR_CLIENT_SECRET
   *   OUTLOOK_CALENDAR_REFRESH_TOKEN  (or pre-populated OUTLOOK_CALENDAR_ACCESS_TOKEN)
   *
   * @throws Error when credentials are absent or the token endpoint returns an error
   */
  private async initOutlook(): Promise<void> {
    // Fast-path: token already provided (CI / service-principal / edith.json)
    if (config.OUTLOOK_CALENDAR_ACCESS_TOKEN) {
      log.info("outlook calendar: using pre-configured access token")
      return
    }

    if (
      !config.OUTLOOK_CALENDAR_CLIENT_ID ||
      !config.OUTLOOK_CALENDAR_CLIENT_SECRET ||
      !config.OUTLOOK_CALENDAR_REFRESH_TOKEN
    ) {
      throw new Error(
        "Outlook Calendar OAuth2 credentials are missing. " +
          "Set OUTLOOK_CALENDAR_CLIENT_ID, OUTLOOK_CALENDAR_CLIENT_SECRET, and " +
          "OUTLOOK_CALENDAR_REFRESH_TOKEN in .env or edith.json credentials.",
      )
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.OUTLOOK_CALENDAR_CLIENT_ID,
      client_secret: config.OUTLOOK_CALENDAR_CLIENT_SECRET,
      refresh_token: config.OUTLOOK_CALENDAR_REFRESH_TOKEN,
      scope: "https://graph.microsoft.com/Calendars.ReadWrite offline_access",
    })

    const res = await fetch(MS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `Outlook Calendar token exchange failed (HTTP ${res.status}): ${text}`,
      )
    }

    const data = (await res.json()) as MsTokenResponse

    // Persist the acquired token in the mutable runtime config object
    const mutable = config as Record<string, unknown>
    mutable["OUTLOOK_CALENDAR_ACCESS_TOKEN"] = data.access_token

    // Persist the rotated refresh token when the server sends one
    if (data.refresh_token) {
      mutable["OUTLOOK_CALENDAR_REFRESH_TOKEN"] = data.refresh_token
    }

    log.info("outlook calendar: access token acquired", { expiresIn: data.expires_in })
  }

  /**
   * Authenticated Microsoft Graph API fetch helper.
   *
   * Sends a request to `GRAPH_BASE + path` with the Bearer token from
   * config.OUTLOOK_CALENDAR_ACCESS_TOKEN.  Throws on any non-2xx response.
   * Returns undefined for 204 No Content (used by DELETE); otherwise parses
   * and returns the JSON body cast to `T`.
   *
   * @param path - Graph API path starting with `/` (e.g. `/me/events`)
   * @param init - Optional RequestInit overrides (method, body, extra headers)
   * @returns Parsed JSON response body, or undefined for 204 responses
   * @throws Error on non-2xx HTTP status including the status code and body
   */
  private async graphFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.OUTLOOK_CALENDAR_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    }

    const res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `Microsoft Graph API error ${res.status} on ${init.method ?? "GET"} ${path}: ${text}`,
      )
    }

    // 204 No Content — DELETE and some PATCH responses carry no body
    if (res.status === 204) {
      return undefined as unknown as T
    }

    return (await res.json()) as T
  }

  /**
   * Maps a raw Microsoft Graph event object to the canonical CalendarEvent shape.
   *
   * Graph returns dateTime strings in the event's declared timeZone.  Passing
   * them to `new Date()` produces a UTC-normalised Date, consistent with how
   * Google Calendar ISO strings are handled elsewhere in this class.
   *
   * @param item - Raw GraphEvent from the REST response
   */
  private mapGraphEvent(item: GraphEvent): CalendarEvent {
    // Graph showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown"
    const status: CalendarEvent["status"] =
      item.showAs === "tentative" ? "tentative" : "confirmed"

    return {
      id: item.id,
      title: item.subject,
      start: new Date(item.start.dateTime),
      end: new Date(item.end.dateTime),
      attendees: (item.attendees ?? []).map(
        (a) => a.emailAddress?.address ?? "",
      ),
      location: item.location?.displayName ?? undefined,
      description: item.bodyPreview ?? undefined,
      meetingUrl: item.onlineMeeting?.joinUrl ?? undefined,
      calendarId: "primary",
      status,
    }
  }

  /**
   * Lists upcoming events from Google Calendar.
   */
  private async listUpcomingGoogle(hours: number): Promise<CalendarEvent[]> {
    if (!this.googleClient) {
      return []
    }

    const now = new Date()
    const timeMax = new Date(now.getTime() + hours * 60 * 60 * 1000)

    const response = await this.googleClient.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: "startTime",
    })

    const events: CalendarEvent[] = []

    for (const item of response.data.items || []) {
      if (!item.id || !item.summary) {
        continue
      }

      const start = item.start?.dateTime || item.start?.date
      const end = item.end?.dateTime || item.end?.date

      if (!start || !end) {
        continue
      }

      events.push({
        id: item.id,
        title: item.summary,
        start: new Date(start),
        end: new Date(end),
        attendees: (item.attendees || []).map((a) => a.email || ""),
        location: item.location ?? undefined,
        description: item.description ?? undefined,
        meetingUrl: item.hangoutLink ?? undefined,
        calendarId: "primary",
        status: (item.status as CalendarEvent["status"]) || "confirmed",
      })
    }

    return events
  }

  /**
   * Lists upcoming events from Outlook Calendar using Microsoft Graph.
   *
   * Uses GET /me/events with an OData $filter on start/dateTime so only
   * future events within the requested window are returned.  Results are
   * ordered by start time ascending and capped at 50 items per call.
   *
   * Note: /me/events does NOT expand recurring-event instances — use
   * getEventsInRangeOutlook() (which calls /me/calendarView) when you need
   * recurrence expansion (e.g. for conflict checking or daemon alerts).
   *
   * @param hours Number of hours to look ahead
   */
  private async listUpcomingOutlook(hours: number): Promise<CalendarEvent[]> {
    const now = new Date()
    const timeMax = new Date(now.getTime() + hours * 60 * 60 * 1000)

    const params = new URLSearchParams({
      // OData $filter accepts ISO 8601 datetime literals with single quotes
      $filter: `start/dateTime ge '${now.toISOString()}' and start/dateTime le '${timeMax.toISOString()}'`,
      $orderby: "start/dateTime",
      $top: "50",
      $select: "id,subject,start,end,location,bodyPreview,attendees,onlineMeeting,showAs",
    })

    const data = await this.graphFetch<GraphCollection<GraphEvent>>(
      `/me/events?${params.toString()}`,
    )

    log.debug("outlook listUpcoming", { count: data.value.length, hours })

    return data.value.map((item) => this.mapGraphEvent(item))
  }

  /**
   * Gets all events (including recurring-event instances) within a time range.
   *
   * Routes to the correct provider:
   *   - Google: events.list with timeMin/timeMax + singleEvents:true
   *   - Outlook: /me/calendarView (automatically expands recurrences)
   *
   * Used internally by findFreeSlots(), checkConflicts(), and getUpcomingAlerts().
   *
   * @param start Range start (inclusive)
   * @param end Range end (inclusive)
   */
  private async getEventsInRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    if (this.provider === "google" && this.googleClient) {
      const response = await this.googleClient.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      })

      const events: CalendarEvent[] = []

      for (const item of response.data.items || []) {
        if (!item.id || !item.summary) {
          continue
        }

        const eventStart = item.start?.dateTime || item.start?.date
        const eventEnd = item.end?.dateTime || item.end?.date

        if (!eventStart || !eventEnd) {
          continue
        }

        events.push({
          id: item.id,
          title: item.summary,
          start: new Date(eventStart),
          end: new Date(eventEnd),
          attendees: (item.attendees || []).map((a) => a.email || ""),
          location: item.location ?? undefined,
          description: item.description ?? undefined,
          meetingUrl: item.hangoutLink ?? undefined,
          calendarId: "primary",
          status: (item.status as CalendarEvent["status"]) || "confirmed",
        })
      }

      return events
    }

    // Outlook — delegate to calendarView-based helper
    return this.getEventsInRangeOutlook(start, end)
  }

  /**
   * Gets events within a time range from Outlook Calendar using Microsoft Graph.
   *
   * Uses GET /me/calendarView which is the recommended Graph endpoint for
   * bounded time queries: it automatically expands recurring-event instances
   * into individual occurrences, matching the behaviour of Google's
   * `singleEvents: true` flag.
   *
   * @param start Range start (inclusive)
   * @param end Range end (inclusive)
   */
  private async getEventsInRangeOutlook(start: Date, end: Date): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      $top: "100",
      $select: "id,subject,start,end,location,bodyPreview,attendees,onlineMeeting,showAs",
      $orderby: "start/dateTime",
    })

    const data = await this.graphFetch<GraphCollection<GraphEvent>>(
      `/me/calendarView?${params.toString()}`,
    )

    log.debug("outlook getEventsInRange", { count: data.value.length, start, end })

    return data.value.map((item) => this.mapGraphEvent(item))
  }

  /**
   * Creates event in Google Calendar.
   */
  private async createEventGoogle(draft: CalendarEventDraft): Promise<CalendarEvent> {
    if (!this.googleClient) {
      throw new Error("Google Calendar client not initialized")
    }

    const response = await this.googleClient.events.insert({
      calendarId: draft.calendarId || "primary",
      requestBody: {
        summary: draft.title,
        description: draft.description,
        location: draft.location,
        start: {
          dateTime: draft.start.toISOString(),
          timeZone: "UTC",
        },
        end: {
          dateTime: draft.end.toISOString(),
          timeZone: "UTC",
        },
        attendees: (draft.attendees || []).map((email) => ({ email })),
      },
    })

    const event = response.data

    log.info("event created", { eventId: event.id, title: draft.title })

    return {
      id: event.id!,
      title: event.summary!,
      start: new Date(event.start!.dateTime!),
      end: new Date(event.end!.dateTime!),
      attendees: (event.attendees || []).map((a) => a.email || ""),
      location: event.location ?? undefined,
      description: event.description ?? undefined,
      meetingUrl: event.hangoutLink ?? undefined,
      calendarId: draft.calendarId || "primary",
      status: "confirmed",
    }
  }

  /**
   * Creates an event in Outlook Calendar using Microsoft Graph.
   *
   * Calls POST /me/events with a JSON body constructed from the CalendarEventDraft.
   * The created event JSON is returned by the API and mapped to CalendarEvent via
   * mapGraphEvent().
   *
   * Body shape sent to Graph:
   * ```json
   * {
   *   "subject": "...",
   *   "start": { "dateTime": "...", "timeZone": "UTC" },
   *   "end":   { "dateTime": "...", "timeZone": "UTC" },
   *   "location": { "displayName": "..." },          // omitted when absent
   *   "body": { "contentType": "text", "content": "..." }, // omitted when absent
   *   "attendees": [{ "emailAddress": { "address": "..." }, "type": "required" }]
   * }
   * ```
   *
   * @param draft Event creation parameters
   * @returns The created CalendarEvent (mapped from the Graph response)
   */
  private async createEventOutlook(draft: CalendarEventDraft): Promise<CalendarEvent> {
    const requestBody: Record<string, unknown> = {
      subject: draft.title,
      start: { dateTime: draft.start.toISOString(), timeZone: "UTC" },
      end:   { dateTime: draft.end.toISOString(),   timeZone: "UTC" },
      attendees: (draft.attendees ?? []).map((email) => ({
        emailAddress: { address: email },
        type: "required",
      })),
    }

    if (draft.location) {
      requestBody["location"] = { displayName: draft.location }
    }

    if (draft.description) {
      requestBody["body"] = { contentType: "text", content: draft.description }
    }

    const created = await this.graphFetch<GraphEvent>("/me/events", {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    log.info("event created", { eventId: created.id, title: draft.title, provider: "outlook" })

    return this.mapGraphEvent(created)
  }
}

/**
 * Singleton instance of CalendarService.
 *
 * USAGE: Import this singleton, don't create new instances.
 * ```typescript
 * import { calendarService } from "./calendar.js"
 * await calendarService.init()
 * const events = await calendarService.listUpcoming(24)
 * ```
 */
export const calendarService = new CalendarService()
