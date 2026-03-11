/**
 * @file triggers.ts
 * @description Trigger engine defining scheduled, inactivity, pattern, and webhook trigger types with YAML-based configuration.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Loaded by background/daemon.ts from permissions/triggers.yaml.
 *   Uses database/index.ts for message history queries.
 */

import fs from "node:fs"

import yaml from "js-yaml"

import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"
import { eventBus } from "../core/event-bus.js"

const logger = createLogger("trigger-engine")

/** Maximum recent messages to scan for pattern triggers. */
const PATTERN_HISTORY_LOOKBACK = 20

export enum TriggerType {
  SCHEDULED = "scheduled",
  INACTIVITY = "inactivity",
  PATTERN = "pattern",
  WEBHOOK = "webhook",
}

export type TriggerPriority = "low" | "normal" | "urgent"

export interface Trigger {
  id: string
  name: string
  type: TriggerType
  enabled: boolean
  priority?: TriggerPriority
  confidence?: number
  schedule?: string
  inactivityMinutes?: number
  /** Regex pattern for PATTERN triggers — matched against recent message history. */
  pattern?: string
  /** Event bus event type for WEBHOOK triggers — fires when the event is dispatched. */
  eventName?: string
  message: string
  userId: string
}

class TriggerEngine {
  private triggers: Trigger[] = []

  /**
   * Set of event bus event types that have fired since the last evaluation cycle.
   * Consumed (cleared) when a matching WEBHOOK trigger evaluates them.
   */
  private readonly firedEvents = new Set<string>()

  /** Whether event bus subscriptions are initialized. */
  private eventSubscriptionsActive = false

  async load(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      this.triggers = []
      logger.warn(`Triggers file missing: ${filePath}`)
      return
    }

    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = yaml.load(raw)

    if (!Array.isArray(parsed)) {
      this.triggers = []
      logger.warn("Triggers file did not contain a list")
      return
    }

    this.triggers = parsed as Trigger[]
    logger.info(`Loaded ${this.triggers.length} triggers`)

    // Subscribe to event bus events for WEBHOOK triggers
    this.initializeEventSubscriptions()
  }

  /**
   * Evaluate all enabled triggers for a user.
   *
   * Handles four trigger types:
   *   - SCHEDULED: cron expression matching
   *   - INACTIVITY: minutes since last message
   *   - PATTERN: regex match against recent conversation history
   *   - WEBHOOK: event bus events fired since last cycle
   *
   * @param userId - User to evaluate triggers for.
   * @returns Array of triggers that matched.
   */
  async evaluate(userId: string): Promise<Trigger[]> {
    const now = new Date()
    const matches: Trigger[] = []

    // Lazily fetch pattern history only if there are pattern triggers
    let patternHistory: string | null = null

    for (const trigger of this.triggers) {
      if (!trigger.enabled || trigger.userId !== userId) {
        continue
      }

      if (trigger.type === TriggerType.SCHEDULED && trigger.schedule) {
        if (cronMatchesNow(trigger.schedule, now)) {
          matches.push(trigger)
        }
      }

      if (trigger.type === TriggerType.INACTIVITY && trigger.inactivityMinutes) {
        const history = await getHistory(userId, 1)
        if (history.length === 0) {
          matches.push(trigger)
          continue
        }
        const last = history[0].createdAt
        const deltaMinutes = (now.getTime() - new Date(last).getTime()) / 60000
        if (deltaMinutes >= trigger.inactivityMinutes) {
          matches.push(trigger)
        }
      }

      // PATTERN triggers: match regex against recent conversation content
      if (trigger.type === TriggerType.PATTERN && trigger.pattern) {
        if (patternHistory === null) {
          patternHistory = await this.fetchPatternHistory(userId)
        }
        if (this.evaluatePattern(trigger.pattern, patternHistory, trigger.name)) {
          matches.push(trigger)
        }
      }

      // WEBHOOK (event) triggers: check if the named event fired since last cycle
      if (trigger.type === TriggerType.WEBHOOK && trigger.eventName) {
        if (this.firedEvents.has(trigger.eventName)) {
          logger.info("Event trigger matched", {
            trigger: trigger.name,
            eventName: trigger.eventName,
          })
          matches.push(trigger)
          // Consume the event so it doesn't fire again next cycle
          this.firedEvents.delete(trigger.eventName)
        }
      }
    }

    return matches
  }

  getTriggers(): Trigger[] {
    return this.triggers
  }

  addTrigger(trigger: Trigger): void {
    this.triggers.push(trigger)
  }

  removeTrigger(id: string): void {
    this.triggers = this.triggers.filter((trigger) => trigger.id !== id)
  }

  /**
   * Manually record an event as fired (for testing or programmatic triggers).
   *
   * @param eventName - The event name to record.
   */
  recordEvent(eventName: string): void {
    this.firedEvents.add(eventName)
  }

  /**
   * Get the set of events that have fired but not yet been consumed.
   */
  getPendingEvents(): ReadonlySet<string> {
    return this.firedEvents
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to typed event bus events that WEBHOOK triggers may reference.
   * Only subscribes once; safe to call multiple times.
   */
  private initializeEventSubscriptions(): void {
    if (this.eventSubscriptionsActive) {
      return
    }
    this.eventSubscriptionsActive = true

    eventBus.on("engine.degraded", (data) => {
      this.firedEvents.add("engine.degraded")
      logger.debug("Event captured for triggers", { event: "engine.degraded", engine: data.engineName })
    })

    eventBus.on("engine.recovered", (data) => {
      this.firedEvents.add("engine.recovered")
      logger.debug("Event captured for triggers", { event: "engine.recovered", engine: data.engineName })
    })

    eventBus.on("system.health.changed", (data) => {
      this.firedEvents.add("system.health.changed")
      logger.debug("Event captured for triggers", {
        event: "system.health.changed",
        component: data.component,
        status: data.newStatus,
      })
    })

    eventBus.on("channel.disconnected", (data) => {
      this.firedEvents.add("channel.disconnected")
      logger.debug("Event captured for triggers", {
        event: "channel.disconnected",
        channel: data.channelName,
      })
    })

    logger.info("Event bus subscriptions initialized for WEBHOOK triggers")
  }

  /**
   * Fetch recent conversation history as a single string for pattern matching.
   */
  private async fetchPatternHistory(userId: string): Promise<string> {
    try {
      const history = await getHistory(userId, PATTERN_HISTORY_LOOKBACK)
      return history.map((h) => h.content).join(" ").toLowerCase()
    } catch (err) {
      logger.warn("Failed to fetch history for pattern trigger", { userId, err })
      return ""
    }
  }

  /**
   * Test a regex pattern against the aggregated history text.
   * Returns false on invalid regex rather than throwing.
   */
  private evaluatePattern(pattern: string, historyText: string, triggerName: string): boolean {
    try {
      const regex = new RegExp(pattern, "i")
      const matched = regex.test(historyText)
      if (matched) {
        logger.info("Pattern trigger matched", { trigger: triggerName, pattern })
      }
      return matched
    } catch (err) {
      logger.warn("Invalid regex in pattern trigger", { trigger: triggerName, pattern, err })
      return false
    }
  }
}

function cronMatchesNow(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return false
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dayOfMonth, date.getDate(), 1, 31) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dayOfWeek, date.getDay(), 0, 6)
  )
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") {
    return true
  }

  const segments = field.split(",")
  for (const segment of segments) {
    if (segment.includes("/")) {
      const [base, stepRaw] = segment.split("/")
      const step = Number.parseInt(stepRaw, 10)
      if (Number.isNaN(step) || step <= 0) {
        continue
      }
      const baseRange = base === "*" ? `${min}-${max}` : base
      if (rangeMatches(baseRange, value, step)) {
        return true
      }
      continue
    }

    if (rangeMatches(segment, value)) {
      return true
    }
  }

  return false
}

function rangeMatches(segment: string, value: number, step = 1): boolean {
  if (segment.includes("-")) {
    const [startRaw, endRaw] = segment.split("-")
    const start = Number.parseInt(startRaw, 10)
    const end = Number.parseInt(endRaw, 10)
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return false
    }
    if (value < start || value > end) {
      return false
    }
    return (value - start) % step === 0
  }

  const numeric = Number.parseInt(segment, 10)
  if (Number.isNaN(numeric)) {
    return false
  }
  if (step <= 1) {
    return value === numeric
  }
  return value >= numeric && (value - numeric) % step === 0
}

export const triggerEngine = new TriggerEngine()
