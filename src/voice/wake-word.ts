/**
 * @file wake-word.ts
 * @description Wake word detector — bridges to Python sidecar via child_process stdin/stdout.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Spawns python/voice/wake_word.py which streams mic audio through Whisper in 2s chunks.
 *   Communicates via newline-delimited JSON: { "transcript": "...", "confidence": 0.9 }
 *   Privacy: all audio processing local. No audio leaves device.
 *   Falls back gracefully if Python sidecar unavailable (manual mode: call processTranscript()).
 *   Integrates with always-on.ts for full voice pipeline activation on detection.
 */
import { EventEmitter } from 'node:events'
import { createLogger } from '../logger.js'
import config from '../config.js'

const log = createLogger('voice.wake-word')

/** Wake phrase detection event payload. */
export interface WakeDetectedEvent {
  /** Full transcript that triggered detection. */
  transcript: string
  /** Which wake phrase was matched. */
  phrase?: string
  /** Confidence from sidecar (1.0 if from manual processTranscript call). */
  confidence?: number
}

/** JSON message from the Python sidecar. */
interface SidecarMessage {
  transcript: string
  confidence: number
}

class WakeWordDetector extends EventEmitter {
  private isListening = false
  private sidecarProcess: import('node:child_process').ChildProcess | null = null
  private buffer = ''

  /** All wake phrases to detect (including common misheards). */
  readonly wakePhrases: string[]

  constructor() {
    super()
    this.wakePhrases = [
      (config.WAKE_WORD_PHRASE ?? 'hey edith').toLowerCase(),
      'edith',
      'hey edit', // common mishearing
      'hay edith',
    ]
  }

  /**
   * Start listening for wake word.
   * Attempts to start Python sidecar; falls back to manual mode on failure.
   */
  async start(): Promise<void> {
    if (this.isListening) return
    this.isListening = true

    try {
      await this.startSidecar()
    } catch (err) {
      log.warn('wake word sidecar unavailable — manual mode only', { err })
      // In manual mode, processTranscript() must be called externally
    }

    log.info('wake word detector started', { phrases: this.wakePhrases })
  }

  /** Attempt to spawn the Python Whisper sidecar. */
  private async startSidecar(): Promise<void> {
    const { spawn } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    const { resolve } = await import('node:path')

    const sidecarPath = resolve(process.cwd(), 'python', 'voice', 'wake_word.py')
    if (!existsSync(sidecarPath)) {
      throw new Error(`Wake word sidecar not found: ${sidecarPath}`)
    }

    this.sidecarProcess = spawn('python', [sidecarPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WAKE_PHRASE: this.wakePhrases[0] },
    })

    this.sidecarProcess.stdout?.setEncoding('utf8')
    this.sidecarProcess.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as SidecarMessage
          this.processTranscript(event.transcript, event.confidence)
        } catch {
          // Non-JSON output from sidecar (log lines etc.) — ignore
        }
      }
    })

    this.sidecarProcess.stderr?.on('data', (data: string) => {
      log.debug('wake word sidecar:', { msg: data.trim() })
    })

    this.sidecarProcess.on('exit', (code) => {
      if (this.isListening) {
        log.warn('wake word sidecar exited unexpectedly', { code })
        this.sidecarProcess = null
      }
    })

    log.info('wake word sidecar started', { pid: this.sidecarProcess.pid })
  }

  /**
   * Stop the detector and kill sidecar process.
   */
  stop(): void {
    this.isListening = false
    if (this.sidecarProcess) {
      this.sidecarProcess.kill('SIGTERM')
      this.sidecarProcess = null
    }
    log.info('wake word detector stopped')
  }

  /**
   * Process a transcript chunk — emits 'detected' if wake phrase found.
   * Called internally by sidecar bridge or externally by STT pipeline.
   * @param transcript - Text to check for wake phrase
   * @param confidence - Confidence score (default 1.0 for manual calls)
   */
  processTranscript(transcript: string, confidence = 1.0): void {
    if (!this.isListening) return
    const lower = transcript.toLowerCase()
    const matched = this.wakePhrases.find((phrase) => lower.includes(phrase))
    if (matched) {
      log.info('wake phrase detected', { phrase: matched, confidence })
      this.emit('detected', {
        transcript,
        phrase: matched,
        confidence,
      } satisfies WakeDetectedEvent)
    }
  }

  /**
   * Check if a transcribed text contains a wake phrase.
   * @param transcript - Text to check
   * @returns True if any wake phrase is found
   */
  containsWakePhrase(transcript: string): boolean {
    const lower = transcript.toLowerCase()
    return this.wakePhrases.some((phrase) => lower.includes(phrase))
  }

  /** Whether the detector is currently active. */
  get active(): boolean {
    return this.isListening
  }
}

/** Singleton wake word detector. */
export const wakeWordDetector = new WakeWordDetector()
