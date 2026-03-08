/**
 * @file presence-manager.ts
 * @description Tracks real-time presence state of user devices for routing decisions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - device-router.ts calls getActiveDevice() to select routing targets.
 *   - Mobile apps send heartbeats via WebSocket to update presence.
 *   - DND (Do Not Disturb) mode is respected by all notification senders.
 */

import { createLogger } from "../logger.js"
import { pairedDeviceRegistry } from "../pairing/device-registry.js"

const log = createLogger("sessions.presence-manager")

/** Possible presence states for a device. */
export type PresenceState = "active" | "idle" | "background" | "offline" | "dnd"

/** Presence entry for a single device. */
interface PresenceEntry {
  /** Current presence state. */
  state: PresenceState
  /** Unix timestamp of last heartbeat. */
  lastSeen: number
  /** Unix timestamp when DND ends (if state is 'dnd'). */
  dndUntil?: number
}

/** Milliseconds after last activity before a device is considered idle. */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000
/** Milliseconds after last heartbeat before a device is considered offline. */
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000

/**
 * Tracks and queries real-time presence state of user devices.
 */
export class PresenceManager {
  /** Presence data keyed by deviceId. */
  private readonly presence = new Map<string, PresenceEntry>()

  /**
   * Record a device heartbeat to update its presence state.
   *
   * @param deviceId    - Device sending the heartbeat.
   * @param isActive    - Whether the device screen is active/focused.
   * @param lastInputMs - Milliseconds since last user input (for idle detection).
   */
  heartbeat(deviceId: string, isActive: boolean, lastInputMs?: number): void {
    const now = Date.now()
    const existing = this.presence.get(deviceId)

    // Preserve DND state
    if (existing?.state === "dnd" && existing.dndUntil && existing.dndUntil > now) {
      existing.lastSeen = now
      return
    }

    let state: PresenceState
    if (!isActive) {
      state = "background"
    } else if (lastInputMs !== undefined && lastInputMs > IDLE_THRESHOLD_MS) {
      state = "idle"
    } else {
      state = "active"
    }

    this.presence.set(deviceId, { state, lastSeen: now })
    pairedDeviceRegistry.updateLastSeen(deviceId)
    log.debug("presence heartbeat", { deviceId, state })
  }

  /**
   * Get current presence state of a device.
   *
   * @param deviceId - Device to query.
   * @returns State and lastSeen timestamp.
   */
  getPresence(deviceId: string): { state: PresenceState; lastSeen: number } {
    const entry = this.presence.get(deviceId)
    if (!entry) return { state: "offline", lastSeen: 0 }

    const now = Date.now()
    // Auto-expire to offline if no heartbeat
    if (now - entry.lastSeen > OFFLINE_THRESHOLD_MS) {
      return { state: "offline", lastSeen: entry.lastSeen }
    }
    // Check DND expiry
    if (entry.state === "dnd" && entry.dndUntil && entry.dndUntil <= now) {
      entry.state = "idle"
    }

    return { state: entry.state, lastSeen: entry.lastSeen }
  }

  /**
   * Determine the most active device for a user.
   * Priority: active > idle > background > 'all' (broadcast).
   *
   * @param userId - User to find the active device for.
   * @returns DeviceId of the most active device, or 'all' if none found.
   */
  getActiveDevice(userId: string): string | "all" {
    const devices = pairedDeviceRegistry.listForUser(userId)
    if (devices.length === 0) return "all"

    const scored = devices
      .map((d) => {
        const { state } = this.getPresence(d.deviceId)
        const score = state === "active" ? 3 : state === "idle" ? 2 : state === "background" ? 1 : 0
        return { deviceId: d.deviceId, score }
      })
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)

    return scored[0]?.deviceId ?? "all"
  }

  /**
   * Set Do Not Disturb mode for a device.
   *
   * @param deviceId - Device to put in DND mode.
   * @param until    - Unix timestamp when DND ends (optional; indefinite if omitted).
   */
  setDND(deviceId: string, until?: number): void {
    const entry = this.presence.get(deviceId) ?? { state: "dnd" as PresenceState, lastSeen: Date.now() }
    entry.state = "dnd"
    entry.dndUntil = until
    this.presence.set(deviceId, entry)
    log.info("DND activated", { deviceId, until })
  }
}

/** Singleton presence manager. */
export const presenceManager = new PresenceManager()
