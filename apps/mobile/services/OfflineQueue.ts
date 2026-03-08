/**
 * @file OfflineQueue.ts
 * @description Queue outgoing messages when offline, flush when connected.
 *
 * ARCHITECTURE:
 *   Message yang dikirim saat offline → masuk ke queue (AsyncStorage).
 *   Saat WebSocket reconnect → flush queue → kirim semua pesan ke gateway.
 *   Max queue size: 50 pesan (FIFO — yang lama dibuang jika overflow).
 *
 * DIPANGGIL dari:
 *   App.tsx send() — check online sebelum WebSocket send
 *   App.tsx ws.onopen — flush queue saat reconnect
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

/** AsyncStorage key for the offline queue */
const QUEUE_KEY = "edith_offline_queue"

/** Maximum number of queued messages (oldest dropped on overflow) */
const MAX_QUEUE_SIZE = 50

/** A message that was queued while offline */
export interface QueuedMessage {
  /** Raw message text */
  content: string
  /** ISO timestamp when message was queued */
  timestamp: string
  /** User ID for the WebSocket payload */
  userId: string
}

/** Persistent offline message queue backed by AsyncStorage */
export class OfflineQueue {
  /**
   * Append a message to the queue.
   * Silently drops the oldest message when the queue exceeds MAX_QUEUE_SIZE.
   *
   * @param msg - Message to enqueue
   */
  async enqueue(msg: QueuedMessage): Promise<void> {
    const existing = await this.getAll()
    const updated = [...existing, msg].slice(-MAX_QUEUE_SIZE)
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  }

  /**
   * Return all queued messages in FIFO order.
   *
   * @returns Array of queued messages (may be empty)
   */
  async getAll(): Promise<QueuedMessage[]> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    try {
      return JSON.parse(raw) as QueuedMessage[]
    } catch {
      return []
    }
  }

  /**
   * Clear the queue after a successful flush.
   */
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY)
  }

  /**
   * Flush all queued messages via the provided WebSocket send function.
   * Clears the queue after all messages have been dispatched.
   *
   * @param send   - WebSocket send function (accepts serialized JSON string)
   * @param userId - Current user ID to include in each message payload
   * @returns Number of messages that were flushed
   */
  async flush(
    send: (msg: string) => void,
    userId: string,
  ): Promise<number> {
    const messages = await this.getAll()
    if (messages.length === 0) return 0

    for (const msg of messages) {
      send(JSON.stringify({ type: "message", content: msg.content, userId }))
    }

    await this.clear()
    return messages.length
  }
}

/** Singleton offline queue — import this everywhere. */
export const offlineQueue = new OfflineQueue()
