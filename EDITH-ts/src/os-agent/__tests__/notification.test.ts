import { describe, expect, it, vi } from "vitest"

import type { RuntimeProactiveConfig } from "../../background/runtime-config.js"
import { NotificationDispatcher } from "../notification.js"

function buildProactiveConfig(overrides: Partial<RuntimeProactiveConfig> = {}): RuntimeProactiveConfig {
  return {
    enabled: true,
    quietHours: { start: "22:00", end: "07:00" },
    channels: {
      desktop: true,
      mobile: true,
      voice: false,
      ...overrides.channels,
    },
    fileWatcher: {
      enabled: false,
      paths: [],
      debounceMs: 500,
      summaryWindowMs: 300_000,
      ...overrides.fileWatcher,
    },
    schedulerIntervalMs: 10_000,
    maxWatchedPaths: 5,
    ...overrides,
  }
}

describe("NotificationDispatcher", () => {
  it("routes medium-priority notifications through desktop and mobile", async () => {
    const notifyDesktop = vi.fn().mockResolvedValue(undefined)
    const sendChannelMessage = vi.fn().mockResolvedValue(true)
    const dispatchEvent = vi.fn()
    const dispatcher = new NotificationDispatcher(buildProactiveConfig(), {
      notifyDesktop,
      sendChannelMessage,
      dispatchEvent: dispatchEvent as never,
      now: () => new Date(2026, 2, 5, 12, 0, 0),
    })

    const result = await dispatcher.dispatch({
      userId: "owner",
      title: "EDITH",
      message: "Stand up and stretch.",
      priority: "medium",
      source: "heartbeat",
    })

    expect(result.ok).toBe(true)
    expect(result.requestedChannels).toEqual(["desktop", "mobile"])
    expect(result.deliveredChannels).toEqual(["desktop", "mobile"])
    expect(notifyDesktop).toHaveBeenCalledOnce()
    expect(sendChannelMessage).toHaveBeenCalledOnce()
    expect(dispatchEvent).toHaveBeenCalledWith("notification.dispatched", expect.objectContaining({
      userId: "owner",
      priority: "medium",
    }))
  })

  it("suppresses non-urgent notifications during quiet hours", async () => {
    const dispatcher = new NotificationDispatcher(buildProactiveConfig(), {
      notifyDesktop: vi.fn(),
      sendChannelMessage: vi.fn(),
      dispatchEvent: vi.fn() as never,
      now: () => new Date(2026, 2, 5, 23, 15, 0),
    })

    const result = await dispatcher.dispatch({
      userId: "owner",
      title: "EDITH",
      message: "Regular reminder",
      priority: "low",
      source: "trigger",
    })

    expect(result.ok).toBe(false)
    expect(result.suppressedReason).toBe("quiet-hours")
  })

  it("honors cooldown keys for repeated notifications", async () => {
    const dispatcher = new NotificationDispatcher(buildProactiveConfig(), {
      notifyDesktop: vi.fn().mockResolvedValue(undefined),
      sendChannelMessage: vi.fn().mockResolvedValue(false),
      dispatchEvent: vi.fn() as never,
      now: (() => {
        let now = new Date(2026, 2, 5, 12, 0, 0).getTime()
        return () => new Date(now += 500)
      })(),
    })

    const first = await dispatcher.dispatch({
      userId: "owner",
      title: "EDITH",
      message: "CPU still high",
      priority: "medium",
      source: "system",
      cooldownKey: "cpu-high",
      cooldownMs: 2_000,
    })
    const second = await dispatcher.dispatch({
      userId: "owner",
      title: "EDITH",
      message: "CPU still high",
      priority: "medium",
      source: "system",
      cooldownKey: "cpu-high",
      cooldownMs: 2_000,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.suppressedReason).toBe("cooldown")
  })
})
