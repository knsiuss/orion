/**
 * @file always-on.ts
 * @description Always-on voice mode — continuously listens via wake word, activates on detection.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Manages the wake word → STT → pipeline → TTS cycle.
 *   Integrates wakeWordDetector with VoiceBridge.
 *   Requires WAKE_WORD_ENABLED=true to activate.
 */
import { createLogger } from '../logger.js'
import { wakeWordDetector, type WakeDetectedEvent } from './wake-word.js'
import config from '../config.js'

const log = createLogger('voice.always-on')

class AlwaysOnVoice {
  private isActive = false

  /**
   * Start always-on voice mode.
   * No-op if WAKE_WORD_ENABLED is not 'true'.
   */
  start(): void {
    if (this.isActive) return
    if (config.WAKE_WORD_ENABLED !== 'true') {
      log.debug('wake word disabled, skipping always-on start')
      return
    }
    this.isActive = true
    wakeWordDetector.start()
    wakeWordDetector.on('detected', (event: WakeDetectedEvent) => {
      log.info('wake word detected, activating voice pipeline', { transcript: event.transcript })
      this.onWakeDetected(event)
    })
    log.info('always-on voice mode started')
  }

  /** Stop always-on voice mode and clean up listeners. */
  stop(): void {
    if (!this.isActive) return
    wakeWordDetector.stop()
    wakeWordDetector.removeAllListeners('detected')
    this.isActive = false
    log.info('always-on voice mode stopped')
  }

  /** Handle wake word detection — placeholder for VoiceBridge integration. */
  private onWakeDetected(_event: WakeDetectedEvent): void {
    // Placeholder — in full impl, emit to VoiceBridge or trigger STT pipeline
    log.debug('wake detection handled')
  }

  /** Whether always-on is currently active. */
  get running(): boolean {
    return this.isActive
  }
}

/** Singleton always-on voice controller. */
export const alwaysOnVoice = new AlwaysOnVoice()
