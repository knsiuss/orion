/**
 * @file sensor-reader.ts
 * @description Ring-buffer sensor reading store for hardware sensor data.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - sensor-automation.ts calls evaluate() with each new reading.
 *   - Drivers call record() when they receive data from hardware.
 *   - message-pipeline can query getLatest() for context injection.
 */

import { createLogger } from "../logger.js"
import type { SensorReading } from "./types.js"

const log = createLogger("hardware.sensor-reader")

/** Maximum readings stored per device before oldest are evicted. */
const MAX_HISTORY_PER_DEVICE = 100

/**
 * Stores and retrieves sensor readings in a per-device ring buffer.
 */
export class SensorReader {
  /** Per-device reading history (ring buffer, max MAX_HISTORY_PER_DEVICE). */
  private readonly history = new Map<string, SensorReading[]>()

  /** Registered sensor source registrations (deviceId → sensorType). */
  private readonly sources = new Map<string, string>()

  /**
   * Register a sensor source so the reader knows to expect readings from it.
   *
   * @param deviceId   - Hardware device providing the sensor.
   * @param sensorType - Type of reading ('temperature', 'humidity', etc.).
   */
  addSource(deviceId: string, sensorType: string): void {
    this.sources.set(deviceId, sensorType)
    log.debug("sensor source added", { deviceId, sensorType })
  }

  /**
   * Push a new reading into the per-device ring buffer.
   * Oldest reading is evicted when buffer exceeds MAX_HISTORY_PER_DEVICE.
   *
   * @param reading - The sensor reading to store.
   */
  record(reading: SensorReading): void {
    if (!this.history.has(reading.deviceId)) {
      this.history.set(reading.deviceId, [])
    }
    const buf = this.history.get(reading.deviceId)!
    buf.push(reading)
    if (buf.length > MAX_HISTORY_PER_DEVICE) {
      buf.shift()
    }
    log.debug("sensor reading recorded", {
      deviceId: reading.deviceId,
      sensorType: reading.sensorType,
      value: reading.value,
    })
  }

  /**
   * Get the most recent reading from a device.
   *
   * @param deviceId - Device to query.
   * @returns Latest reading, or undefined if none available.
   */
  getLatest(deviceId: string): SensorReading | undefined {
    const buf = this.history.get(deviceId)
    return buf ? buf[buf.length - 1] : undefined
  }

  /**
   * Get the last N readings from a device (newest last).
   *
   * @param deviceId - Device to query.
   * @param count    - Maximum number of readings to return (default all).
   * @returns Array of readings, newest last.
   */
  getHistory(deviceId: string, count?: number): SensorReading[] {
    const buf = this.history.get(deviceId) ?? []
    return count !== undefined ? buf.slice(-count) : [...buf]
  }
}

/** Singleton sensor reader. */
export const sensorReader = new SensorReader()
