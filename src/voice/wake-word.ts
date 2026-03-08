/**
 * @file wake-word.ts
 * @description "Hey EDITH" wake word detection using local Whisper model.
 *
 * ARCHITECTURE / INTEGRATION:
 *   EventEmitter that fires 'detected' event when wake phrase is heard.
 *   Python sidecar (python/voice/wake_word.py) handles actual audio capture.
 *   Privacy: all processing local, no audio leaves device.
 *   Integrates with always-on.ts for full voice pipeline activation.
 */
import { createLogger } from '../logger.js'
import { EventEmitter } from 'node:events'
import config from '../config.js'

const log = createLogger('voice.wake-word')

/** Wake phrase detection event payload. */
export interface WakeDetectedEvent {
  transcript: string
}

class WakeWordDetector extends EventEmitter {
  private isListening = false
  private readonly wakePhrases: string[]

  constructor() {
    super()
    this.wakePhrases = [
      config.WAKE_WORD_PHRASE || 'hey edith',
      'edith',
      'hey edit', // common mishearing
    ]
  }

  /** Start listening for wake word. */
  start(): void {
    if (this.isListening) return
    this.isListening = true
    log.info('wake word detection started', { phrases: this.wakePhrases })
  }

  /** Stop listening for wake word. */
  stop(): void {
    this.isListening = false
    log.info('wake word detection stopped')
  }

  /**
   * Check if a transcribed text contains a wake phrase.
   * @param transcript - Text to check
   * @returns True if any wake phrase is found
   */
  containsWakePhrase(transcript: string): boolean {
    const lower = transcript.toLowerCase()
    return this.wakePhrases.some(phrase => lower.includes(phrase))
  }

  /**
   * Process a transcript chunk — emits 'detected' if wake phrase found.
   * @param transcript - Transcript text from STT
   */
  processTranscript(transcript: string): void {
    if (!this.isListening) return
    if (this.containsWakePhrase(transcript)) {
      log.info('wake phrase detected', { transcript: transcript.slice(0, 50) })
      this.emit('detected', { transcript } satisfies WakeDetectedEvent)
    }
  }

  /** Whether the detector is currently active. */
  get active(): boolean {
    return this.isListening
  }
}

/** Singleton wake word detector. */
export const wakeWordDetector = new WakeWordDetector()
