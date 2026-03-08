/**
 * @file ddc-driver.ts
 * @description DDC/CI monitor control driver for brightness, input switching, and power.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Attempts to use 'ddcci' npm package via dynamic import.
 *   - Degrades gracefully (logs warning) if ddcci is not installed.
 *   - Used by desk-controller.ts for monitor preset management.
 */

import { createLogger } from "../../logger.js"

const log = createLogger("hardware.driver.ddc")

/** Minimal ddcci module shape. */
type DDCCIModule = {
  setBrightness(busId: number, value: number): void
  getBrightness(busId: number): number
  setVCPFeature(busId: number, code: number, value: number): void
}

/** Load optional module without TypeScript module resolution. */
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>

/**
 * Driver for DDC/CI monitor control.
 * Controls brightness, input source, and power via the DDC/CI protocol.
 */
export class DDCDriver {
  /** Cached ddcci module, loaded lazily. */
  private ddcci: DDCCIModule | null = null
  /** Whether ddcci was found to be unavailable (skip future attempts). */
  private unavailable = false

  /**
   * Load the ddcci module lazily (once).
   *
   * @returns DDCCIModule or null if not available.
   */
  private async getDDCCI(): Promise<DDCCIModule | null> {
    if (this.ddcci !== null) return this.ddcci
    if (this.unavailable) return null
    try {
      this.ddcci = await dynamicImport("ddcci") as DDCCIModule
      return this.ddcci
    } catch {
      this.unavailable = true
      log.warn("ddcci package not available — DDC control disabled")
      return null
    }
  }

  /**
   * Set monitor brightness via DDC/CI.
   *
   * @param busId - DDC I2C bus index (usually 0 for the primary monitor).
   * @param value - Brightness level 0–100 (clamped automatically).
   */
  async setBrightness(busId: number, value: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    const ddc = await this.getDDCCI()
    if (!ddc) return
    try {
      ddc.setBrightness(busId, clamped)
      log.debug("monitor brightness set", { busId, value: clamped })
    } catch (err) {
      log.warn("DDC setBrightness failed", { busId, err })
    }
  }

  /**
   * Read current monitor brightness via DDC/CI.
   *
   * @param busId - DDC I2C bus index.
   * @returns Brightness 0–100, or 50 as fallback.
   */
  async getBrightness(busId: number): Promise<number> {
    const ddc = await this.getDDCCI()
    if (!ddc) return 50
    try {
      return ddc.getBrightness(busId)
    } catch (err) {
      log.warn("DDC getBrightness failed", { busId, err })
      return 50
    }
  }

  /**
   * Switch monitor input source via DDC VCP code 0x60.
   *
   * @param busId     - DDC I2C bus index.
   * @param inputCode - VCP 0x60 input value (e.g. 17=HDMI1, 18=HDMI2, 15=DP1).
   */
  async setInput(busId: number, inputCode: number): Promise<void> {
    const ddc = await this.getDDCCI()
    if (!ddc) return
    try {
      ddc.setVCPFeature(busId, 0x60, inputCode)
      log.debug("monitor input switched", { busId, inputCode })
    } catch (err) {
      log.warn("DDC setInput failed", { busId, err })
    }
  }

  /**
   * Set monitor power state via DDC VCP code 0xD6.
   *
   * @param busId - DDC I2C bus index.
   * @param on    - True to power on, false to standby.
   */
  async setPower(busId: number, on: boolean): Promise<void> {
    const ddc = await this.getDDCCI()
    if (!ddc) return
    try {
      ddc.setVCPFeature(busId, 0xD6, on ? 1 : 4)
      log.debug("monitor power changed", { busId, on })
    } catch (err) {
      log.warn("DDC setPower failed", { busId, err })
    }
  }
}

/** Singleton DDC driver. */
export const ddcDriver = new DDCDriver()
