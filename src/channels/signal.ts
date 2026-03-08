/**
 * @file signal.ts
 * @description Signal channel adapter for EDITH using signal-cli.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements BaseChannel (src/channels/base.ts). Registered in
 *   src/channels/manager.ts. Outbound messages are sent via `signal-cli send`
 *   spawned via execa.
 *
 *   INBOUND (polling): Two modes are supported, tried in priority order:
 *
 *   1. REST API mode (preferred): If SIGNAL_REST_API_URL is set, fetchIncoming()
 *      calls `GET {SIGNAL_REST_API_URL}/v1/receive/{SIGNAL_PHONE_NUMBER}` on the
 *      signal-cli REST daemon (https://github.com/bbernhard/signal-cli-rest-api).
 *      The daemon must be running with `--mode=normal` so the receive endpoint
 *      returns and clears pending messages.
 *
 *   2. CLI mode (fallback): If SIGNAL_REST_API_URL is empty, fetchIncoming()
 *      calls `signal-cli receive --output=json` via execa and parses each
 *      newline-delimited JSON envelope.
 *
 *   A setInterval runs fetchIncoming() every SIGNAL_POLL_INTERVAL_MS. Each
 *   received text message is dispatched through handleIncomingUserMessage and
 *   the response is sent back to the originating number via send().
 *
 *   Required env vars:
 *     SIGNAL_CLI_PATH      — path to signal-cli binary (e.g. /usr/local/bin/signal-cli)
 *     SIGNAL_PHONE_NUMBER  — registered phone number (e.g. +1234567890)
 *   Optional env vars:
 *     SIGNAL_REST_API_URL  — base URL of signal-cli REST daemon (e.g. http://localhost:8080)
 */

import { execa } from "execa"

import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.signal")

/** Polling interval in milliseconds between receive attempts. */
const SIGNAL_POLL_INTERVAL_MS = 5_000

/** HTTP timeout for signal-cli REST API calls in milliseconds. */
const SIGNAL_REST_TIMEOUT_MS = 10_000

/** CLI receive timeout in milliseconds (passed to execa). */
const SIGNAL_CLI_RECEIVE_TIMEOUT_MS = 8_000

/**
 * A single signal-cli JSON envelope as emitted by `signal-cli receive --output=json`
 * or returned by the REST API `/v1/receive/{number}`.
 */
interface SignalEnvelope {
  envelope?: {
    source?: string
    sourceNumber?: string
    dataMessage?: {
      message?: string | null
    }
  }
}

export class SignalChannel implements BaseChannel {
  readonly name = "signal"

  private running = false

  /** Tracks the setInterval handle so it can be cleared on stop(). */
  private pollInterval: ReturnType<typeof setInterval> | null = null

  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  /** Serialises inbound processing per-sender so replies never interleave. */
  private readonly inboundChains = new Map<string, Promise<void>>()

  async start(): Promise<void> {
    if (!config.SIGNAL_CLI_PATH.trim() || !config.SIGNAL_PHONE_NUMBER.trim()) {
      log.info("Signal disabled: missing SIGNAL_CLI_PATH or SIGNAL_PHONE_NUMBER")
      return
    }

    this.running = true

    const mode = config.SIGNAL_REST_API_URL.trim() ? "rest-api" : "cli"
    log.info("Signal channel started", { mode, pollIntervalMs: SIGNAL_POLL_INTERVAL_MS })

    this.pollInterval = setInterval(() => {
      void this.fetchIncoming()
        .catch((err: unknown) => log.warn("Signal poll error", { err }))
    }, SIGNAL_POLL_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.inboundChains.clear()
    log.info("Signal channel stopped")
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "signal")
      const chunks = splitMessage(rendered, 1800)
      for (const chunk of chunks) {
        await execa(
          config.SIGNAL_CLI_PATH,
          ["-a", config.SIGNAL_PHONE_NUMBER, "send", "-m", chunk, userId],
          { timeout: 20_000 },
        )
      }
      return true
    } catch (error) {
      log.error("Signal send failed", { userId, error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  /**
   * Fetches pending inbound messages using either the signal-cli REST API (if
   * SIGNAL_REST_API_URL is configured) or the signal-cli binary directly.
   *
   * REST API mode:
   *   GET {SIGNAL_REST_API_URL}/v1/receive/{SIGNAL_PHONE_NUMBER}
   *   Returns an array of envelope objects; the daemon clears them on delivery.
   *
   * CLI mode:
   *   Spawns: signal-cli -a {SIGNAL_PHONE_NUMBER} receive --output=json
   *   Parses stdout as newline-delimited JSON envelopes.
   *
   * For each envelope that contains a non-empty `dataMessage.message` the text
   * is dispatched into the EDITH pipeline and the response is sent back to the
   * sender's phone number.
   */
  private async fetchIncoming(): Promise<void> {
    if (!this.running) {
      return
    }

    const envelopes = config.SIGNAL_REST_API_URL.trim()
      ? await this.receiveViaRestApi()
      : await this.receiveViaCli()

    for (const envelope of envelopes) {
      const inner = envelope.envelope
      if (!inner) {
        continue
      }

      const senderNumber = inner.sourceNumber ?? inner.source
      const text = inner.dataMessage?.message?.trim()

      if (!senderNumber || !text) {
        continue
      }

      const edithUserId = `signal:${senderNumber}`
      this.enqueueReply(edithUserId, text)
      this.enqueueInboundProcessing(edithUserId, senderNumber, text)
    }
  }

  /**
   * Fetches envelopes from the signal-cli REST daemon.
   *
   * @returns Array of parsed SignalEnvelope objects (empty on error)
   */
  private async receiveViaRestApi(): Promise<SignalEnvelope[]> {
    const base = config.SIGNAL_REST_API_URL.replace(/\/$/, "")
    const url = `${base}/v1/receive/${encodeURIComponent(config.SIGNAL_PHONE_NUMBER)}`

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(SIGNAL_REST_TIMEOUT_MS),
      })

      if (!response.ok) {
        log.warn("Signal REST receive failed", { status: response.status })
        return []
      }

      return response.json() as Promise<SignalEnvelope[]>
    } catch (error) {
      log.warn("Signal REST receive error", { error })
      return []
    }
  }

  /**
   * Fetches envelopes by spawning `signal-cli receive --output=json`.
   * Parses each non-empty line of stdout as a JSON envelope.
   *
   * @returns Array of parsed SignalEnvelope objects (empty on error)
   */
  private async receiveViaCli(): Promise<SignalEnvelope[]> {
    try {
      const { stdout } = await execa(
        config.SIGNAL_CLI_PATH,
        ["-a", config.SIGNAL_PHONE_NUMBER, "receive", "--output=json"],
        { timeout: SIGNAL_CLI_RECEIVE_TIMEOUT_MS },
      )

      const envelopes: SignalEnvelope[] = []
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }
        try {
          envelopes.push(JSON.parse(trimmed) as SignalEnvelope)
        } catch {
          log.debug("Signal CLI: skipping non-JSON stdout line", { line: trimmed })
        }
      }
      return envelopes
    } catch (error) {
      log.warn("Signal CLI receive error", { error })
      return []
    }
  }

  /**
   * Serialises message processing per-sender so concurrent poll results cannot
   * cause out-of-order replies.
   *
   * @param edithUserId    - EDITH-internal user ID (e.g. `signal:+1234567890`)
   * @param senderNumber   - E.164 phone number for outbound send
   * @param text           - Raw message text to process
   */
  private enqueueInboundProcessing(
    edithUserId: string,
    senderNumber: string,
    text: string,
  ): void {
    const current = this.inboundChains.get(edithUserId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await handleIncomingUserMessage(edithUserId, text, "signal")
          const sent = await this.send(senderNumber, response)
          if (!sent) {
            log.warn("Signal response send returned false", { edithUserId })
          }
        } catch (error) {
          log.error("Signal inbound processing failed", { edithUserId, error })
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

export const signalChannel = new SignalChannel()
