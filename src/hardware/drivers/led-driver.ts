/**
 * @file led-driver.ts
 * @description LED strip and RGB light driver for EDITH status visualization.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Sends color/effect commands to registered LED devices via serial-driver.ts.
 *   - deviceRegistry is used to find all LED-type devices.
 *   - desk-controller.ts calls syncWithStatus() when EDITH state changes.
 */

import { createLogger } from "../../logger.js"
import { deviceRegistry } from "../device-registry.js"
import { serialDriver } from "./serial-driver.js"
import type { LEDEffect } from "../types.js"

const log = createLogger("hardware.driver.led")

/** Map of LEDEffect to RGB hex color for serial protocol. */
const EFFECT_COLORS: Record<LEDEffect, string> = {
  idle: "#001133",
  listening: "#0044FF",
  thinking: "#FF8800",
  speaking: "#00FF44",
  error: "#FF0000",
  mission: "#AA00FF",
}

/**
 * Driver for LED strips and RGB lights.
 * Translates high-level effects into color commands sent over serial.
 */
export class LEDDriver {
  /**
   * Set an LED device to a specific hex color.
   *
   * @param deviceId - Registered device ID.
   * @param hex      - Color in #RRGGBB format.
   */
  async setColor(deviceId: string, hex: string): Promise<void> {
    const device = deviceRegistry.get(deviceId)
    if (!device) {
      log.warn("setColor: device not found", { deviceId })
      return
    }
    try {
      const cmd = `COLOR ${hex}\n`
      await serialDriver.write(device.address, cmd)
      log.debug("LED color set", { deviceId, hex })
    } catch (err) {
      log.warn("LED setColor failed", { deviceId, err })
    }
  }

  /**
   * Apply a named LED effect to a device.
   *
   * @param deviceId - Registered device ID.
   * @param effect   - Named LED effect.
   */
  async setEffect(deviceId: string, effect: LEDEffect): Promise<void> {
    const hex = EFFECT_COLORS[effect]
    await this.setColor(deviceId, hex)
    log.debug("LED effect applied", { deviceId, effect })
  }

  /**
   * Sync all registered LED devices to a given status effect.
   *
   * @param status - Current EDITH operational status.
   */
  async syncWithStatus(status: LEDEffect): Promise<void> {
    const ledDevices = deviceRegistry.list().filter((d) => d.type === "led")
    await Promise.all(
      ledDevices.map((d) =>
        this.setEffect(d.id, status).catch((err) =>
          log.warn("LED sync failed for device", { deviceId: d.id, err }),
        ),
      ),
    )
  }

  /**
   * Turn off an LED device (set to black).
   *
   * @param deviceId - Registered device ID.
   */
  async off(deviceId: string): Promise<void> {
    await this.setColor(deviceId, "#000000")
  }
}

/** Singleton LED driver. */
export const ledDriver = new LEDDriver()
