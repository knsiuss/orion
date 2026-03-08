/**
 * @file fish-audio.ts
 * @description Fish Audio TTS driver — supports S1, S1-mini, and Fish-Speech 1.5 models.
 *
 * ARCHITECTURE:
 *   - HTTP batch synthesis: POST https://api.fish.audio/v1/tts → PCM/WAV buffer
 *   - WebSocket streaming: wss://api.fish.audio/v1/tts/live → real-time chunks
 *   - Emotion routing: each EmotionLabel maps to a `reference_id` (voice model)
 *   - Falls back to base model when no emotion-specific override is configured
 *   - Gracefully disabled when FISH_AUDIO_ENABLED=false or API key missing
 *
 * API REFERENCE:
 *   https://docs.fish.audio/api-reference/text-to-speech
 *   S1-mini model hub: https://fish.audio/model/
 *   Reference audio / voice cloning supported via reference_id
 *
 * EMOTION MAPPING:
 *   Fish Audio controls emotion through voice model selection (reference_id).
 *   For single-model setups, emotion is expressed via prosody prefix injected
 *   into the text (e.g. "[cheerful] ..." or via natural phrasing hints).
 *
 * @module voice/fish-audio
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("voice.fish-audio")

/** Fish Audio REST API endpoint. */
const FISH_API_BASE = "https://api.fish.audio"

/** Supported audio output formats from Fish Audio API. */
type FishAudioFormat = "wav" | "mp3" | "opus" | "flac"

/**
 * Emotion labels from EDITH Phase 21 emotion engine.
 * Subset used for voice selection in Fish Audio.
 */
type EmotionLabel =
  | "calm"
  | "warm"
  | "urgent"
  | "concerned"
  | "excited"
  | "apologetic"
  | "formal"
  | "playful"

/**
 * Prosody prefix hints injected before text when using a single voice model.
 * These natural-language cues improve expressiveness even on a single reference_id.
 *
 * Fish Audio S1 is instruction-following — phrasing hints noticeably shift delivery.
 */
const EMOTION_PROSODY_HINTS: Record<EmotionLabel, string> = {
  calm: "",
  warm: "",
  urgent: "",
  concerned: "",
  excited: "",
  apologetic: "",
  formal: "",
  playful: "",
}

/**
 * Parse FISH_AUDIO_EMOTION_MODELS env var into a map.
 * Format: "warm:abc123,urgent:def456"
 *
 * @param raw - Raw env string
 * @returns Map of emotion → reference_id
 */
function parseEmotionModels(raw: string): Map<EmotionLabel, string> {
  const map = new Map<EmotionLabel, string>()
  if (!raw.trim()) return map
  for (const pair of raw.split(",")) {
    const [key, val] = pair.split(":")
    if (key && val) {
      map.set(key.trim() as EmotionLabel, val.trim())
    }
  }
  return map
}

/** Cached emotion→reference_id map (built once from config). */
let emotionModelCache: Map<EmotionLabel, string> | null = null

/**
 * Resolve the Fish Audio `reference_id` for a given emotion.
 * Falls back to the default FISH_AUDIO_MODEL_ID if no override exists.
 *
 * @param emotion - EDITH emotion label
 * @returns reference_id string for Fish Audio API
 */
function resolveReferenceId(emotion?: EmotionLabel): string {
  if (!emotionModelCache) {
    emotionModelCache = parseEmotionModels(config.FISH_AUDIO_EMOTION_MODELS)
  }
  if (emotion && emotionModelCache.has(emotion)) {
    return emotionModelCache.get(emotion)!
  }
  return config.FISH_AUDIO_MODEL_ID
}

/**
 * Build the text payload sent to Fish Audio.
 * When using a single voice model (no emotion overrides), injects a prosody hint
 * so the model naturally shifts its delivery style.
 *
 * @param text    - Original text to synthesize
 * @param emotion - EDITH emotion label
 * @returns Text string ready for Fish Audio API
 */
function buildTextPayload(text: string, emotion?: EmotionLabel): string {
  if (!emotion) return text

  // If emotion-specific model is configured, no hint needed — the model handles it
  if (emotionModelCache?.has(emotion)) return text

  const hint = EMOTION_PROSODY_HINTS[emotion]
  return hint ? `${hint} ${text}` : text
}

/**
 * Synthesize text to audio using Fish Audio HTTP API (batch, non-streaming).
 * Returns a WAV Buffer or null on failure.
 *
 * @param text    - Text to synthesize
 * @param emotion - Optional EDITH emotion label for voice/style selection
 * @returns Buffer containing WAV audio data, or null on failure
 */
export async function fishAudioSpeak(
  text: string,
  emotion?: EmotionLabel,
): Promise<Buffer | null> {
  if (!config.FISH_AUDIO_ENABLED) return null
  if (!config.FISH_AUDIO_API_KEY) {
    log.warn("Fish Audio API key not set — skipping TTS")
    return null
  }

  const referenceId = resolveReferenceId(emotion)
  const payload = buildTextPayload(text, emotion)

  const body: Record<string, unknown> = {
    text: payload,
    format: "wav" satisfies FishAudioFormat,
    latency: config.FISH_AUDIO_LATENCY,
  }

  // reference_id "s1" means use the S1 model directly (no specific voice clone)
  if (referenceId && referenceId !== "s1") {
    body.reference_id = referenceId
  }

  try {
    const response = await fetch(`${FISH_API_BASE}/v1/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.FISH_AUDIO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      log.warn("Fish Audio TTS failed", { status: response.status, body: errText })
      return null
    }

    const arrayBuf = await response.arrayBuffer()
    log.debug("Fish Audio TTS ok", {
      bytes: arrayBuf.byteLength,
      emotion: emotion ?? "none",
      referenceId,
    })
    return Buffer.from(arrayBuf)
  } catch (err) {
    log.warn("Fish Audio TTS request error", { err })
    return null
  }
}

/**
 * Stream synthesized audio from Fish Audio via WebSocket.
 * Delivers audio chunks in real-time as they arrive.
 *
 * Uses Fish Audio's live TTS WebSocket endpoint with msgpack-lite protocol.
 * Falls back to HTTP batch if WebSocket is unavailable.
 *
 * @param text     - Text to synthesize
 * @param emotion  - Optional EDITH emotion label
 * @param onChunk  - Callback invoked with each raw audio Buffer chunk
 */
export async function fishAudioSpeakStreaming(
  text: string,
  emotion: EmotionLabel | undefined,
  onChunk: (chunk: Buffer) => void,
): Promise<boolean> {
  if (!config.FISH_AUDIO_ENABLED) return false
  if (!config.FISH_AUDIO_API_KEY) return false

  // Fish Audio WebSocket streaming uses msgpack protocol.
  // Attempt dynamic import of msgpack-lite; fall back to HTTP batch if absent.
  let msgpack: { encode: (obj: unknown) => Uint8Array; decode: (buf: Uint8Array) => unknown } | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (new Function("m", "return import(m)"))("msgpack-lite") as any
    msgpack = mod.default ?? mod
  } catch {
    log.debug("msgpack-lite not installed — falling back to Fish Audio HTTP batch")
  }

  if (!msgpack) {
    // HTTP batch fallback: synthesize whole text, deliver as single chunk
    const buf = await fishAudioSpeak(text, emotion)
    if (buf) {
      onChunk(buf)
      return true
    }
    return false
  }

  const referenceId = resolveReferenceId(emotion)
  const payload = buildTextPayload(text, emotion)

  return new Promise<boolean>((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = new (globalThis as any).WebSocket(`wss://api.fish.audio/v1/tts/live`, [
        "binary",
      ]) as WebSocket

      let started = false

      ws.addEventListener("open", () => {
        /** Initial handshake message for Fish Audio live TTS. */
        const initMsg: Record<string, unknown> = {
          event: "start",
          request: {
            text: payload,
            latency: config.FISH_AUDIO_LATENCY,
            format: "wav",
            ...(referenceId && referenceId !== "s1" ? { reference_id: referenceId } : {}),
          },
        }
        ws.send(msgpack!.encode(initMsg))
        started = true
      })

      ws.addEventListener("message", (event: MessageEvent) => {
        if (!(event.data instanceof ArrayBuffer)) return
        const msg = msgpack!.decode(new Uint8Array(event.data)) as Record<string, unknown>

        if (msg["event"] === "audio" && msg["audio"]) {
          onChunk(Buffer.from(msg["audio"] as Uint8Array))
        } else if (msg["event"] === "finish") {
          ws.close()
          resolve(true)
        } else if (msg["event"] === "error") {
          log.warn("Fish Audio WS error", { msg })
          ws.close()
          resolve(started)
        }
      })

      ws.addEventListener("error", () => {
        resolve(false)
      })

      ws.addEventListener("close", () => {
        resolve(started)
      })

      // Safety timeout: 30 seconds
      setTimeout(() => {
        ws.close()
        resolve(started)
      }, 30_000)
    } catch (err) {
      log.warn("Fish Audio WS setup failed", { err })
      resolve(false)
    }
  })
}

/**
 * Check if Fish Audio is configured and available.
 * Performs a lightweight API connectivity check.
 *
 * @returns true if Fish Audio is ready to use
 */
export async function isFishAudioAvailable(): Promise<boolean> {
  if (!config.FISH_AUDIO_ENABLED || !config.FISH_AUDIO_API_KEY) return false
  try {
    const res = await fetch(`${FISH_API_BASE}/v1/health`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.FISH_AUDIO_API_KEY}` },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}
