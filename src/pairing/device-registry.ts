/**
 * @file device-registry.ts
 * @description Registry of paired user devices for cross-device mesh (Phase 27).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Different from src/hardware/device-registry.ts — this tracks user-owned devices.
 *   - presence-manager.ts uses listForUser() to determine routing targets.
 *   - qr-generator.ts creates auth tokens that are stored here on pairing.
 */

import { createLogger } from "../logger.js"

const log = createLogger("pairing.device-registry")

/** Registration record for a paired user device. */
export interface DeviceRegistration {
  /** Unique device identifier (UUID). */
  deviceId: string
  /** Owner user ID. */
  userId: string
  /** Human-readable device name (e.g. 'Max's iPhone'). */
  name: string
  /** Operating system of the device. */
  os: "ios" | "android" | "windows" | "macos" | "linux" | "web"
  /** Form factor of the device. */
  type: "phone" | "laptop" | "tablet" | "watch" | "browser"
  /** Gateway instance this device connected through. */
  gatewayId: string
  /** List of supported capability strings (e.g. ['voice', 'push', 'vision']). */
  capabilities: string[]
  /** Unix timestamp of last heartbeat. */
  lastSeen: number
  /** Unix timestamp when the device was first paired. */
  paired: number
  /** Signed auth token for this device's API access. */
  authToken: string
}

/**
 * In-memory registry of paired user devices for cross-device routing.
 */
export class PairedDeviceRegistry {
  /** Internal device store keyed by deviceId. */
  private readonly devices = new Map<string, DeviceRegistration>()

  /**
   * Register a new paired device.
   *
   * @param device - Device registration details.
   */
  register(device: DeviceRegistration): void {
    this.devices.set(device.deviceId, { ...device })
    log.info("device paired", { deviceId: device.deviceId, userId: device.userId, type: device.type })
  }

  /**
   * Unregister a device (e.g., user unpairs it).
   *
   * @param deviceId - Device to remove.
   */
  unregister(deviceId: string): void {
    this.devices.delete(deviceId)
    log.info("device unpaired", { deviceId })
  }

  /**
   * Retrieve a specific device by ID.
   *
   * @param deviceId - Device identifier.
   * @returns DeviceRegistration or undefined if not found.
   */
  get(deviceId: string): DeviceRegistration | undefined {
    return this.devices.get(deviceId)
  }

  /**
   * List all devices belonging to a specific user.
   *
   * @param userId - User whose devices to list.
   * @returns Array of registered devices for this user.
   */
  listForUser(userId: string): DeviceRegistration[] {
    return [...this.devices.values()].filter((d) => d.userId === userId)
  }

  /**
   * Update the lastSeen timestamp for a device.
   *
   * @param deviceId - Device to update.
   */
  updateLastSeen(deviceId: string): void {
    const device = this.devices.get(deviceId)
    if (device) {
      device.lastSeen = Date.now()
    }
  }
}

/** Singleton paired device registry. */
export const pairedDeviceRegistry = new PairedDeviceRegistry()
