/**
 * @file line.ts
 * @description LINE Messaging API channel adapter for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements BaseChannel (src/channels/base.ts). Registered in
 *   src/channels/manager.ts. Outbound messages use the LINE push API
 *   (api.line.me/v2/bot/message/push).
 *
 *   INBOUND (webhook): LINE does not expose a pull/polling API for messages.
 *   Inbound messages arrive exclusively via webhook. The gateway (gateway/server.ts)
 *   must register a POST /webhook/line route and call
 *   `lineChannel.ingestWebhookEvents(events)` for each verified request.
 *   Webhook signature verification (X-Line-Signature HMAC-SHA256) must be
 *   performed in the gateway route using LINE_CHANNEL_SECRET before delegating
 *   here — this channel trusts that the caller has already verified.
 *
 *   The pollInterval field drives a keep-alive heartbeat log so ops can confirm
 *   the channel is alive between webhook deliveries. It does NOT perform any
 *   API polling (no pull API exists for LINE inbound messages).
 *
 *   Required env vars: LINE_CHANNEL_TOKEN, LINE_CHANNEL_SECRET
 */

import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.line")

/** How often to emit a heartbeat log confirming the LINE channel is alive. */
const LINE_HEARTBEAT_INTERVAL_MS = 60_000

/** HTTP timeout for LINE API push calls in milliseconds. */
const LINE_API_TIMEOUT_MS = 10_000

/** Minimum shape of a LINE webhook message event. */
interface LineMessageEvent {
  type: string
  source?: {
    type?: string
    userId?: string
    groupId?: string
    roomId?: string
  }
  message?: {
    type?: string
    text?: string
  }
  replyToken?: string
}

export class LineChannel implements BaseChannel {
  readonly name = "line"

  private running = false

  /**
   * Heartbeat interval — emits a log every minute so monitoring can confirm
   * the channel is alive between webhook deliveries. LINE has no pull API, so
   * this does not perform any network request.
   */
  private pollInterval: ReturnType<typeof setInterval> | null = null

  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  /** Serialises inbound processing per-user so replies never interleave. */
  private readonly inboundChains = new Map<string, Promise<void>>()

  async start(): Promise<void> {
    if (!config.LINE_CHANNEL_TOKEN.trim() || !config.LINE_CHANNEL_SECRET.trim()) {
      log.info("LINE disabled: missing LINE_CHANNEL_TOKEN or LINE_CHANNEL_SECRET")
      return
    }

    this.running = true

    // LINE uses webhooks — no pull API exists.
    // Wire POST /webhook/line in gateway/server.ts to call lineChannel.ingestWebhookEvents().
    this.pollInterval = setInterval(() => {
      log.debug(
        "LINE channel alive — inbound messages arrive via POST /webhook/line (no pull API)",
      )
    }, LINE_HEARTBEAT_INTERVAL_MS)

    log.info(
      "LINE channel started — register https://<host>/webhook/line in LINE Developer Console",
    )
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.inboundChains.clear()
    log.info("LINE channel stopped")
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "line")
      const chunks = splitMessage(rendered, 3000)
      for (const chunk of chunks) {
        const response = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LINE_CHANNEL_TOKEN}`,
          },
          body: JSON.stringify({
            to: userId,
            messages: [{ type: "text", text: chunk }],
          }),
          signal: AbortSignal.timeout(LINE_API_TIMEOUT_MS),
        })

        if (!response.ok) {
          log.warn("LINE send failed", { status: response.status, userId })
          return false
        }
      }

      return true
    } catch (error) {
      log.error("LINE send error", { userId, error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  /**
   * Entry point for the gateway webhook route. The gateway must:
   *   1. Verify X-Line-Signature (HMAC-SHA256 of raw body with LINE_CHANNEL_SECRET)
   *   2. Parse the JSON body and extract `body.events`
   *   3. Call this method with the events array.
   *
   * Only `message` events with `message.type === "text"` are processed.
   * Group/room source events are supported — the LINE userId is always used as
   * the EDITH user identifier so memory and preferences are preserved regardless
   * of which chat the message arrived in.
   *
   * @param events - Array of LINE webhook event objects from the verified payload
   */
  ingestWebhookEvents(events: LineMessageEvent[]): void {
    for (const event of events) {
      if (event.type !== "message" || event.message?.type !== "text") {
        continue
      }

      const text = event.message.text?.trim()
      const lineUserId = event.source?.userId

      if (!text || !lineUserId) {
        log.debug("LINE: skipping event with missing text or userId", { eventType: event.type })
        continue
      }

      const edithUserId = `line:${lineUserId}`
      this.enqueueReply(edithUserId, text)
      this.enqueueInboundProcessing(edithUserId, lineUserId, text)
    }
  }

  /**
   * Serialises message processing per-user so concurrent webhook deliveries
   * cannot cause out-of-order replies.
   *
   * @param edithUserId - EDITH-internal user ID (e.g. `line:<lineUserId>`)
   * @param lineUserId  - LINE user ID used for outbound push
   * @param text        - Raw message text to process
   */
  private enqueueInboundProcessing(edithUserId: string, lineUserId: string, text: string): void {
    const current = this.inboundChains.get(edithUserId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await handleIncomingUserMessage(edithUserId, text, "line")
          const sent = await this.send(lineUserId, response)
          if (!sent) {
            log.warn("LINE response send returned false", { edithUserId })
          }
        } catch (error) {
          log.error("LINE inbound processing failed", { edithUserId, error })
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
}

export const lineChannel = new LineChannel()
