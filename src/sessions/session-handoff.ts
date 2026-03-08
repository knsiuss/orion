/**
 * @file session-handoff.ts
 * @description Transfers active conversation sessions between user devices.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - conversationSync.ts provides the message history payload.
 *   - Gateway WebSocket sends the handoff payload to the target device.
 *   - User experience: mid-conversation continuation on a new device.
 */

import { createLogger } from "../logger.js"
import { conversationSync } from "./conversation-sync.js"

const log = createLogger("sessions.session-handoff")

/** Complete handoff payload for transferring a session to another device. */
export interface HandoffPayload {
  /** Full message history to restore. */
  messages: ReturnType<typeof conversationSync.getMessages>
  /** Summary context for system prompt injection. */
  context: string
  /** Approximate scroll position (message index) for UI restoration. */
  scrollPosition: number
}

/**
 * Prepares and applies session handoffs between user devices.
 */
export class SessionHandoff {
  /**
   * Prepare a handoff payload from one device to another.
   *
   * @param userId       - User performing the handoff.
   * @param fromDeviceId - Device handing off the session.
   * @param toDeviceId   - Device receiving the session.
   * @returns HandoffPayload to send to the target device.
   */
  async prepareHandoff(
    userId: string,
    fromDeviceId: string,
    toDeviceId: string,
  ): Promise<HandoffPayload> {
    const messages = conversationSync.getMessages(userId)
    const recent = messages.slice(-20)
    const context = this.buildContext(recent)
    const scrollPosition = Math.max(0, messages.length - 1)

    log.info("session handoff prepared", {
      userId,
      fromDeviceId,
      toDeviceId,
      messageCount: messages.length,
    })

    return { messages, context, scrollPosition }
  }

  /**
   * Apply a received handoff payload to resume a session on this device.
   *
   * @param userId    - User who owns the session.
   * @param deviceId  - This device's ID.
   * @param handoff   - Received HandoffPayload.
   */
  applyHandoff(userId: string, deviceId: string, handoff: HandoffPayload): void {
    for (const msg of handoff.messages) {
      conversationSync.addMessage(userId, { ...msg, deviceId })
    }
    log.info("session handoff applied", {
      userId,
      deviceId,
      messagesRestored: handoff.messages.length,
    })
  }

  /**
   * Build a brief context summary from recent messages.
   *
   * @param messages - Recent messages to summarize.
   * @returns Context string for system prompt injection.
   */
  private buildContext(messages: ReturnType<typeof conversationSync.getMessages>): string {
    if (messages.length === 0) return ""
    const last = messages[messages.length - 1]
    return `Continuing conversation. Last message (${last?.role ?? "unknown"}): "${(last?.content ?? "").slice(0, 200)}"`
  }
}

/** Singleton session handoff manager. */
export const sessionHandoff = new SessionHandoff()
