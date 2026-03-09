/**
 * @file imessage.ts
 * @description iMessage channel adapter backed by the BlueBubbles REST API.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements BaseChannel (src/channels/base.ts). Registered in
 *   src/channels/manager.ts. Outbound messages are sent via the
 *   BlueBubbles `/api/v1/message/send` endpoint. Inbound messages are
 *   fetched on a 5-second polling interval by querying
 *   `/api/v1/message?limit=20&sort=desc&where[]=…` and deduplicating
 *   against a seen-ID set. Replies are processed through
 *   handleIncomingUserMessage (src/core/incoming-message-service.ts).
 *
 *   Required env vars: BLUEBUBBLES_URL, BLUEBUBBLES_PASSWORD
 */

import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.imessage")

/** Polling interval in milliseconds between BlueBubbles message list requests. */
const IMESSAGE_POLL_INTERVAL_MS = 5_000

/** Maximum number of recent messages fetched per poll tick. */
const IMESSAGE_POLL_PAGE_SIZE = 20

/** HTTP timeout for BlueBubbles API calls in milliseconds. */
const IMESSAGE_API_TIMEOUT_MS = 10_000

/** Shape of a single message object returned by the BlueBubbles REST API. */
interface BlueBubblesMessage {
  guid: string
  text: string | null
  isFromMe: boolean
  handle?: { address: string } | null
  chats?: Array<{ guid: string }>
}

/** Shape of the BlueBubbles paginated message list response. */
interface BlueBubblesMessageListResponse {
  status: number
  message: string
  data: BlueBubblesMessage[]
}

export class IMessageChannel implements BaseChannel {
  readonly name = "imessage"

  private running = false

  /** Tracks the setInterval handle so it can be cleared on stop(). */
  private pollInterval: ReturnType<typeof setInterval> | null = null

  /** Deduplication set — prevents re-processing messages seen in earlier poll ticks. */
  private readonly seenGuids = new Set<string>()

  /** Maximum entries in seenGuids before oldest-first eviction kicks in. */
  private static readonly SEEN_GUIDS_MAX = 20_000
  /** Target size after evicting oldest entries from seenGuids. */
  private static readonly SEEN_GUIDS_TRIM_TO = 10_000

  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  /** Serialises inbound processing per-chat so replies never interleave. */
  private readonly inboundChains = new Map<string, Promise<void>>()

  async start(): Promise<void> {
    if (!config.BLUEBUBBLES_URL.trim() || !config.BLUEBUBBLES_PASSWORD.trim()) {
      log.info("iMessage disabled: missing BLUEBUBBLES_URL or BLUEBUBBLES_PASSWORD")
      return
    }

    this.running = true

    // Seed the seen-GUID set with messages already on the server so we do not
    // replay history that existed before EDITH started.
    await this.seedSeenGuids()

    this.pollInterval = setInterval(() => {
      void this.fetchIncoming()
        .catch((err: unknown) => log.warn("iMessage poll error", { err }))
    }, IMESSAGE_POLL_INTERVAL_MS)

    log.info("iMessage channel started", { pollIntervalMs: IMESSAGE_POLL_INTERVAL_MS })
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.inboundChains.clear()
    log.info("iMessage channel stopped")
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "imessage")
      const endpoint = `${config.BLUEBUBBLES_URL.replace(/\/$/, "")}/api/v1/message/send`
      const chunks = splitMessage(rendered, 3000)

      for (const chunk of chunks) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.BLUEBUBBLES_PASSWORD}`,
          },
          body: JSON.stringify({
            chatGuid: userId,
            message: chunk,
          }),
          signal: AbortSignal.timeout(IMESSAGE_API_TIMEOUT_MS),
        })

        if (!response.ok) {
          log.warn("iMessage send failed", { status: response.status })
          return false
        }
      }

      return true
    } catch (error) {
      log.error("iMessage send error", { error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  /**
   * Fetches the most recent messages from BlueBubbles and dispatches any
   * unseen, inbound (not-from-me) text messages into the EDITH pipeline.
   *
   * BlueBubbles endpoint:
   *   GET /api/v1/message?limit=N&sort=desc
   *
   * We skip messages that:
   *   - Have no text body
   *   - Were sent by this device (isFromMe === true)
   *   - Have already been processed (guid in seenGuids)
   */
  private async fetchIncoming(): Promise<void> {
    if (!this.running) {
      return
    }

    const base = config.BLUEBUBBLES_URL.replace(/\/$/, "")
    const url = `${base}/api/v1/message?limit=${IMESSAGE_POLL_PAGE_SIZE}&sort=desc`

    let data: BlueBubblesMessage[]
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.BLUEBUBBLES_PASSWORD}` },
        signal: AbortSignal.timeout(IMESSAGE_API_TIMEOUT_MS),
      })

      if (!response.ok) {
        log.warn("iMessage poll request failed", { status: response.status })
        return
      }

      const body = await response.json() as BlueBubblesMessageListResponse
      data = body.data ?? []
    } catch (error) {
      log.warn("iMessage poll fetch error", { error })
      return
    }

    for (const msg of data) {
      if (!msg.guid || this.seenGuids.has(msg.guid)) {
        continue
      }
      this.seenGuids.add(msg.guid)

      // Evict oldest entries if the set grows too large (JS Sets maintain insertion order).
      if (this.seenGuids.size > IMessageChannel.SEEN_GUIDS_MAX) {
        let evicted = 0
        for (const guid of this.seenGuids) {
          this.seenGuids.delete(guid)
          if (++evicted >= IMessageChannel.SEEN_GUIDS_MAX - IMessageChannel.SEEN_GUIDS_TRIM_TO) break
        }
        log.debug("iMessage seenGuids evicted", { evicted, remaining: this.seenGuids.size })
      }

      if (msg.isFromMe || !msg.text?.trim()) {
        continue
      }

      // Derive a stable userId from the chat GUID or the sender handle address.
      const chatGuid = msg.chats?.[0]?.guid ?? msg.handle?.address ?? "unknown"
      const userId = `imessage:${chatGuid}`
      const text = msg.text.trim()

      this.enqueueReply(userId, text)
      this.enqueueInboundProcessing(userId, chatGuid, text)
    }
  }

  /**
   * On startup, populate seenGuids with the GUIDs already on the server so
   * EDITH does not replay pre-existing messages.
   */
  private async seedSeenGuids(): Promise<void> {
    try {
      const base = config.BLUEBUBBLES_URL.replace(/\/$/, "")
      const url = `${base}/api/v1/message?limit=${IMESSAGE_POLL_PAGE_SIZE}&sort=desc`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.BLUEBUBBLES_PASSWORD}` },
        signal: AbortSignal.timeout(IMESSAGE_API_TIMEOUT_MS),
      })
      if (!response.ok) {
        return
      }
      const body = await response.json() as BlueBubblesMessageListResponse
      for (const msg of body.data ?? []) {
        if (msg.guid) {
          this.seenGuids.add(msg.guid)
        }
      }
      log.debug("iMessage seenGuids seeded", { count: this.seenGuids.size })
    } catch {
      // Non-fatal — worst case we replay a few messages on first boot.
    }
  }

  /**
   * Serialises message processing per-chat so concurrent polls cannot cause
   * out-of-order replies.
   *
   * @param userId   - EDITH-internal user ID (e.g. `imessage:<chatGuid>`)
   * @param chatGuid - BlueBubbles chat GUID used for outbound send
   * @param text     - Raw message text to process
   */
  private enqueueInboundProcessing(userId: string, chatGuid: string, text: string): void {
    const current = this.inboundChains.get(userId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await handleIncomingUserMessage(userId, text, "imessage")
          const sent = await this.send(chatGuid, response)
          if (!sent) {
            log.warn("iMessage response send returned false", { userId })
          }
        } catch (error) {
          log.error("iMessage inbound processing failed", { userId, error })
        }
      })
      .finally(() => {
        if (this.inboundChains.get(userId) === next) {
          this.inboundChains.delete(userId)
        }
      })

    this.inboundChains.set(userId, next)
  }

  /**
   * Pushes a received message into the reply queue so sendWithConfirm() can
   * detect confirmation responses.
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
}

export const iMessageChannel = new IMessageChannel()
