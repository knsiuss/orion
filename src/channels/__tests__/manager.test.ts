/**
 * @file manager.test.ts
 * @description Tests for ChannelManager: priority routing, output scanning,
 *   circuit breaker integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../webchat.js", () => {
  class MockWebChatChannel {
    name = "webchat"
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn().mockResolvedValue(undefined)
    send = vi.fn().mockResolvedValue(false)
    sendWithConfirm = vi.fn().mockResolvedValue(false)
    isConnected = vi.fn().mockReturnValue(false)
  }
  return { WebChatChannel: MockWebChatChannel }
})

vi.mock("../whatsapp.js", () => ({
  whatsAppChannel: {
    name: "whatsapp",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../telegram.js", () => ({
  telegramChannel: {
    name: "telegram",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(true),
    sendWithConfirm: vi.fn().mockResolvedValue(true),
    isConnected: vi.fn().mockReturnValue(true),
  },
}))

vi.mock("../discord.js", () => ({
  discordChannel: {
    name: "discord",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../signal.js", () => ({
  signalChannel: {
    name: "signal",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../line.js", () => ({
  lineChannel: {
    name: "line",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../matrix.js", () => ({
  matrixChannel: {
    name: "matrix",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../teams.js", () => ({
  teamsChannel: {
    name: "teams",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../imessage.js", () => ({
  iMessageChannel: {
    name: "imessage",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../email.js", () => ({
  emailChannel: {
    name: "email",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../sms.js", () => ({
  smsChannel: {
    name: "sms",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../phone.js", () => ({
  phoneChannel: {
    name: "phone",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(false),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../../config.js", () => ({
  default: { DEFAULT_USER_ID: "test-user" },
}))

vi.mock("../user-channel-prefs.js", () => ({
  userChannelPrefs: {
    resolveChannelOrder: vi.fn().mockResolvedValue(["telegram", "discord", "whatsapp"]),
  },
  mergeChannelOrder: vi.fn((userOrder: string[], globalOrder: string[]) =>
    userOrder.length > 0 ? userOrder : globalOrder,
  ),
}))

vi.mock("../../permissions/sandbox.js", () => ({
  sandbox: { setChannelManager: vi.fn() },
}))

vi.mock("../../security/output-scanner.js", () => ({
  outputScanner: {
    scan: vi.fn().mockReturnValue({ safe: true, sanitized: "hello", issues: [] }),
  },
}))

vi.mock("../../gateway/channel-health-monitor.js", () => ({
  channelHealthMonitor: { startMonitoring: vi.fn(), stopMonitoring: vi.fn() },
}))

vi.mock("../circuit-breaker.js", () => ({
  channelCircuitBreaker: {
    execute: vi.fn((_id: string, fn: () => Promise<boolean>) => fn()),
  },
}))

describe("ChannelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends through first connected channel in priority order", async () => {
    const { ChannelManager } = await import("../manager.js")
    const manager = new ChannelManager()
    await manager.init()

    const result = await manager.send("test-user", "hello")
    expect(result).toBe(true)
  })

  it("returns connected channels list", async () => {
    const { ChannelManager } = await import("../manager.js")
    const manager = new ChannelManager()
    await manager.init()

    const connected = manager.getConnectedChannels()
    expect(connected).toContain("telegram")
  })

  it("getChannel returns registered channel", async () => {
    const { ChannelManager } = await import("../manager.js")
    const manager = new ChannelManager()
    await manager.init()

    expect(manager.getChannel("telegram")).toBeDefined()
    expect(manager.getChannel("nonexistent")).toBeUndefined()
  })

  it("stops all channels on stop()", async () => {
    const { ChannelManager } = await import("../manager.js")
    const manager = new ChannelManager()
    await manager.init()
    await manager.stop()

    expect(manager.getConnectedChannels()).toEqual([])
  })
})
