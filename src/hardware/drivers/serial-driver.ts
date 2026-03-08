/**
 * @file serial-driver.ts
 * @description Serial port driver with graceful degradation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses 'serialport' npm package via dynamic import (optional dependency).
 *   - Falls back gracefully if package is not installed.
 *   - Used by device-scanner.ts and arduino-codegen.ts upload flow.
 */

import { createLogger } from "../../logger.js"

const log = createLogger("hardware.driver.serial")

/** Map of port path → raw SerialPort instance. */
type RawPort = {
  write(data: string | Buffer, cb?: (err: Error | null | undefined) => void): boolean
  close(cb?: (err: Error | null | undefined) => void): void
  isOpen: boolean
}

/** SerialPort constructor shape loaded from optional dynamic import. */
type SerialPortModule = {
  SerialPort: new (opts: { path: string; baudRate: number; autoOpen: boolean }) => RawPort & {
    open(cb?: (err: Error | null | undefined) => void): void
  }
}

/** Load optional module without TypeScript module resolution. */
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>

/**
 * Driver for serial port communication (Arduino, ESP32, etc.).
 * Degrades gracefully when 'serialport' package is not installed.
 */
export class SerialDriver {
  /** Active port instances keyed by port path. */
  private readonly ports = new Map<string, RawPort>()

  /**
   * Open a serial port connection.
   *
   * @param port     - Port path (e.g. '/dev/ttyUSB0', 'COM3').
   * @param baudRate - Baud rate (default 9600).
   */
  async connect(port: string, baudRate = 9600): Promise<void> {
    if (this.ports.has(port)) {
      log.debug("serial port already open", { port })
      return
    }
    try {
      const mod = await dynamicImport("serialport") as SerialPortModule
      const sp = new mod.SerialPort({ path: port, baudRate, autoOpen: false })
      await new Promise<void>((resolve, reject) => {
        sp.open((err) => (err ? reject(err) : resolve()))
      })
      this.ports.set(port, sp)
      log.info("serial port connected", { port, baudRate })
    } catch (err) {
      log.warn("serial connect failed", { port, err })
      throw err
    }
  }

  /**
   * Close a serial port connection.
   *
   * @param port - Port path to disconnect.
   */
  async disconnect(port: string): Promise<void> {
    const sp = this.ports.get(port)
    if (!sp) return
    await new Promise<void>((resolve) => {
      sp.close(() => resolve())
    })
    this.ports.delete(port)
    log.info("serial port disconnected", { port })
  }

  /**
   * Write data to an open serial port.
   *
   * @param port - Port path.
   * @param data - Data to write (string or Buffer).
   */
  async write(port: string, data: Buffer | string): Promise<void> {
    const sp = this.ports.get(port)
    if (!sp) throw new Error(`Serial port not open: ${port}`)
    await new Promise<void>((resolve, reject) => {
      sp.write(data, (err) => (err ? reject(err) : resolve()))
    })
  }

  /**
   * Read buffered data from a serial port (stub — real impl uses readline parser).
   *
   * @param _port - Port path.
   * @returns Buffer with available data.
   */
  async read(_port: string): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  /**
   * Check whether a port is currently open.
   *
   * @param port - Port path.
   * @returns True if the port is open.
   */
  isConnected(port: string): boolean {
    return this.ports.get(port)?.isOpen ?? false
  }
}

/** Singleton serial driver. */
export const serialDriver = new SerialDriver()
