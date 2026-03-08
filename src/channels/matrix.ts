/**
 * @file matrix.ts
 * @description Matrix client-server API channel adapter for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements BaseChannel (src/channels/base.ts). Registered in
 *   src/channels/manager.ts. Outbound messages use the Matrix
 *   `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`
 *   endpoint with a unique transaction ID per chunk to guarantee idempotency.
 *
 *   INBOUND (sync polling): The Matrix client-server API provides a long-poll
 *   sync endpoint (`/_matrix/client/v3/sync`). On start(), an initial sync
 *   with timeout=0 seeds the syncToken so we do not replay existing history.
 *   A setInterval then calls fetchIncoming() every MATRIX_POLL_INTERVAL_MS,
 *   which performs a sync with a short server-side timeout to pick up new
 *   events. Events of type `m.room.message` with msgtype `m.text` that were
 *   not sent by this bot (filtered via botMxid) are dispatched into the EDITH
 *   pipeline via handleIncomingUserMessage.
 *
 *   Required env vars:
 *     MATRIX_HOMESERVER    — e.g. https://matrix.example.org
 *     MATRIX_ACCESS_TOKEN  — bot user access token
 *     MATRIX_ROOM_ID       — room to monitor (e.g. !abc123:example.org)
 */

import crypto from "node:crypto"

import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.matrix")

/** How often to call the Matrix /sync endpoint to pick up new events. */
const MATRIX_POLL_INTERVAL_MS = 5_000

/** Server-side long-poll timeout sent in the sync request (milliseconds). */
const MATRIX_SYNC_TIMEOUT_MS = 3_000

/** HTTP timeout for Matrix API calls (milliseconds). */
const MATRIX_API_TIMEOUT_MS = 15_000

/** A single room timeline event from the Matrix sync response. */
interface MatrixTimelineEvent {
  type: string
  event_id: string
  sender: string
  content: {
    msgtype?: string
    body?: string
  }
}

/** Partial shape of the Matrix /sync response we care about. */
interface MatrixSyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: {
          events?: MatrixTimelineEvent[]
        }
      }
    >
  }
}

/** Shape of the /whoami response used to discover the bot's own MXID. */
interface MatrixWhoAmIResponse {
  user_id: string
}

export class MatrixChannel implements BaseChannel {
  readonly name = "matrix"

  private running = false

  /** Tracks the setInterval handle so it can be cleared on stop(). */
  private pollInterval: ReturnType<typeof setInterval> | null = null

  /**
   * The Matrix sync `next_batch` token from the previous sync response.
   * Null before the first successful sync (initial seed).
   */
  private syncToken: string | null = null

  /**
   * The bot's own Matrix user ID (MXID), resolved via /whoami at startup.
   * Used to filter out events sent by this bot from inbound processing.
   */
  private botMxid: string | null = null

  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  /** Serialises inbound processing per-sender so replies never interleave. */
  private readonly inboundChains = new Map<string, Promise<void>>()

  async start(): Promise<void> {
    if (
      !config.MATRIX_HOMESERVER.trim() ||
      !config.MATRIX_ACCESS_TOKEN.trim() ||
      !config.MATRIX_ROOM_ID.trim()
    ) {
      log.info("Matrix disabled: missing MATRIX_HOMESERVER/MATRIX_ACCESS_TOKEN/MATRIX_ROOM_ID")
      return
    }

    // Resolve the bot's own MXID so we can filter its own events.
    try {
      const whoami = await this.apiGet<MatrixWhoAmIResponse>("/_matrix/client/v3/account/whoami")
      this.botMxid = whoami.user_id
      log.debug("Matrix bot MXID resolved", { botMxid: this.botMxid })
    } catch (error) {
      log.warn("Matrix: failed to resolve bot MXID — own events may be re-processed", { error })
    }

    // Seed syncToken with current state so we don't replay history.
    await this.seedSyncToken()

    this.running = true

    this.pollInterval = setInterval(() => {
      void this.fetchIncoming()
        .catch((err: unknown) => log.warn("Matrix poll error", { err }))
    }, MATRIX_POLL_INTERVAL_MS)

    log.info("Matrix channel started", {
      homeserver: config.MATRIX_HOMESERVER,
      roomId: config.MATRIX_ROOM_ID,
      pollIntervalMs: MATRIX_POLL_INTERVAL_MS,
    })
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.inboundChains.clear()
    log.info("Matrix channel stopped")
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "matrix")
      const roomId = userId || config.MATRIX_ROOM_ID
      const chunks = splitMessage(rendered, 3000)

      for (const chunk of chunks) {
        const txnId = crypto.randomUUID()
        const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`

        const response = await fetch(`${config.MATRIX_HOMESERVER}${path}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.MATRIX_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            msgtype: "m.text",
            body: chunk,
          }),
          signal: AbortSignal.timeout(MATRIX_API_TIMEOUT_MS),
        })

        if (!response.ok) {
          log.warn("Matrix send failed", { status: response.status, roomId })
          return false
        }
      }

      return true
    } catch (error) {
      log.error("Matrix send error", { error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  /**
   * Calls `/_matrix/client/v3/sync` to retrieve new room timeline events since
   * the last known syncToken. For each `m.room.message` text event not sent by
   * the bot itself, the message is dispatched into the EDITH pipeline and the
   * bot's response is sent back to the originating room.
   *
   * Updates `this.syncToken` to the `next_batch` value from the response so
   * subsequent calls only receive events that arrived after this poll.
   */
  private async fetchIncoming(): Promise<void> {
    if (!this.running) {
      return
    }

    const params = new URLSearchParams({ timeout: String(MATRIX_SYNC_TIMEOUT_MS) })
    if (this.syncToken) {
      params.set("since", this.syncToken)
    }

    let syncData: MatrixSyncResponse
    try {
      syncData = await this.apiGet<MatrixSyncResponse>(
        `/_matrix/client/v3/sync?${params.toString()}`,
      )
    } catch (error) {
      log.warn("Matrix sync request failed", { error })
      return
    }

    this.syncToken = syncData.next_batch

    const joinedRooms = syncData.rooms?.join ?? {}
    for (const [roomId, roomData] of Object.entries(joinedRooms)) {
      const events = roomData.timeline?.events ?? []
      for (const event of events) {
        if (event.type !== "m.room.message") {
          continue
        }
        if (event.content.msgtype !== "m.text") {
          continue
        }
        // Skip events sent by this bot to prevent feedback loops.
        if (this.botMxid && event.sender === this.botMxid) {
          continue
        }

        const text = event.content.body?.trim()
        if (!text) {
          continue
        }

        // Use the sender's MXID as the EDITH user ID so memory is per-user.
        const edithUserId = `matrix:${event.sender}`
        this.enqueueReply(edithUserId, text)
        this.enqueueInboundProcessing(edithUserId, roomId, text)
      }
    }
  }

  /**
   * Performs an initial sync with timeout=0 to obtain the current `next_batch`
   * token. This prevents replaying all existing room history when EDITH starts.
   */
  private async seedSyncToken(): Promise<void> {
    try {
      const data = await this.apiGet<MatrixSyncResponse>(
        "/_matrix/client/v3/sync?timeout=0",
      )
      this.syncToken = data.next_batch
      log.debug("Matrix syncToken seeded", { syncToken: this.syncToken })
    } catch (error) {
      log.warn("Matrix: failed to seed syncToken — existing messages may be replayed", { error })
    }
  }

  /**
   * Serialises message processing per-sender so concurrent sync responses
   * cannot cause out-of-order replies.
   *
   * @param edithUserId - EDITH-internal user ID (e.g. `matrix:@alice:example.org`)
   * @param roomId      - Matrix room ID to send the reply to
   * @param text        - Raw message text to process
   */
  private enqueueInboundProcessing(edithUserId: string, roomId: string, text: string): void {
    const current = this.inboundChains.get(edithUserId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await handleIncomingUserMessage(edithUserId, text, "matrix")
          const sent = await this.send(roomId, response)
          if (!sent) {
            log.warn("Matrix response send returned false", { edithUserId, roomId })
          }
        } catch (error) {
          log.error("Matrix inbound processing failed", { edithUserId, roomId, error })
        }
      })
      .finally(() => {
        if (this.inboundChains.get(edithUserId) === next) {
          this.inboundChains.delete(edithUserId)
        }
      })

    this.inboundChains.set(edithUserId, next)
  }

  /**
   * Pushes received text into the reply queue so sendWithConfirm() can detect
   * confirmation responses.
   *
   * @param userId  - EDITH-internal user ID
   * @param content - Message text
   */
  private enqueueReply(userId: string, content: string): void {
    const queue = this.replies.get(userId) ?? []
    queue.push({ content, ts: Date.now() })
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50)
    }
    this.replies.set(userId, queue)
  }

  private async getLatestReply(userId: string): Promise<string | null> {
    const queue = this.replies.get(userId)
    if (!queue || queue.length === 0) {
      return null
    }

    const latest = queue.pop()
    return latest?.content ?? null
  }

  /**
   * Performs an authenticated GET against the Matrix homeserver.
   *
   * @param path - URL path including query string (e.g. `/_matrix/client/v3/sync?timeout=0`)
   * @returns Parsed JSON response body cast to T
   * @throws When the HTTP response is not OK or network fails
   */
  private async apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${config.MATRIX_HOMESERVER}${path}`, {
      headers: { Authorization: `Bearer ${config.MATRIX_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(MATRIX_API_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Matrix API GET ${path} failed: HTTP ${response.status}`)
    }

    return response.json() as Promise<T>
  }
}

export const matrixChannel = new MatrixChannel()
