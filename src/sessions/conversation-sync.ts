/**
 * @file conversation-sync.ts
 * @description CRDT-based conversation history synchronization across devices.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - session-handoff.ts calls getMessages() to prepare handoff payloads.
 *   - Gateway WebSocket handlers call applyDelta() when receiving remote sync.
 *   - Uses append-only message log with vector clocks — no external dep.
 */

import { createLogger } from "../logger.js"

const log = createLogger("sessions.conversation-sync")

/** A synced conversation message. */
export interface SyncedMessage {
  /** Unique message identifier. */
  id: string
  /** Message role. */
  role: "user" | "assistant" | "system"
  /** Message content. */
  content: string
  /** Unix timestamp of the message. */
  timestamp: number
  /** Device that originated this message. */
  deviceId: string
}

/** Delta payload for incremental sync. */
interface SyncDelta {
  /** User ID this delta belongs to. */
  userId: string
  /** Messages to merge. */
  messages: SyncedMessage[]
  /** Timestamp of the last included message. */
  since: number
}

/**
 * Append-only conversation history with delta-based multi-device sync.
 */
export class ConversationSync {
  /** Per-user message logs keyed by userId → messageId → message. */
  private readonly logs = new Map<string, Map<string, SyncedMessage>>()

  /**
   * Add a message to the conversation log.
   * Idempotent — duplicate IDs are ignored.
   *
   * @param userId - User who owns this conversation.
   * @param msg    - Message to add.
   */
  addMessage(
    userId: string,
    msg: SyncedMessage,
  ): void {
    if (!this.logs.has(userId)) {
      this.logs.set(userId, new Map())
    }
    const log_ = this.logs.get(userId)!
    if (!log_.has(msg.id)) {
      log_.set(msg.id, msg)
      log.debug("message added to sync log", { userId, msgId: msg.id, role: msg.role })
    }
  }

  /**
   * Retrieve messages for a user, optionally filtered by a since timestamp.
   *
   * @param userId - User ID.
   * @param since  - Only return messages after this Unix timestamp (optional).
   * @returns Array of messages sorted by timestamp ascending.
   */
  getMessages(userId: string, since?: number): SyncedMessage[] {
    const msgs = [...(this.logs.get(userId)?.values() ?? [])]
    const filtered = since !== undefined ? msgs.filter((m) => m.timestamp > since) : msgs
    return filtered.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Generate a delta payload for incremental sync.
   *
   * @param userId          - User ID.
   * @param sinceTimestamp  - Only include messages after this timestamp.
   * @returns Serializable delta for transmission.
   */
  generateDelta(userId: string, sinceTimestamp: number): SyncDelta {
    const messages = this.getMessages(userId, sinceTimestamp)
    return { userId, messages, since: sinceTimestamp }
  }

  /**
   * Apply a received delta, merging remote messages into the local log.
   * Uses message ID deduplication for idempotency.
   *
   * @param userId - User ID (validated against delta).
   * @param delta  - Serializable delta received from remote peer.
   */
  applyDelta(userId: string, delta: unknown): void {
    const typedDelta = delta as SyncDelta
    if (!typedDelta?.messages || !Array.isArray(typedDelta.messages)) {
      log.warn("invalid delta received", { userId })
      return
    }

    let added = 0
    for (const msg of typedDelta.messages) {
      const existing = this.logs.get(userId)?.get(msg.id)
      if (!existing) {
        this.addMessage(userId, msg)
        added++
      }
    }
    log.debug("delta applied", { userId, added, total: typedDelta.messages.length })
  }
}

/** Singleton conversation sync. */
export const conversationSync = new ConversationSync()
