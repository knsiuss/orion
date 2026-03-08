/**
 * @file sensor-automation.ts
 * @description Rule engine for sensor-driven automation actions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Rules are added by skill modules or startup configuration.
 *   - evaluate() is called by sensor drivers when new readings arrive.
 *   - Actions typically delegate to desk-controller or relay-driver.
 */

import { createLogger } from "../logger.js"
import type { SensorReading } from "./types.js"

const log = createLogger("hardware.sensor-automation")

/** A single automation rule binding a condition to an action. */
interface AutomationRule {
  /** Unique rule identifier. */
  id: string
  /** Predicate that must return true for the action to fire. */
  condition: (r: SensorReading) => boolean
  /** Async action to execute when condition is met. */
  action: (r: SensorReading) => Promise<void>
}

/**
 * Rule engine that evaluates sensor readings against registered automation rules.
 * Rules are checked synchronously; actions run asynchronously (fire-and-forget).
 */
export class SensorAutomation {
  /** Registered automation rules keyed by rule ID. */
  private readonly rules = new Map<string, AutomationRule>()

  /**
   * Add an automation rule.
   * Replaces any existing rule with the same ID.
   *
   * @param id        - Unique rule identifier.
   * @param condition - Predicate that receives a SensorReading and returns boolean.
   * @param action    - Async function called when condition is true.
   */
  addRule(
    id: string,
    condition: (r: SensorReading) => boolean,
    action: (r: SensorReading) => Promise<void>,
  ): void {
    this.rules.set(id, { id, condition, action })
    log.debug("automation rule added", { id })
  }

  /**
   * Remove an automation rule by ID.
   *
   * @param id - Rule identifier to remove.
   */
  removeRule(id: string): void {
    this.rules.delete(id)
    log.debug("automation rule removed", { id })
  }

  /**
   * Evaluate all registered rules against a sensor reading.
   * Rules whose conditions match have their action fired-and-forgotten.
   *
   * @param reading - Incoming sensor reading to test against all rules.
   */
  async evaluate(reading: SensorReading): Promise<void> {
    for (const rule of this.rules.values()) {
      let matched = false
      try {
        matched = rule.condition(reading)
      } catch (err) {
        log.warn("rule condition threw", { ruleId: rule.id, err })
        continue
      }
      if (matched) {
        log.debug("rule triggered", { ruleId: rule.id, deviceId: reading.deviceId })
        void rule.action(reading).catch((err) =>
          log.warn("rule action failed", { ruleId: rule.id, err }),
        )
      }
    }
  }
}

/** Singleton sensor automation engine. */
export const sensorAutomation = new SensorAutomation()
