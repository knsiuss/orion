/**
 * @file device-scanner.ts
 * @description Scans for available hardware devices via serial and MQTT protocols.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by startup.ts (fire-and-forget) to populate deviceRegistry.
 *   - Uses dynamic imports for optional deps (serialport, mqtt) — degrades gracefully.
 *   - Registers discovered devices into deviceRegistry singleton.
 */

import { createLogger } from "../logger.js"
import { deviceRegistry } from "./device-registry.js"
import type { HardwareDevice } from "./types.js"

const log = createLogger("hardware.scanner")

/** Dynamically load an optional module, returning null if not installed. */
async function tryRequire(moduleName: string): Promise<unknown> {
  // Using Function constructor avoids TypeScript static analysis of the module specifier
  const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>
  return dynamicImport(moduleName)
}

/**
 * Scans for hardware devices on all supported protocols and registers them.
 * Each protocol scan is isolated — a failure on one does not abort others.
 */
export class DeviceScanner {
  /**
   * Run a full device scan across all supported protocols.
   *
   * @returns Array of all discovered devices (also registered into deviceRegistry).
   */
  async scan(): Promise<HardwareDevice[]> {
    const [serial, mqttDevices] = await Promise.all([
      this.scanSerial().catch((err) => {
        log.warn("serial scan failed", { err })
        return [] as HardwareDevice[]
      }),
      this.scanMqtt().catch((err) => {
        log.warn("mqtt scan failed", { err })
        return [] as HardwareDevice[]
      }),
    ])

    const all = [...serial, ...mqttDevices]
    log.info("device scan complete", { found: all.length })
    return all
  }

  /**
   * Scan available serial ports and create HardwareDevice entries.
   * Requires 'serialport' package — returns empty array if not installed.
   *
   * @returns Devices discovered on serial ports.
   */
  async scanSerial(): Promise<HardwareDevice[]> {
    try {
      const mod = await tryRequire("serialport") as { SerialPort: { list(): Promise<Array<{ path: string; manufacturer?: string }>> } }
      const ports = await mod.SerialPort.list()
      const devices: HardwareDevice[] = ports.map((port) => {
        const device: HardwareDevice = {
          id: `serial:${port.path}`,
          name: port.manufacturer ?? `Serial ${port.path}`,
          type: "arduino",
          protocol: "serial",
          address: port.path,
          capabilities: ["serial-rw"],
          status: "offline",
          lastSeen: 0,
        }
        deviceRegistry.register(device)
        return device
      })
      log.debug("serial scan", { ports: devices.length })
      return devices
    } catch {
      log.debug("serialport package not available — skipping serial scan")
      return []
    }
  }

  /**
   * Attempt MQTT device discovery using broker subscription.
   * Requires 'mqtt' package — returns empty array if not installed.
   *
   * @param brokerUrl - MQTT broker URL (defaults to localhost).
   * @returns Devices discovered via MQTT.
   */
  async scanMqtt(brokerUrl = "mqtt://localhost:1883"): Promise<HardwareDevice[]> {
    try {
      await tryRequire("mqtt")
      // MQTT discovery requires a running broker + devices advertising their presence.
      log.debug("mqtt package available, broker discovery not yet configured", { brokerUrl })
      return []
    } catch {
      log.debug("mqtt package not available — skipping MQTT scan")
      return []
    }
  }
}

/** Singleton device scanner. */
export const deviceScanner = new DeviceScanner()
