/**
 * @file relay-driver.ts
 * @description Relay board driver for toggling power outlets and switches.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Sends relay commands over serial to relay controller devices.
 *   - desk-controller.ts calls setRelay() via named relay mappings in DeskConfig.
 *   - scheduleRelay() uses setInterval for simple time-based automation.
 */

import { createLogger } from "../../logger.js"
import { deviceRegistry } from "../device-registry.js"
import { serialDriver } from "./serial-driver.js"

const log = createLogger("hardware.driver.relay")

/**
 * Driver for relay boards (power switching, appliance control).
 * Communicates via serial protocol to relay controller firmware.
 */
export class RelayDriver {
  /** In-memory relay state: Map<deviceId, Map<relayIndex, isOn>>. */
  private readonly state = new Map<string, Map<number, boolean>>()

  /** Active schedule intervals: Map<`${deviceId}:${relayIndex}`, intervalId>. */
  private readonly schedules = new Map<string, ReturnType<typeof setInterval>>()

  /**
   * Set a relay to on or off state.
   *
   * @param deviceId   - Registered device ID.
   * @param relayIndex - Zero-based relay channel index.
   * @param on         - True to energize, false to de-energize.
   */
  async setRelay(deviceId: string, relayIndex: number, on: boolean): Promise<void> {
    const device = deviceRegistry.get(deviceId)
    if (!device) {
      log.warn("setRelay: device not found", { deviceId })
      return
    }
    try {
      const cmd = `RELAY ${relayIndex} ${on ? "ON" : "OFF"}\n`
      await serialDriver.write(device.address, cmd)

      // Update in-memory state
      if (!this.state.has(deviceId)) this.state.set(deviceId, new Map())
      this.state.get(deviceId)!.set(relayIndex, on)

      log.debug("relay set", { deviceId, relayIndex, on })
    } catch (err) {
      log.warn("relay command failed", { deviceId, relayIndex, err })
    }
  }

  /**
   * Get the current known state of a relay.
   *
   * @param deviceId   - Registered device ID.
   * @param relayIndex - Zero-based relay channel index.
   * @returns True if the relay is on, false otherwise.
   */
  getState(deviceId: string, relayIndex: number): boolean {
    return this.state.get(deviceId)?.get(relayIndex) ?? false
  }

  /**
   * Schedule a relay to turn on and off at specific times each day.
   * Uses HH:MM format (24-hour). Cancels any existing schedule for this relay.
   *
   * @param deviceId   - Registered device ID.
   * @param relayIndex - Zero-based relay channel index.
   * @param onTime     - Daily on time in "HH:MM" format.
   * @param offTime    - Daily off time in "HH:MM" format.
   */
  scheduleRelay(deviceId: string, relayIndex: number, onTime: string, offTime: string): void {
    const key = `${deviceId}:${relayIndex}`

    // Clear existing schedule
    const existing = this.schedules.get(key)
    if (existing) clearInterval(existing)

    const parseTime = (t: string): { h: number; m: number } => {
      const [h = 0, m = 0] = t.split(":").map(Number)
      return { h, m }
    }

    const interval = setInterval(() => {
      const now = new Date()
      const h = now.getHours()
      const m = now.getMinutes()
      const on = parseTime(onTime)
      const off = parseTime(offTime)

      if (h === on.h && m === on.m) {
        void this.setRelay(deviceId, relayIndex, true)
          .catch((err) => log.warn("scheduled relay ON failed", { deviceId, err }))
      } else if (h === off.h && m === off.m) {
        void this.setRelay(deviceId, relayIndex, false)
          .catch((err) => log.warn("scheduled relay OFF failed", { deviceId, err }))
      }
    }, 60_000)

    this.schedules.set(key, interval)
    log.info("relay scheduled", { deviceId, relayIndex, onTime, offTime })
  }
}

/** Singleton relay driver. */
export const relayDriver = new RelayDriver()
