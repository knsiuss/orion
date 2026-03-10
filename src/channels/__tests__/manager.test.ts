import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BaseChannel } from "../base.js"

// Mock all channel imports to avoid real network calls
vi.mock("../webchat.js", () => ({
  WebChatChannel: class {
    name = "webchat"
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn().mockResolvedValue(undefined)
    send = vi.fn().mockResolvedValue(false)
    sendWithConfirm = vi.fn().mockResolvedValue(false)
    isConnected = vi.fn().mockReturnValue(false)
  },
}))
vi.mock("../whatsapp.js", () => ({ whatsAppChannel: mockChannel("whatsapp") }))
vi.mock("../telegram.js", () => ({ telegramChannel: mockChannel("telegram") }))
vi.mock("../discord.js", () => ({ discordChannel: mockChannel("discord") }))
vi.mock("../signal.js", () => ({ signalChannel: mockChannel("signal") }))
vi.mock("../line.js", () => ({ lineChannel: mockChannel("line") }))
vi.mock("../matrix.js", () => ({ matrixChannel: mockChannel("matrix") }))
vi.mock("../teams.js", () => ({ teamsChannel: mockChannel("teams") }))
vi.mock("../imessage.js", () => ({ iMessageChannel: mockChannel("imessage") }))
vi.mock("../email.js", () => ({ emailChannel: mockChannel("email") }))
vi.mock("../sms.js", () => ({ smsChannel: mockChannel("sms") }))
vi.mock("../phone.js", () => ({ phoneChannel: mockChannel("phone") }))

vi.mock("../../config.js", () => ({
  default: { DEFAULT_USER_ID: "test-owner" },
}))

vi.mock("../../logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock("../../permissions/sandbox.js", () => ({
  sandbox: { setChannelManager: vi.fn() },
}))

vi.mock("../../security/output-scanner.js", () => ({
  outputScanner: {
    scan: vi.fn().mockReturnValue({ safe: true, sanitized: "test message", issues: [] }),
  },
}))

function mockChannel(channelName: string, connected = false): BaseChannel {
  return {
    name: channelName,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(connected),
    sendWithConfirm: vi.fn().mockResolvedValue(false),
    isConnected: vi.fn().mockReturnValue(connected),
  }
}

import { ChannelManager } from "../manager.js"

describe("ChannelManager", () => {
  let manager: ChannelManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ChannelManager()
  })

  it("initializes without errors", async () => {
    await manager.init()
    // Should not throw
  })

  it("reports no connected channels when all are disconnected", async () => {
    await manager.init()
    expect(manager.getConnectedChannels()).toEqual([])
  })

  it("healthCheck returns status for all registered channels", async () => {
    await manager.init()
    const health = manager.healthCheck()

    expect(health.length).toBeGreaterThan(0)
    expect(health[0]).toHaveProperty("name")
    expect(health[0]).toHaveProperty("connected")
  })

  it("getChannel returns undefined for unknown channel", async () => {
    await manager.init()
    expect(manager.getChannel("nonexistent")).toBeUndefined()
  })

  it("getChannel returns a registered channel", async () => {
    await manager.init()
    const tg = manager.getChannel("telegram")
    expect(tg).toBeDefined()
    expect(tg?.name).toBe("telegram")
  })

  it("stop clears all channels", async () => {
    await manager.init()
    await manager.stop()
    expect(manager.getConnectedChannels()).toEqual([])
  })
})
