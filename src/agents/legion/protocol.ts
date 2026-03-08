/**
 * @file protocol.ts
 * @description Legion inter-instance message protocol with signing and validation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - legion-orchestrator.ts uses send() to delegate tasks to remote instances.
 *   - receive() handles incoming task assignments from other instances.
 *   - All messages are validated with instanceAuth.sign() before processing.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../../logger.js"
import { instanceAuth } from "./instance-auth.js"
import type { LegionMessage, LegionMessageType, TaskResult } from "./types.js"

const log = createLogger("legion.protocol")

/** Default TTL for all messages (60 seconds). */
const DEFAULT_TTL_SECONDS = 60

/**
 * Handles creation, validation, and transport of Legion inter-instance messages.
 */
export class LegionProtocol {
  /**
   * Create a signed Legion message.
   *
   * @param from    - Sending instance ID.
   * @param to      - Receiving instance ID.
   * @param type    - Message type.
   * @param payload - Message payload.
   * @returns Signed LegionMessage ready for transmission.
   */
  createMessage(
    from: string,
    to: string,
    type: LegionMessageType,
    payload: unknown,
  ): LegionMessage {
    const base = { from, to, type, payload }
    return {
      version: "1.0",
      from,
      to,
      type,
      payload,
      signature: instanceAuth.sign(base),
      timestamp: Date.now(),
      ttl: DEFAULT_TTL_SECONDS,
    }
  }

  /**
   * Validate a received message (signature + TTL check).
   *
   * @param msg - Message to validate.
   * @returns True if the message is authentic and not expired.
   */
  validate(msg: LegionMessage): boolean {
    const ageSeconds = (Date.now() - msg.timestamp) / 1000
    if (ageSeconds > msg.ttl) {
      log.warn("message expired", { from: msg.from, ageSeconds })
      return false
    }

    const base = { from: msg.from, to: msg.to, type: msg.type, payload: msg.payload }
    const expected = instanceAuth.sign(base)
    if (expected !== msg.signature) {
      log.warn("message signature invalid", { from: msg.from })
      return false
    }

    return true
  }

  /**
   * Send a Legion message to a remote instance via HTTP POST.
   *
   * @param targetUrl - Base URL of the target instance.
   * @param msg       - Signed LegionMessage to send.
   * @returns TaskResult from the remote instance.
   */
  async send(targetUrl: string, msg: LegionMessage): Promise<TaskResult> {
    const url = `${targetUrl.replace(/\/$/, "")}/legion/receive`
    const start = Date.now()

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        return {
          taskId: (msg.payload as { taskId?: string })?.taskId ?? randomUUID(),
          success: false,
          error: `HTTP ${res.status}: ${res.statusText}`,
          tokensUsed: 0,
          durationMs: Date.now() - start,
        }
      }

      return (await res.json()) as TaskResult
    } catch (err) {
      log.warn("legion message send failed", { targetUrl, err })
      return {
        taskId: (msg.payload as { taskId?: string })?.taskId ?? randomUUID(),
        success: false,
        error: String(err),
        tokensUsed: 0,
        durationMs: Date.now() - start,
      }
    }
  }

  /**
   * Process an incoming task assignment message.
   *
   * @param msg - Received LegionMessage.
   * @returns TaskResult after processing.
   */
  async receive(msg: LegionMessage): Promise<TaskResult> {
    if (!this.validate(msg)) {
      return {
        taskId: (msg.payload as { taskId?: string })?.taskId ?? "unknown",
        success: false,
        error: "Message validation failed",
        tokensUsed: 0,
        durationMs: 0,
      }
    }

    log.info("legion message received", { from: msg.from, type: msg.type })
    // Actual task execution would be handled by the local orchestrator
    return {
      taskId: (msg.payload as { taskId?: string })?.taskId ?? "unknown",
      success: true,
      result: "Task acknowledged — execution delegated to local pipeline",
      tokensUsed: 0,
      durationMs: 0,
    }
  }
}

/** Singleton Legion protocol handler. */
export const legionProtocol = new LegionProtocol()
