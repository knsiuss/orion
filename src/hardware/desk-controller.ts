/**
 * @file desk-controller.ts
 * @description High-level desk/workspace controller that orchestrates hardware presets.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Composes ddc-driver, led-driver, and relay-driver.
 *   - Reads DeskConfig from config to resolve named relay and input mappings.
 *   - Called from message-pipeline or skill commands to apply desk presets.
 */

import { createLogger } from "../logger.js"
import config from "../config.js"
import { ddcDriver } from "./drivers/ddc-driver.js"
import { ledDriver } from "./drivers/led-driver.js"
import { relayDriver } from "./drivers/relay-driver.js"
import { deviceRegistry } from "./device-registry.js"
import type { LEDEffect } from "./types.js"

const log = createLogger("hardware.desk")

/** Named monitor input codes (VCP 0x60 values). */
const INPUT_CODES: Record<string, number> = {
  hdmi1: 17,
  hdmi2: 18,
  dp1: 15,
  dp2: 16,
  vga: 1,
}

/**
 * High-level desk controller for EDITH workspace hardware.
 * Abstracts monitor, LED, and relay control behind friendly methods.
 */
export class DeskController {
  /**
   * Set the primary monitor brightness via DDC/CI.
   *
   * @param value - Target brightness 0–100.
   */
  async setMonitorBrightness(value: number): Promise<void> {
    await ddcDriver.setBrightness(config.HARDWARE_MONITOR_DDC_BUS, value)
    log.info("monitor brightness set", { value })
  }

  /**
   * Switch the primary monitor input source.
   *
   * @param inputName - Named input ('hdmi1', 'hdmi2', 'dp1', 'dp2', 'vga').
   */
  async setMonitorInput(inputName: string): Promise<void> {
    const code = INPUT_CODES[inputName.toLowerCase()]
    if (code === undefined) {
      log.warn("unknown monitor input", { inputName })
      return
    }
    await ddcDriver.setInput(config.HARDWARE_MONITOR_DDC_BUS, code)
    log.info("monitor input switched", { inputName })
  }

  /**
   * Set the LED status effect across all registered LED devices.
   *
   * @param status - Named LED effect (idle, listening, thinking, etc.).
   */
  async setLEDStatus(status: LEDEffect): Promise<void> {
    if (!config.HARDWARE_LED_ENABLED) return
    await ledDriver.syncWithStatus(status)
  }

  /**
   * Set a specific hex color on all registered LED devices.
   *
   * @param hex - Color in #RRGGBB format.
   */
  async setLEDColor(hex: string): Promise<void> {
    if (!config.HARDWARE_LED_ENABLED) return
    const leds = deviceRegistry.list().filter((d) => d.type === "led")
    await Promise.all(
      leds.map((d) =>
        ledDriver.setColor(d.id, hex).catch((err) =>
          log.warn("LED color set failed", { deviceId: d.id, err }),
        ),
      ),
    )
  }

  /**
   * Toggle a named relay in the desk relay map.
   *
   * @param name - Human-readable relay name (e.g. 'desk_lamp').
   * @param on   - True to energize, false to de-energize.
   */
  async toggleRelay(name: string, on: boolean): Promise<void> {
    const relayDevices = deviceRegistry.list().filter((d) => d.type === "relay")
    if (relayDevices.length === 0) {
      log.warn("toggleRelay: no relay devices registered", { name })
      return
    }
    // Use first relay device; index encoded as device capability position
    const device = relayDevices[0]
    const caps = device.capabilities
    const idx = caps.indexOf(name)
    const relayIndex = idx >= 0 ? idx : 0
    await relayDriver.setRelay(device.id, relayIndex, on)
    log.info("relay toggled", { name, on })
  }

  /**
   * Apply a named desk preset (monitor brightness + LED + relays).
   *
   * @param presetName - Name of the preset to apply.
   */
  async applyPreset(presetName: string): Promise<void> {
    log.info("applying desk preset", { presetName })
    // Preset definitions are loaded from edith.json at runtime.
    // This stub logs the action — real presets extend via config.
    log.warn("desk preset system not yet configured via edith.json", { presetName })
  }
}

/** Singleton desk controller. */
export const deskController = new DeskController()
