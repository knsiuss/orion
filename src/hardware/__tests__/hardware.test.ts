/**
 * @file hardware.test.ts
 * @description Tests for Phase 23 hardware bridge modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { DeviceRegistry } from "../device-registry.js"
import { SensorReader } from "../sensor-reader.js"
import { SensorAutomation } from "../sensor-automation.js"
import type { HardwareDevice, SensorReading } from "../types.js"

// ---------------------------------------------------------------------------
// DeviceRegistry
// ---------------------------------------------------------------------------
describe("DeviceRegistry", () => {
  let registry: DeviceRegistry

  const makeDevice = (id: string): HardwareDevice => ({
    id,
    name: `Device ${id}`,
    type: "arduino",
    protocol: "serial",
    address: `/dev/ttyUSB${id}`,
    capabilities: ["serial-rw"],
    status: "offline",
    lastSeen: 0,
  })

  beforeEach(() => {
    registry = new DeviceRegistry()
  })

  it("registers and retrieves a device", () => {
    const d = makeDevice("1")
    registry.register(d)
    expect(registry.get("1")).toMatchObject({ id: "1", type: "arduino" })
  })

  it("lists all registered devices", () => {
    registry.register(makeDevice("a"))
    registry.register(makeDevice("b"))
    expect(registry.list()).toHaveLength(2)
  })

  it("unregisters a device", () => {
    registry.register(makeDevice("x"))
    registry.unregister("x")
    expect(registry.get("x")).toBeUndefined()
  })

  it("updateStatus sets status and refreshes lastSeen when online", () => {
    registry.register(makeDevice("z"))
    const before = Date.now()
    registry.updateStatus("z", "online")
    const device = registry.get("z")!
    expect(device.status).toBe("online")
    expect(device.lastSeen).toBeGreaterThanOrEqual(before)
  })

  it("updateStatus warns but does not throw for unknown device", () => {
    expect(() => registry.updateStatus("nonexistent", "error")).not.toThrow()
  })

  it("listByProtocol filters correctly", () => {
    const d1 = { ...makeDevice("p1"), protocol: "serial" as const }
    const d2 = { ...makeDevice("p2"), protocol: "mqtt" as const }
    registry.register(d1)
    registry.register(d2)
    expect(registry.listByProtocol("serial")).toHaveLength(1)
    expect(registry.listByProtocol("mqtt")).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// SensorReader
// ---------------------------------------------------------------------------
describe("SensorReader", () => {
  let reader: SensorReader

  const makeReading = (deviceId: string, value: number, ts = Date.now()): SensorReading => ({
    deviceId,
    sensorType: "temperature",
    value,
    unit: "C",
    timestamp: ts,
  })

  beforeEach(() => {
    reader = new SensorReader()
  })

  it("records readings and returns latest", () => {
    reader.record(makeReading("dev1", 21))
    reader.record(makeReading("dev1", 22))
    expect(reader.getLatest("dev1")?.value).toBe(22)
  })

  it("getLatest returns undefined for unknown device", () => {
    expect(reader.getLatest("unknown")).toBeUndefined()
  })

  it("ring buffer evicts oldest when max exceeded", () => {
    for (let i = 0; i < 105; i++) {
      reader.record(makeReading("dev2", i))
    }
    const hist = reader.getHistory("dev2")
    expect(hist).toHaveLength(100)
    // Oldest should be i=5 (0-4 evicted)
    expect(hist[0].value).toBe(5)
    // Newest should be i=104
    expect(hist[hist.length - 1].value).toBe(104)
  })

  it("getHistory respects count parameter", () => {
    for (let i = 0; i < 10; i++) reader.record(makeReading("dev3", i))
    expect(reader.getHistory("dev3", 3)).toHaveLength(3)
  })

  it("addSource does not throw", () => {
    expect(() => reader.addSource("dev4", "humidity")).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SensorAutomation
// ---------------------------------------------------------------------------
describe("SensorAutomation", () => {
  let automation: SensorAutomation

  const makeReading = (value: number): SensorReading => ({
    deviceId: "sensor1",
    sensorType: "temperature",
    value,
    unit: "C",
    timestamp: Date.now(),
  })

  beforeEach(() => {
    automation = new SensorAutomation()
  })

  it("triggers rule when condition is met", async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    automation.addRule("too-hot", (r) => r.value > 30, action)
    await automation.evaluate(makeReading(35))
    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10))
    expect(action).toHaveBeenCalledOnce()
  })

  it("does not trigger rule when condition is not met", async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    automation.addRule("too-hot", (r) => r.value > 30, action)
    await automation.evaluate(makeReading(20))
    await new Promise((r) => setTimeout(r, 10))
    expect(action).not.toHaveBeenCalled()
  })

  it("removeRule prevents future triggers", async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    automation.addRule("r1", () => true, action)
    automation.removeRule("r1")
    await automation.evaluate(makeReading(99))
    await new Promise((r) => setTimeout(r, 10))
    expect(action).not.toHaveBeenCalled()
  })

  it("does not throw when condition throws", async () => {
    automation.addRule(
      "bad-rule",
      () => { throw new Error("condition error") },
      vi.fn().mockResolvedValue(undefined),
    )
    await expect(automation.evaluate(makeReading(1))).resolves.toBeUndefined()
  })
})
