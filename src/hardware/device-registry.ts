/**
 * @file device-registry.ts
 * @description In-memory registry of all hardware devices known to EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Populated by device-scanner.ts at startup.
 *   - Read by desk-controller.ts and all driver modules.
 *   - Drivers call updateStatus() when connectivity changes.
 */

import { createLogger } from "../logger.js"
import type { HardwareDevice, HardwareProtocol, HardwareStatus } from "./types.js"

const log = createLogger("hardware.registry")

/**
 * In-memory registry that tracks all hardware devices by their ID.
 * Supports filtering by protocol and updating device status at runtime.
 */
export class DeviceRegistry {
  /** Internal map of deviceId → device. */
  private readonly devices = new Map<string, HardwareDevice>()

  /**
   * Register a hardware device.
   * Replaces any existing entry with the same id.
   *
   * @param device - The device to register.
   */
  register(device: HardwareDevice): void {
    this.devices.set(device.id, { ...device })
    log.debug("device registered", { id: device.id, type: device.type, protocol: device.protocol })
  }

  /**
   * Remove a device from the registry.
   *
   * @param deviceId - ID of the device to remove.
   */
  unregister(deviceId: string): void {
    this.devices.delete(deviceId)
    log.debug("device unregistered", { deviceId })
  }

  /**
   * Retrieve a single device by ID.
   *
   * @param deviceId - Device identifier.
   * @returns The device or undefined if not found.
   */
  get(deviceId: string): HardwareDevice | undefined {
    return this.devices.get(deviceId)
  }

  /**
   * List all registered devices.
   *
   * @returns Array of all devices.
   */
  list(): HardwareDevice[] {
    return Array.from(this.devices.values())
  }

  /**
   * List devices that use a specific communication protocol.
   *
   * @param protocol - Protocol to filter by.
   * @returns Devices matching the given protocol.
   */
  listByProtocol(protocol: HardwareProtocol): HardwareDevice[] {
    return this.list().filter((d) => d.protocol === protocol)
  }

  /**
   * Update the operational status of a device and refresh its lastSeen timestamp.
   *
   * @param deviceId - Device to update.
   * @param status   - New status value.
   */
  updateStatus(deviceId: string, status: HardwareStatus): void {
    const device = this.devices.get(deviceId)
    if (!device) {
      log.warn("updateStatus: device not found", { deviceId })
      return
    }
    device.status = status
    if (status === "online") {
      device.lastSeen = Date.now()
    }
    log.debug("device status updated", { deviceId, status })
  }
}

/** Singleton device registry used by all hardware modules. */
export const deviceRegistry = new DeviceRegistry()
