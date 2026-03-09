/**
 * @file event-bus.test.ts
 * @description Unit tests for EDITHEventBus — typed emit/on/dispatch,
 * async error handling, and listener chaining.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import { eventBus } from "../event-bus.js"

describe("eventBus", () => {
  afterEach(() => {
    // Clean up all listeners after each test to avoid cross-test contamination
    eventBus.removeAllListeners()
  })

  it("dispatches events and calls listeners", () => {
    const listener = vi.fn()
    eventBus.on("system.heartbeat", listener)
    eventBus.dispatch("system.heartbeat", { timestamp: 12345 })
    expect(listener).toHaveBeenCalledWith({ type: "system.heartbeat", timestamp: 12345 })
  })

  it("calls multiple listeners for the same event", () => {
    const l1 = vi.fn()
    const l2 = vi.fn()
    eventBus.on("channel.connected", l1)
    eventBus.on("channel.connected", l2)
    eventBus.dispatch("channel.connected", { channelName: "telegram" })
    expect(l1).toHaveBeenCalledTimes(1)
    expect(l2).toHaveBeenCalledTimes(1)
  })

  it("does not call listener for a different event type", () => {
    const listener = vi.fn()
    eventBus.on("channel.connected", listener)
    eventBus.dispatch("system.heartbeat", { timestamp: 1 })
    expect(listener).not.toHaveBeenCalled()
  })

  it("handles sync listener errors without crashing the bus", () => {
    eventBus.on("system.heartbeat", () => {
      throw new Error("sync crash")
    })
    expect(() => {
      eventBus.dispatch("system.heartbeat", { timestamp: 1 })
    }).not.toThrow()
  })

  it("handles async listener errors without crashing", async () => {
    eventBus.on("system.heartbeat", async () => {
      throw new Error("async crash")
    })
    // Should not throw synchronously
    expect(() => {
      eventBus.dispatch("system.heartbeat", { timestamp: 1 })
    }).not.toThrow()
    // Give the microtask queue time to settle
    await new Promise((r) => setTimeout(r, 10))
  })

  it("attaches type field to dispatched event", () => {
    const listener = vi.fn()
    eventBus.on("memory.consolidate.requested", listener)
    eventBus.dispatch("memory.consolidate.requested", { userId: "u1" })
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "memory.consolidate.requested", userId: "u1" })
    )
  })

  it("dispatch with memory.save.requested payload", () => {
    const listener = vi.fn()
    eventBus.on("memory.save.requested", listener)
    eventBus.dispatch("memory.save.requested", {
      userId: "u1",
      content: "Remember this",
      metadata: { source: "test" },
    })
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", content: "Remember this" })
    )
  })

  it("supports removeAllListeners to clean up", () => {
    const listener = vi.fn()
    eventBus.on("system.heartbeat", listener)
    eventBus.removeAllListeners("system.heartbeat")
    eventBus.dispatch("system.heartbeat", { timestamp: 1 })
    expect(listener).not.toHaveBeenCalled()
  })
})
