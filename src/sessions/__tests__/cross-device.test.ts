/**
 * @file cross-device.test.ts
 * @description Tests for Phase 27 cross-device mesh session modules.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { PresenceManager } from "../presence-manager.js"
import { ConversationSync } from "../conversation-sync.js"
import { QRGenerator } from "../../pairing/qr-generator.js"
import type { SyncedMessage } from "../conversation-sync.js"

// ---------------------------------------------------------------------------
// PresenceManager
// ---------------------------------------------------------------------------
describe("PresenceManager", () => {
  let presence: PresenceManager

  beforeEach(() => {
    presence = new PresenceManager()
  })

  it("heartbeat marks device as active", () => {
    presence.heartbeat("device-1", true, 100)
    expect(presence.getPresence("device-1").state).toBe("active")
  })

  it("heartbeat with long lastInputMs marks device as idle", () => {
    presence.heartbeat("device-2", true, 10 * 60 * 1000) // 10 minutes
    expect(presence.getPresence("device-2").state).toBe("idle")
  })

  it("heartbeat with isActive=false marks device as background", () => {
    presence.heartbeat("device-3", false)
    expect(presence.getPresence("device-3").state).toBe("background")
  })

  it("getPresence returns offline for unknown device", () => {
    expect(presence.getPresence("unknown-device").state).toBe("offline")
  })

  it("setDND sets dnd state", () => {
    presence.heartbeat("device-4", true)
    presence.setDND("device-4", Date.now() + 60_000)
    expect(presence.getPresence("device-4").state).toBe("dnd")
  })

  it("DND heartbeat is ignored while active", () => {
    presence.setDND("device-5", Date.now() + 60_000)
    presence.heartbeat("device-5", true)
    expect(presence.getPresence("device-5").state).toBe("dnd")
  })
})

// ---------------------------------------------------------------------------
// ConversationSync
// ---------------------------------------------------------------------------
describe("ConversationSync", () => {
  let sync: ConversationSync

  const makeMsg = (id: string, content: string, ts: number = Date.now()): SyncedMessage => ({
    id,
    role: "user",
    content,
    timestamp: ts,
    deviceId: "device-1",
  })

  beforeEach(() => {
    sync = new ConversationSync()
  })

  it("addMessage and getMessages round-trips", () => {
    sync.addMessage("user1", makeMsg("m1", "hello"))
    const msgs = sync.getMessages("user1")
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.content).toBe("hello")
  })

  it("addMessage is idempotent for duplicate IDs", () => {
    sync.addMessage("user1", makeMsg("m1", "hello"))
    sync.addMessage("user1", makeMsg("m1", "hello again"))
    expect(sync.getMessages("user1")).toHaveLength(1)
  })

  it("getMessages filters by since timestamp", () => {
    const past = Date.now() - 10_000
    sync.addMessage("user1", makeMsg("m1", "old", past))
    sync.addMessage("user1", makeMsg("m2", "new", Date.now()))
    const recent = sync.getMessages("user1", Date.now() - 5000)
    expect(recent).toHaveLength(1)
    expect(recent[0]?.content).toBe("new")
  })

  it("generateDelta includes messages after timestamp", () => {
    const t = Date.now() - 1000
    sync.addMessage("user1", makeMsg("m1", "before", t - 1000))
    sync.addMessage("user1", makeMsg("m2", "after", t + 1000))
    const delta = sync.generateDelta("user1", t)
    const typedDelta = delta as { messages: SyncedMessage[] }
    expect(typedDelta.messages).toHaveLength(1)
    expect(typedDelta.messages[0]?.content).toBe("after")
  })

  it("applyDelta merges remote messages", () => {
    const delta = {
      userId: "user1",
      messages: [makeMsg("m-remote", "from other device")],
      since: 0,
    }
    sync.applyDelta("user1", delta)
    const msgs = sync.getMessages("user1")
    expect(msgs.some((m) => m.id === "m-remote")).toBe(true)
  })

  it("applyDelta is idempotent", () => {
    const delta = {
      userId: "user1",
      messages: [makeMsg("m-dup", "duplicate")],
      since: 0,
    }
    sync.applyDelta("user1", delta)
    sync.applyDelta("user1", delta)
    expect(sync.getMessages("user1").filter((m) => m.id === "m-dup")).toHaveLength(1)
  })

  it("returns messages sorted by timestamp", () => {
    const now = Date.now()
    sync.addMessage("user1", makeMsg("m3", "third", now + 200))
    sync.addMessage("user1", makeMsg("m1", "first", now))
    sync.addMessage("user1", makeMsg("m2", "second", now + 100))
    const msgs = sync.getMessages("user1")
    expect(msgs[0]?.content).toBe("first")
    expect(msgs[2]?.content).toBe("third")
  })
})

// ---------------------------------------------------------------------------
// QRGenerator
// ---------------------------------------------------------------------------
describe("QRGenerator", () => {
  let generator: QRGenerator

  beforeEach(() => {
    generator = new QRGenerator()
  })

  it("generate creates a token and payload", () => {
    const result = generator.generate("user1", "http://localhost:18789")
    expect(result.token).toBeTruthy()
    expect(result.payload).toContain("user1")
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it("validate returns valid for fresh token", () => {
    const { token } = generator.generate("user1", "http://localhost:18789")
    const result = generator.validate(token)
    expect(result.valid).toBe(true)
    expect(result.userId).toBe("user1")
  })

  it("validate returns invalid for unknown token", () => {
    const result = generator.validate("not-a-real-token")
    expect(result.valid).toBe(false)
  })

  it("validate is one-time — second call fails", () => {
    const { token } = generator.generate("user1", "http://localhost:18789")
    generator.validate(token) // consumes
    const second = generator.validate(token)
    expect(second.valid).toBe(false)
  })
})
