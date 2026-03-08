/**
 * @file channel-health-monitor.test.ts
 * @description Tests for ChannelHealthMonitor — periodic heartbeat probes,
 *   uptime tracking, and state cleanup.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests the ChannelHealthMonitor class from src/gateway/channel-health-monitor.ts
 *   using mock BaseChannel implementations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { ChannelHealthMonitor } from "../channel-health-monitor.js"
import type { BaseChannel } from "../../channels/base.js"

/** Creates a mock BaseChannel with configurable connection state. */
function mockChannel(connected = true): BaseChannel {
  return {
    name: "test-channel",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(true),
    sendWithConfirm: vi.fn().mockResolvedValue(true),
    isConnected: vi.fn().mockReturnValue(connected),
  }
}

describe("ChannelHealthMonitor", () => {
  let monitor: ChannelHealthMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    monitor = new ChannelHealthMonitor()
  })

  afterEach(() => {
    monitor.stopMonitoring()
    vi.useRealTimers()
  })

  it("returns empty array when no channels are monitored", () => {
    const health = monitor.getHealth()
    expect(health).toEqual([])
  })

  it("returns health for registered channels", () => {
    const channels = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
      ["discord", mockChannel(false)],
    ])
    monitor.startMonitoring(channels)

    const health = monitor.getHealth()
    expect(health).toHaveLength(2)

    const ids = health.map((h) => h.channelId).sort()
    expect(ids).toEqual(["discord", "telegram"])
  })

  it("returns null for unknown channelId", () => {
    const channels = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
    ])
    monitor.startMonitoring(channels)

    const result = monitor.getHealth("nonexistent")
    expect(result).toBeNull()
  })

  it("tracks connected=true for a connected channel", () => {
    const channels = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
    ])
    monitor.startMonitoring(channels)

    const health = monitor.getHealth("telegram")
    expect(health).not.toBeNull()
    expect(health!.connected).toBe(true)
    expect(health!.channelId).toBe("telegram")
    expect(health!.downSince).toBeNull()
    expect(health!.errorCount).toBe(0)
    expect(health!.consecutiveFailures).toBe(0)
  })

  it("tracks connected=false for a disconnected channel", () => {
    const channels = new Map<string, BaseChannel>([
      ["discord", mockChannel(false)],
    ])
    monitor.startMonitoring(channels)

    const health = monitor.getHealth("discord")
    expect(health).not.toBeNull()
    expect(health!.connected).toBe(false)
    expect(health!.downSince).toBeTypeOf("number")
    expect(health!.uptimeMs).toBe(0)
  })

  it("reports uptimeMs based on connectedSince", () => {
    const channels = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
    ])
    monitor.startMonitoring(channels)

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10_000)

    const health = monitor.getHealth("telegram")
    expect(health).not.toBeNull()
    // uptimeMs should be approximately 10_000 (Date.now() - connectedSince)
    expect(health!.uptimeMs).toBeGreaterThanOrEqual(10_000)
  })

  it("cleans up on stopMonitoring", () => {
    const channels = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
      ["discord", mockChannel(true)],
    ])
    monitor.startMonitoring(channels)
    expect(monitor.getHealth()).toHaveLength(2)

    monitor.stopMonitoring()
    expect(monitor.getHealth()).toEqual([])
  })

  it("restarts monitoring when called again (clears previous state)", () => {
    const channels1 = new Map<string, BaseChannel>([
      ["telegram", mockChannel(true)],
    ])
    monitor.startMonitoring(channels1)
    expect(monitor.getHealth()).toHaveLength(1)

    const channels2 = new Map<string, BaseChannel>([
      ["discord", mockChannel(true)],
      ["email", mockChannel(false)],
    ])
    monitor.startMonitoring(channels2)
    expect(monitor.getHealth()).toHaveLength(2)
    expect(monitor.getHealth("telegram")).toBeNull()
  })
})
