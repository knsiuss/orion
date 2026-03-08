/**
 * @file voice-handoff.ts
 * @description Transfers active voice sessions between user devices.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Used when user moves from one room/device to another mid-conversation.
 *   - Checks target device voice capability before handoff.
 *   - Gateway sends voice_handoff WebSocket event to coordinate clients.
 */

import { createLogger } from "../logger.js"
import { pairedDeviceRegistry } from "../pairing/device-registry.js"
import { eventBus } from "../core/event-bus.js"

const log = createLogger("voice.handoff")

/**
 * Coordinates voice session handoffs between paired user devices.
 */
export class VoiceHandoff {
  /**
   * Initiate a voice handoff from one device to another.
   * Signals the target device to prepare for incoming voice.
   *
   * @param fromDeviceId - Device currently handling voice.
   * @param toDeviceId   - Device that should take over.
   */
  async initiateHandoff(fromDeviceId: string, toDeviceId: string): Promise<void> {
    const canAccept = await this.acceptHandoff(toDeviceId)
    if (!canAccept) {
      log.warn("voice handoff refused — target device lacks voice capability", { toDeviceId })
      return
    }

    log.info("voice handoff initiated", { fromDeviceId, toDeviceId })
    // Signal target device to prepare voice capture
    eventBus.dispatch("voice.handoff.initiated", { fromDeviceId, toDeviceId })
  }

  /**
   * Check if a device can accept a voice handoff.
   *
   * @param deviceId - Device to check.
   * @returns True if the device has voice capability.
   */
  async acceptHandoff(deviceId: string): Promise<boolean> {
    const device = pairedDeviceRegistry.get(deviceId)
    if (!device) {
      log.warn("acceptHandoff: device not registered", { deviceId })
      return false
    }
    const hasVoice = device.capabilities.includes("voice") || device.capabilities.includes("microphone")
    return hasVoice
  }

  /**
   * Complete a voice handoff by ending the source session and starting the target.
   *
   * @param fromDeviceId - Device ending voice session.
   * @param toDeviceId   - Device starting voice session.
   */
  completeHandoff(fromDeviceId: string, toDeviceId: string): void {
    log.info("voice handoff complete", { fromDeviceId, toDeviceId })
    eventBus.dispatch("voice.handoff.completed", { fromDeviceId, toDeviceId })
  }
}

/** Singleton voice handoff manager. */
export const voiceHandoff = new VoiceHandoff()
