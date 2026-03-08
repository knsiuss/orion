/**
 * @file phone.ts
 * @description PhoneChannel — Twilio Voice WebSocket bridge with full G.711 μ-law audio pipeline.
 *
 * ARCHITECTURE:
 *   PhoneChannel owns a standalone `ws` WebSocketServer (port PHONE_WS_PORT).
 *   Twilio Media Streams connects here after the TwiML <Connect><Stream> directive.
 *
 *   Inbound audio flow:
 *     Twilio WS → JSON {event:"media", media:{payload:<base64 mulaw>}}
 *       → base64 decode → mulawToPCM() → upsample8to16()
 *       → accumulated in audioBuffers Map per callSid
 *     On WS close → write PCM to tmp WAV → voice.transcribe()
 *       → processMessage() → TTS reply via voice.speak()
 *
 *   Outbound audio flow (future):
 *     TTS WAV buffer → downsample16to8() → pcmToMulaw()
 *       → base64 encode → JSON {event:"media", media:{payload:…}} → Twilio WS
 *
 * AUDIO FORMAT:
 *   Twilio sends:   G.711 μ-law, 8 kHz, mono
 *   STT expects:    PCM 16-bit LE, 16 kHz, mono
 *   Conversion:     mulawToPCM() → upsample8to16()
 *   Reverse:        downsample16to8() → pcmToMulaw()
 *
 * TWILIO WEBHOOKS:
 *   POST /voice/incoming  → handleIncomingTwiML()  → TwiML <Connect><Stream>
 *   POST /voice/outbound  → handleOutboundTwiML()  → TwiML <Connect><Stream>
 *   WS   <PHONE_WS_PORT>  → handleWebSocketConnect() (this server)
 *   POST /voice/status    → call status callbacks (informational only)
 *
 * PAPER BASIS:
 *   - ITU-T G.711 (1988) — μ-law companding tables used verbatim
 *
 * @module channels/phone
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { BaseChannel } from "./base.js"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { voice } from "../voice/bridge.js"
import { processMessage } from "../core/message-pipeline.js"

const log = createLogger("channels.phone")

// ─── G.711 μ-law lookup table (decode: mulaw byte → 16-bit signed PCM) ─────────

/**
 * Precomputed G.711 μ-law decode table.
 * Index = 8-bit mulaw byte (0–255), value = 16-bit signed linear PCM sample.
 *
 * Formula (ITU-T G.711):
 *   sign     = mulaw & 0x80
 *   exponent = (mulaw >> 4) & 0x07
 *   mantissa = mulaw & 0x0F
 *   linear   = (mantissa << (exponent + 3)) + (132 << exponent) - 132
 *   result   = sign ? -linear : linear
 */
const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256)
  for (let i = 0; i < 256; i++) {
    const byte = ~i & 0xff          // μ-law bytes are transmitted bit-inverted
    const sign = byte & 0x80
    const exponent = (byte >> 4) & 0x07
    const mantissa = byte & 0x0f
    const linear = (mantissa << (exponent + 3)) + (132 << exponent) - 132
    table[i] = sign ? -linear : linear
  }
  return table
})()

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Active call session tracking record.
 */
export interface ActiveCall {
  /** Twilio Call SID (e.g. CAxxxxxxxx). */
  callSid: string
  /** Twilio Stream SID (populated once WS connects). */
  streamSid: string
  /** Call direction. */
  direction: "inbound" | "outbound"
  /** Caller E.164 phone number. */
  from: string
  /** Called E.164 phone number. */
  to: string
  /** Wall-clock start time. */
  startedAt: Date
}

/**
 * Parameters for initiating an outbound call.
 */
export interface CallInitParams {
  /** E.164 destination phone number. */
  to: string
  /** EDITH user ID for message routing. */
  userId: string
  /** Optional greeting to speak at call start. */
  greeting?: string
}

/**
 * Twilio Media Stream JSON message.
 *
 * Only the relevant events are typed here (connected, start, media, stop).
 * @see https://www.twilio.com/docs/voice/twiml/stream#message-media
 */
interface TwilioStreamMessage {
  event: "connected" | "start" | "media" | "stop" | string
  sequenceNumber?: string
  start?: {
    streamSid: string
    callSid: string
    accountSid: string
    tracks: string[]
    customParameters?: Record<string, string>
  }
  media?: {
    track: string
    chunk: string
    timestamp: string
    /** Base64-encoded G.711 μ-law audio payload. */
    payload: string
  }
  stop?: {
    accountSid: string
    callSid: string
  }
  streamSid?: string
}

// ─── WebSocket type (dynamically imported) ──────────────────────────────────

/** Minimal WebSocket interface (matches the `ws` library's `WebSocket`). */
interface WsSocket {
  on(event: "message", listener: (data: Buffer | string) => void): this
  on(event: "close", listener: (code: number, reason: Buffer) => void): this
  on(event: "error", listener: (err: Error) => void): this
  send(data: string | Buffer, cb?: (err?: Error) => void): void
  close(): void
  readyState: number
}

/** Minimal WebSocketServer interface (matches the `ws` library's `WebSocketServer`). */
interface WsServer {
  on(event: "connection", listener: (ws: WsSocket, req: { socket: { remoteAddress?: string } }) => void): this
  close(cb?: (err?: Error) => void): void
}

// ─── PhoneChannel ─────────────────────────────────────────────────────────

/**
 * PhoneChannel — Twilio Voice WebSocket bridge with full G.711 μ-law pipeline.
 *
 * SECURITY:
 *   - Allowlist for inbound callers (empty = allow all — configure for production)
 *   - Max 5 concurrent calls
 *   - All external data (Twilio JSON) parsed defensively
 *
 * USAGE:
 *   ```typescript
 *   // Incoming call webhook handler (e.g. Fastify route):
 *   app.post("/voice/incoming", (req, reply) => {
 *     const twiml = phoneChannel.handleIncomingTwiML(req.body.From, req.body.To)
 *     reply.type("text/xml").send(twiml)
 *   })
 *
 *   // Outbound call:
 *   await phoneChannel.initiateCall({ to: "+1234567890", userId: "owner" })
 *   ```
 */
export class PhoneChannel implements BaseChannel {
  readonly name = "phone"

  /** Whether the WS server is running and ready. */
  private connected = false

  /** Tracks active call metadata keyed by callSid. */
  private activeCalls = new Map<string, ActiveCall>()

  /** Accumulated PCM audio chunks per callSid (pre-flush). */
  private audioBuffers = new Map<string, Buffer[]>()

  /** Open WebSocket connections per callSid. */
  private activeWebSockets = new Map<string, WsSocket>()

  /** Standalone WS server for Twilio Media Streams. */
  private wsServer: WsServer | null = null

  /** Allowlist of E.164 phone numbers; empty = accept all. */
  private allowedCallers = new Set<string>()

  /** Maximum number of concurrent active calls. */
  private static readonly MAX_CONCURRENT_CALLS = 5

  // ─── BaseChannel ──────────────────────────────────────────────────────────

  /**
   * Starts the phone channel.
   *
   * When PHONE_ENABLED=true and Twilio credentials are present, a standalone
   * WebSocketServer is started on PHONE_WS_PORT so Twilio Media Streams can
   * connect and deliver audio.
   *
   * When credentials are missing, the channel marks itself as unavailable so
   * the rest of startup continues cleanly.
   */
  async start(): Promise<void> {
    try {
      if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
        log.info("Phone channel not started — Twilio credentials not configured")
        this.connected = false
        return
      }

      if (!config.PHONE_ENABLED) {
        log.info("Phone channel not started — PHONE_ENABLED=false")
        this.connected = false
        return
      }

      await this.startWebSocketServer()

      this.connected = true
      log.info("Phone channel started", { wsPort: config.PHONE_WS_PORT })
    } catch (err) {
      log.error("Phone channel failed to start", { err })
      this.connected = false
    }
  }

  /**
   * Stops the phone channel.
   *
   * Closes the WebSocket server, terminates all active WS connections,
   * and clears all call state.
   */
  async stop(): Promise<void> {
    // Close all active WS connections gracefully
    for (const [callSid, ws] of this.activeWebSockets.entries()) {
      try {
        ws.close()
      } catch (err) {
        log.warn("error closing WS for call", { callSid, err })
      }
    }
    this.activeWebSockets.clear()
    this.audioBuffers.clear()
    this.activeCalls.clear()

    // Close the WS server
    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.close(() => resolve())
      })
      this.wsServer = null
    }

    this.connected = false
    log.info("Phone channel stopped")
  }

  /**
   * Returns true when the WS server is running and ready for connections.
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Sends a message to a user via an outbound phone call (TTS).
   *
   * @param userId  - User ID in format "phone:+E164" or bare "+E164"
   * @param message - Text to speak via TTS
   * @returns true if the outbound call was successfully initiated
   */
  async send(userId: string, message: string): Promise<boolean> {
    if (!this.connected) {
      log.warn("Phone channel not connected — cannot send")
      return false
    }

    const phoneNumber = this.extractPhoneNumber(userId)
    if (!phoneNumber) {
      log.error("invalid userId format for phone", { userId })
      return false
    }

    if (this.activeCalls.size >= PhoneChannel.MAX_CONCURRENT_CALLS) {
      log.warn("concurrent call limit reached", { limit: PhoneChannel.MAX_CONCURRENT_CALLS })
      return false
    }

    try {
      await this.initiateCall({ to: phoneNumber, userId, greeting: message })
      return true
    } catch (err) {
      log.error("failed to initiate outbound call", { to: phoneNumber, err })
      return false
    }
  }

  /**
   * Sends with confirmation (for phone: prepends action label to message).
   *
   * @param userId   - User ID
   * @param message  - Message text
   * @param action   - Action label to prepend
   */
  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    return this.send(userId, `${action}: ${message}`)
  }

  // ─── Twilio REST API ───────────────────────────────────────────────────────

  /**
   * Initiates an outbound call via the Twilio REST API.
   *
   * @param params - Call parameters (to, userId, optional greeting)
   * @returns Object containing the Twilio Call SID
   * @throws When the Twilio API returns a non-2xx response
   */
  async initiateCall(params: CallInitParams): Promise<{ callSid: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Calls.json`
    const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")
    const webhookUrl = config.PHONE_WEBHOOK_URL || "http://localhost:18789"

    const body = new URLSearchParams({
      To: params.to,
      From: config.TWILIO_PHONE_NUMBER,
      Url: `${webhookUrl}/voice/outbound`,
    })

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Twilio API error: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as { sid: string }
    log.info("outbound call initiated", { to: params.to, callSid: data.sid })

    this.activeCalls.set(data.sid, {
      callSid: data.sid,
      streamSid: "",
      direction: "outbound",
      from: config.TWILIO_PHONE_NUMBER,
      to: params.to,
      startedAt: new Date(),
    })

    return { callSid: data.sid }
  }

  // ─── TwiML builders ───────────────────────────────────────────────────────

  /**
   * Generates a TwiML response for an incoming Twilio voice call.
   *
   * Returns a <Connect><Stream> directive pointing at our WS server.
   * If the caller is not on the allowlist (when configured), or if the
   * concurrent-call limit is reached, returns a rejection TwiML.
   *
   * @param from - Caller E.164 phone number
   * @param _to  - Called E.164 phone number (unused, reserved for future routing)
   * @returns TwiML XML string
   */
  handleIncomingTwiML(from: string, _to: string): string {
    if (this.allowedCallers.size > 0 && !this.allowedCallers.has(from)) {
      return this.buildRejectTwiML("This number is not authorized. Goodbye.")
    }

    if (this.activeCalls.size >= PhoneChannel.MAX_CONCURRENT_CALLS) {
      return this.buildRejectTwiML("Sorry, all lines are busy. Please try again later.")
    }

    const wsUrl = this.buildWsUrl()

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while I connect you to EDITH.</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`
  }

  /**
   * Generates a TwiML response for an outbound call connecting to EDITH.
   *
   * @param greeting - Optional greeting to speak before connecting the stream
   * @returns TwiML XML string
   */
  handleOutboundTwiML(greeting?: string): string {
    const wsUrl = this.buildWsUrl()
    const sayElement = greeting
      ? `<Say>${this.escapeXml(greeting)}</Say>`
      : `<Say>This is EDITH calling.</Say>`

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayElement}
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`
  }

  // ─── Audio codec: G.711 μ-law ─────────────────────────────────────────────

  /**
   * Decodes a G.711 μ-law 8 kHz mono buffer to 16-bit signed PCM (still 8 kHz).
   *
   * Each input byte maps to one 16-bit PCM sample using the ITU-T G.711 decode
   * table. The result is a Buffer of length `mulaw.length * 2` (little-endian).
   *
   * @param mulaw - Raw μ-law encoded bytes from Twilio
   * @returns PCM 16-bit LE Buffer at 8 kHz sample rate
   */
  mulawToPCM(mulaw: Buffer): Buffer {
    const pcm = Buffer.allocUnsafe(mulaw.length * 2)
    for (let i = 0; i < mulaw.length; i++) {
      const sample = MULAW_DECODE_TABLE[mulaw[i] & 0xff]
      pcm.writeInt16LE(sample, i * 2)
    }
    return pcm
  }

  /**
   * Encodes a 16-bit signed PCM buffer to G.711 μ-law.
   *
   * Uses the standard ITU-T G.711 μ-law compression formula with μ=255.
   * Each pair of PCM bytes (16-bit LE sample) produces one μ-law byte.
   * Input length must be even; odd trailing bytes are ignored.
   *
   * @param pcm - PCM 16-bit LE Buffer (any sample rate)
   * @returns μ-law encoded Buffer (half the input length)
   */
  pcmToMulaw(pcm: Buffer): Buffer {
    const sampleCount = Math.floor(pcm.length / 2)
    const out = Buffer.allocUnsafe(sampleCount)

    for (let i = 0; i < sampleCount; i++) {
      let sample = pcm.readInt16LE(i * 2)

      // Clamp to 16-bit signed range
      if (sample > 32767) sample = 32767
      if (sample < -32768) sample = -32768

      // Bias and sign extraction
      const sign = sample < 0 ? 0x80 : 0x00
      if (sample < 0) sample = -sample

      // Apply μ-law bias (μ=255): add 33 (= 33/8192 * 32768 * 8192/32768)
      sample = Math.min(sample + 33, 32767)

      // Find segment (exponent)
      let exponent = 7
      for (let exp = 0; exp < 8; exp++) {
        if (sample <= (0xff >> (7 - exp)) * 4 + 132) {
          exponent = exp
          break
        }
      }

      // Mantissa extraction: top 4 bits of sample after removing segment bias
      const mantissa = (sample >> (exponent + 3)) & 0x0f

      // Compose μ-law byte and bit-invert (G.711 transmission convention)
      out[i] = (~(sign | (exponent << 4) | mantissa)) & 0xff
    }

    return out
  }

  /**
   * Upsamples 8 kHz mono PCM to 16 kHz mono PCM using linear interpolation.
   *
   * Each pair of consecutive 8 kHz samples produces 4 output samples:
   * the original sample, one interpolated midpoint, the next original, and
   * one more midpoint — doubling the sample rate.
   *
   * @param pcm8 - PCM 16-bit LE Buffer at 8 kHz
   * @returns PCM 16-bit LE Buffer at 16 kHz (2× input sample count)
   */
  upsample8to16(pcm8: Buffer): Buffer {
    const sampleCount = Math.floor(pcm8.length / 2)
    const out = Buffer.allocUnsafe(sampleCount * 2 * 2) // 2x samples × 2 bytes each

    for (let i = 0; i < sampleCount; i++) {
      const s0 = pcm8.readInt16LE(i * 2)
      const s1 = i + 1 < sampleCount ? pcm8.readInt16LE((i + 1) * 2) : s0
      const mid = Math.round((s0 + s1) / 2)

      out.writeInt16LE(s0, i * 4)
      out.writeInt16LE(mid, i * 4 + 2)
    }

    return out
  }

  /**
   * Downsamples 16 kHz mono PCM to 8 kHz mono PCM by simple decimation (take every 2nd sample).
   *
   * Suitable for converting TTS output (16 kHz) to Twilio's expected 8 kHz format.
   * No anti-aliasing filter is applied — adequate for voice-band audio.
   *
   * @param pcm16 - PCM 16-bit LE Buffer at 16 kHz
   * @returns PCM 16-bit LE Buffer at 8 kHz (half the input sample count)
   */
  downsample16to8(pcm16: Buffer): Buffer {
    const sampleCount = Math.floor(pcm16.length / 2)
    const outCount = Math.floor(sampleCount / 2)
    const out = Buffer.allocUnsafe(outCount * 2)

    for (let i = 0; i < outCount; i++) {
      out.writeInt16LE(pcm16.readInt16LE(i * 4), i * 2)
    }

    return out
  }

  // ─── WebSocket audio pipeline ─────────────────────────────────────────────

  /**
   * Attaches audio pipeline event handlers to a freshly connected Twilio WS.
   *
   * Stores the WS in `activeWebSockets` once the Twilio `start` event arrives
   * and reveals the callSid. Audio chunks are accumulated in `audioBuffers`.
   * When the connection closes, `_finalizeCall()` runs STT → LLM → TTS.
   *
   * @param ws          - The WebSocket instance from the `ws` library
   * @param remoteAddr  - Remote IP address (for logging only)
   */
  handleWebSocketConnect(ws: WsSocket, remoteAddr: string): void {
    log.debug("Twilio WS connected", { remoteAddr })

    // callSid is not yet known — will be set once the `start` event arrives
    let callSid = ""

    ws.on("message", (data: Buffer | string) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : data
        const msg = JSON.parse(raw) as TwilioStreamMessage

        switch (msg.event) {
          case "connected":
            log.debug("Twilio stream protocol=call", { remoteAddr })
            break

          case "start":
            if (msg.start) {
              callSid = msg.start.callSid
              const streamSid = msg.start.streamSid

              log.info("Twilio stream started", { callSid, streamSid })

              // Register call if not already known (inbound calls arrive here first)
              if (!this.activeCalls.has(callSid)) {
                this.activeCalls.set(callSid, {
                  callSid,
                  streamSid,
                  direction: "inbound",
                  from: "",
                  to: config.TWILIO_PHONE_NUMBER,
                  startedAt: new Date(),
                })
              } else {
                const call = this.activeCalls.get(callSid)!
                call.streamSid = streamSid
              }

              this.activeWebSockets.set(callSid, ws)
              this.audioBuffers.set(callSid, [])
            }
            break

          case "media":
            if (msg.media?.payload && callSid) {
              const mulawBytes = Buffer.from(msg.media.payload, "base64")
              this.handleWebSocketMessage(callSid, mulawBytes)
            }
            break

          case "stop":
            log.info("Twilio stream stop event", { callSid })
            break

          default:
            log.debug("unknown Twilio stream event", { event: msg.event })
        }
      } catch (err) {
        log.warn("failed to parse Twilio WS message", { err, remoteAddr })
      }
    })

    ws.on("close", (code: number) => {
      log.info("Twilio WS closed", { callSid, code })
      if (callSid) {
        void this._finalizeCall(callSid)
          .catch((err: unknown) => log.error("finalizeCall failed", { callSid, err }))
      }
    })

    ws.on("error", (err: Error) => {
      log.error("Twilio WS error", { callSid, err })
    })
  }

  /**
   * Accumulates a decoded PCM audio chunk from an active call.
   *
   * Converts the incoming μ-law bytes → PCM 8 kHz → PCM 16 kHz and appends
   * to the per-callSid accumulation buffer.
   *
   * @param callSid    - Twilio Call SID
   * @param mulawChunk - Raw μ-law bytes received from Twilio
   */
  handleWebSocketMessage(callSid: string, mulawChunk: Buffer): void {
    const chunks = this.audioBuffers.get(callSid)
    if (!chunks) {
      log.warn("received audio for unknown callSid", { callSid })
      return
    }

    try {
      const pcm8 = this.mulawToPCM(mulawChunk)
      const pcm16 = this.upsample8to16(pcm8)
      chunks.push(pcm16)
    } catch (err) {
      log.warn("audio conversion failed for chunk", { callSid, err })
    }
  }

  /**
   * Finalizes a call after the WebSocket closes.
   *
   * Steps:
   *   1. Concatenate accumulated PCM chunks
   *   2. Write to a temporary WAV file (16-bit PCM, 16 kHz, mono)
   *   3. Call `voice.transcribe(path)` for STT
   *   4. Route transcript through `processMessage()`
   *   5. Speak response via `voice.speak()` (local speaker — future: send back over WS)
   *   6. Clean up tmp file and call state
   *
   * @param callSid - Twilio Call SID
   */
  async _finalizeCall(callSid: string): Promise<void> {
    const chunks = this.audioBuffers.get(callSid)
    this.audioBuffers.delete(callSid)
    this.activeWebSockets.delete(callSid)
    this.activeCalls.delete(callSid)

    if (!chunks || chunks.length === 0) {
      log.debug("no audio accumulated for call", { callSid })
      return
    }

    const pcmBuffer = Buffer.concat(chunks)
    log.debug("finalizing call audio", { callSid, pcmBytes: pcmBuffer.length })

    const tmpPath = path.join(os.tmpdir(), `edith-phone-${callSid}-${Date.now()}.wav`)

    try {
      // Write a minimal WAV header + PCM body (16-bit LE, 1ch, 16000 Hz)
      await fs.writeFile(tmpPath, this.buildWavBuffer(pcmBuffer, 16000, 1))

      // STT — delegate to VoiceBridge (WhisperCpp or Python sidecar)
      const transcript = await voice.transcribe(tmpPath)

      if (!transcript.trim()) {
        log.info("empty transcript for call — skipping pipeline", { callSid })
        return
      }

      log.info("call transcript ready", { callSid, transcript })

      // Route through EDITH pipeline
      const userId = config.DEFAULT_USER_ID
      const result = await processMessage(userId, transcript, { channel: "phone" })

      log.info("pipeline response ready", { callSid, length: result.response.length })

      // TTS — speak locally (future: encode → send over Twilio WS)
      void voice.speak(result.response)
        .catch((err: unknown) => log.warn("TTS speak failed for phone response", { callSid, err }))

    } catch (err) {
      log.error("_finalizeCall failed", { callSid, err })
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined)
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Starts the standalone WebSocket server for Twilio Media Streams.
   *
   * Uses a dynamic import so that the `ws` package (transitive dep of
   * @fastify/websocket) is loaded at runtime only when PHONE_ENABLED=true.
   */
  private async startWebSocketServer(): Promise<void> {
    // Dynamic import — avoids compile-time dependency on `ws` types
    const wsModule = await (Function("return import('ws')")() as Promise<unknown>)
      .catch(() => null)

    if (!wsModule || typeof wsModule !== "object") {
      throw new Error(
        "ws package not found. It is a transitive dep of @fastify/websocket — run: pnpm install"
      )
    }

    const { WebSocketServer } = wsModule as {
      WebSocketServer: new (opts: { port: number }) => WsServer
    }

    const port = config.PHONE_WS_PORT
    const server = new WebSocketServer({ port })

    server.on("connection", (ws, req) => {
      const remoteAddr = req.socket.remoteAddress ?? "unknown"
      this.handleWebSocketConnect(ws, remoteAddr)
    })

    this.wsServer = server
    log.info("Phone WS server listening", { port })
  }

  /**
   * Builds a minimal RIFF WAV file buffer from raw PCM samples.
   *
   * Header format: RIFF/WAVE, fmt chunk (PCM, 16-bit LE), data chunk.
   *
   * @param pcm        - PCM 16-bit LE audio data
   * @param sampleRate - Sample rate in Hz (e.g. 16000)
   * @param channels   - Number of audio channels (1 = mono)
   * @returns Complete WAV file as a Buffer
   */
  private buildWavBuffer(pcm: Buffer, sampleRate: number, channels: number): Buffer {
    const bitsPerSample = 16
    const byteRate = sampleRate * channels * (bitsPerSample / 8)
    const blockAlign = channels * (bitsPerSample / 8)
    const dataSize = pcm.length
    const header = Buffer.allocUnsafe(44)

    // RIFF chunk
    header.write("RIFF", 0, "ascii")
    header.writeUInt32LE(36 + dataSize, 4)
    header.write("WAVE", 8, "ascii")

    // fmt sub-chunk
    header.write("fmt ", 12, "ascii")
    header.writeUInt32LE(16, 16)           // sub-chunk size
    header.writeUInt16LE(1, 20)            // PCM = 1
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)

    // data sub-chunk
    header.write("data", 36, "ascii")
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcm])
  }

  /**
   * Builds the WebSocket URL for Twilio <Stream> TwiML.
   *
   * Replaces http(s):// with ws(s):// for the configured webhook URL,
   * then appends the /voice/stream path and port.
   *
   * @returns ws(s)://host:PHONE_WS_PORT/voice/stream
   */
  private buildWsUrl(): string {
    const base = (config.PHONE_WEBHOOK_URL || `ws://localhost:${config.PHONE_WS_PORT}`)
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://")

    return `${base.replace(/\/$/, "")}:${config.PHONE_WS_PORT}/voice/stream`
  }

  /**
   * Constructs a TwiML reject/hangup response with a spoken message.
   *
   * @param message - Text to say before hanging up
   * @returns TwiML XML string
   */
  private buildRejectTwiML(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${this.escapeXml(message)}</Say>
  <Hangup/>
</Response>`
  }

  /**
   * Extracts an E.164 phone number from a EDITH userId.
   *
   * Accepts both "phone:+1234567890" and bare "+1234567890" formats.
   *
   * @param userId - EDITH user ID
   * @returns E.164 string or null if the format is unrecognised
   */
  private extractPhoneNumber(userId: string): string | null {
    if (userId.startsWith("phone:")) return userId.slice(6)
    if (userId.startsWith("+")) return userId
    return null
  }

  /**
   * Escapes XML special characters for safe inclusion in TwiML.
   *
   * @param text - Raw text string
   * @returns XML-safe string
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }
}

/** Singleton instance of PhoneChannel. */
export const phoneChannel = new PhoneChannel()
