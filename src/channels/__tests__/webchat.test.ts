/**
 * @file webchat.test.ts
 * @description Tests for WebChatChannel: message queue, send, isConnected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../config.js", () => ({
  default: { WEBCHAT_PORT: 0 },
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../../markdown/processor.js", () => ({
  markdownProcessor: {
    process: (text: string) => text,
  },
}))

// Mock fastify to avoid real HTTP server
vi.mock("fastify", () => ({
  default: () => ({
    register: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("@fastify/websocket", () => ({ default: vi.fn() }))
vi.mock("@fastify/static", () => ({ default: vi.fn() }))

describe("WebChatChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts and reports connected", async () => {
    const { WebChatChannel } = await import("../webchat.js")
    const channel = new WebChatChannel("127.0.0.1", 0)
    await channel.start()

    expect(channel.isConnected()).toBe(true)
  })

  it("queues messages when no WebSocket connection", async () => {
    const { WebChatChannel } = await import("../webchat.js")
    const channel = new WebChatChannel("127.0.0.1", 0)
    await channel.start()

    const sent = await channel.send("user1", "hello world")
    expect(sent).toBe(true)
  })

  it("stops and reports disconnected", async () => {
    const { WebChatChannel } = await import("../webchat.js")
    const channel = new WebChatChannel("127.0.0.1", 0)
    await channel.start()
    await channel.stop()

    expect(channel.isConnected()).toBe(false)
  })

  it("getLatestReply returns null when queue is empty", async () => {
    const { WebChatChannel } = await import("../webchat.js")
    const channel = new WebChatChannel("127.0.0.1", 0)
    await channel.start()

    const reply = await channel.getLatestReply("user1")
    expect(reply).toBeNull()
  })
})
