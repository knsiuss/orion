/**
 * @file alerting.ts
 * @description Lightweight self-monitoring alerting service.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by daemon.ts on every cycle (approximately every minute).
 *   Checks two conditions:
 *     1. Outbox dead-letter accumulation (threshold: ALERT_DEAD_LETTER_THRESHOLD)
 *     2. Circuit breaker open on >= 2 channels simultaneously
 *   Sends self-alert messages to ALERT_USER_ID via channelManager when triggered.
 *   A 30-minute cooldown per alert type prevents alert storms.
 *   Alerts are silent when ALERT_USER_ID is empty (disabled by default).
 *
 * @module observability/alerting
 */

import { channelManager } from "../channels/manager.js"
import { outbox } from "../channels/outbox.js"
import { channelCircuitBreaker } from "../channels/circuit-breaker.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("observability.alerting")

/** Cooldown between repeated alerts of the same type (30 minutes). */
const ALERT_COOLDOWN_MS = 30 * 60 * 1_000

/** Channels to check for circuit-breaker state. */
const MONITORED_CHANNELS = ["telegram", "discord", "whatsapp", "sms", "email", "webchat"]

/**
 * Lightweight self-monitoring alerting service.
 * Instantiate fresh for each test; use the `alertingService` singleton in production.
 */
export class AlertingService {
  /** Last send time per alert type — used to enforce cooldown. */
  private readonly lastAlertAt = new Map<string, number>()

  /**
   * Run all alert checks. Call once per daemon cycle.
   * No-op if ALERT_USER_ID is not configured.
   */
  async check(): Promise<void> {
    if (!config.ALERT_USER_ID) return
    await Promise.all([
      this.checkDeadLetters(),
      this.checkCircuitBreakers(),
    ])
  }

  /** Check outbox dead-letter accumulation. */
  private async checkDeadLetters(): Promise<void> {
    const { deadLetters } = outbox.getStatus()
    if (deadLetters >= config.ALERT_DEAD_LETTER_THRESHOLD) {
      await this.sendAlert(
        "dead-letter",
        `[EDITH Alert] Outbox dead-letter count reached ${deadLetters} — messages are being dropped after max retries.`,
      )
    }
  }

  /** Check if multiple circuit breakers are open simultaneously. */
  private async checkCircuitBreakers(): Promise<void> {
    const open = MONITORED_CHANNELS.filter(
      (ch) => channelCircuitBreaker.getState(ch) === "open",
    )
    if (open.length >= 2) {
      await this.sendAlert(
        "circuit-breaker",
        `[EDITH Alert] circuit breaker open on ${open.length} channels: ${open.join(", ")}.`,
      )
    }
  }

  /**
   * Send an alert to ALERT_USER_ID, respecting the cooldown window.
   *
   * @param type - Alert type identifier for cooldown tracking
   * @param message - Alert message text
   */
  private async sendAlert(type: string, message: string): Promise<void> {
    const now = Date.now()
    const lastSent = this.lastAlertAt.get(type) ?? 0
    if (now - lastSent < ALERT_COOLDOWN_MS) return

    this.lastAlertAt.set(type, now)
    log.warn("sending self-alert", { type, userId: config.ALERT_USER_ID })
    await channelManager.send(config.ALERT_USER_ID, message)
      .catch((err) => log.warn("alert send failed", { type, err: String(err) }))
  }
}

/** Singleton alerting service. */
export const alertingService = new AlertingService()
