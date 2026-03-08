/**
 * @file types.ts
 * @description Hardware bridge type definitions for Phase 23.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Shared types used by device-registry, drivers, and desk-controller.
 *   All hardware modules import from this file — no circular dependencies.
 */

/** Supported physical hardware device categories. */
export type HardwareDeviceType =
  | "arduino"
  | "esp32"
  | "rpi"
  | "monitor"
  | "led"
  | "printer"
  | "sensor"
  | "relay"

/** Communication protocol for hardware devices. */
export type HardwareProtocol = "serial" | "mqtt" | "ble" | "ddc" | "http" | "gpio"

/** Runtime operational status of a hardware device. */
export type HardwareStatus = "online" | "offline" | "error"

/** Represents a registered physical device managed by EDITH. */
export interface HardwareDevice {
  /** Unique device identifier. */
  id: string
  /** Human-readable device name. */
  name: string
  /** Device category (arduino, led, sensor, etc.). */
  type: HardwareDeviceType
  /** Communication protocol. */
  protocol: HardwareProtocol
  /** Connection address (COM port, IP, BLE MAC, I2C bus, etc.). */
  address: string
  /** List of supported capability strings (e.g. ['brightness', 'color']). */
  capabilities: string[]
  /** Current operational status. */
  status: HardwareStatus
  /** Unix timestamp of last successful contact. */
  lastSeen: number
  /** Firmware/software version string, if known. */
  firmwareVersion?: string
  /** Arbitrary extra metadata. */
  metadata?: Record<string, unknown>
}

/** A command to send to a hardware device. */
export interface HardwareCommand {
  /** Target device identifier. */
  deviceId: string
  /** Action name (e.g. 'set_brightness', 'toggle'). */
  action: string
  /** Command parameters. */
  params?: Record<string, unknown>
}

/** Result returned after executing a hardware command. */
export interface HardwareResult {
  /** Whether the command succeeded. */
  success: boolean
  /** Response data from the device, if any. */
  data?: unknown
  /** Error message if success is false. */
  error?: string
}

/** A timestamped sensor reading from a hardware device. */
export interface SensorReading {
  /** ID of the device that produced this reading. */
  deviceId: string
  /** Type of sensor (e.g. 'temperature', 'humidity', 'motion'). */
  sensorType: string
  /** Numeric sensor value. */
  value: number
  /** Unit of measurement (e.g. 'C', '%', 'lux'). */
  unit: string
  /** Unix timestamp of the reading. */
  timestamp: number
}

/** Configuration for the desk/workspace hardware setup. */
export interface DeskConfig {
  /** DDC I2C bus index for the primary monitor. */
  monitorDdcBus: number
  /** Map of relay names to relay indices. */
  relayMap: Record<string, number>
  /** Device ID of the primary LED strip. */
  ledDeviceId?: string
  /** OctoPrint base URL for 3D printer integration. */
  octoprintUrl?: string
  /** Named presets (name → { monitorBrightness, ledEffect, relays }). */
  presets: Record<string, DeskPreset>
}

/** A named desk preset configuration. */
export interface DeskPreset {
  /** Target monitor brightness 0-100. */
  monitorBrightness?: number
  /** LED effect to activate. */
  ledEffect?: LEDEffect
  /** Relay states to apply (name → on/off). */
  relays?: Record<string, boolean>
}

/** Visual LED effect states that map to EDITH's operational modes. */
export type LEDEffect =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "mission"
