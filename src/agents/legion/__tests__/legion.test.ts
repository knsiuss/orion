/**
 * @file legion.test.ts
 * @description Tests for Phase 26 Iron Legion modules.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { InstanceAuth } from "../instance-auth.js"
import { TaskRouter } from "../task-router.js"
import { CRDTStore } from "../crdt-store.js"
import { TeamMode } from "../team-mode.js"
import type { SharedKnowledgeEntry, TeamMember } from "../types.js"

// ---------------------------------------------------------------------------
// InstanceAuth
// ---------------------------------------------------------------------------
describe("InstanceAuth", () => {
  let auth: InstanceAuth

  beforeEach(() => {
    auth = new InstanceAuth()
  })

  it("generateToken and verifyToken round-trips correctly", () => {
    const token = auth.generateToken("instance-1", "research")
    const result = auth.verifyToken(token)
    expect(result).not.toBeNull()
    expect(result?.instanceId).toBe("instance-1")
    expect(result?.role).toBe("research")
  })

  it("verifyToken returns null for invalid token", () => {
    expect(auth.verifyToken("invalid.token")).toBeNull()
    expect(auth.verifyToken("not-a-token")).toBeNull()
    expect(auth.verifyToken("")).toBeNull()
  })

  it("verifyToken returns null for tampered token", () => {
    const token = auth.generateToken("instance-2", "code")
    const tampered = token.replace(/.$/, "x")
    expect(auth.verifyToken(tampered)).toBeNull()
  })

  it("sign produces consistent HMAC for same payload", () => {
    const payload = { a: 1, b: "test" }
    const s1 = auth.sign(payload)
    const s2 = auth.sign(payload)
    expect(s1).toBe(s2)
  })
})

// ---------------------------------------------------------------------------
// TaskRouter
// ---------------------------------------------------------------------------
describe("TaskRouter", () => {
  let router: TaskRouter

  beforeEach(() => {
    router = new TaskRouter()
  })

  it("classifies research messages", () => {
    expect(router.classify("research the best Python frameworks")).toBe("research")
    expect(router.classify("find information about machine learning")).toBe("research")
  })

  it("classifies code messages", () => {
    expect(router.classify("fix the bug in the login function")).toBe("code")
    expect(router.classify("implement a new feature for the API")).toBe("code")
  })

  it("classifies communication messages", () => {
    expect(router.classify("send an email to the team about the meeting")).toBe("communication")
    expect(router.classify("schedule a calendar meeting for next week")).toBe("communication")
  })

  it("classifies general messages", () => {
    expect(router.classify("hello")).toBe("general")
    expect(router.classify("what time is it")).toBe("general")
  })

  it("shouldDelegate returns true for domain-specific messages", () => {
    expect(router.shouldDelegate("research the history of the Roman Empire and summarize")).toBe(true)
    expect(router.shouldDelegate("fix the critical bug in the authentication module")).toBe(true)
  })

  it("shouldDelegate returns false for simple messages", () => {
    expect(router.shouldDelegate("hi")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CRDTStore
// ---------------------------------------------------------------------------
describe("CRDTStore", () => {
  let store: CRDTStore

  beforeEach(() => {
    store = new CRDTStore("node-a")
  })

  it("set and get basic value", () => {
    store.set("key1", "value1", "node-a")
    expect(store.get("key1")).toBe("value1")
  })

  it("merge takes remote value when remote is newer", () => {
    store.set("key1", "local-value", "node-a")
    const remote = {
      key1: { value: "remote-value", ts: Date.now() + 1000, nodeId: "node-b" },
    }
    store.merge(remote)
    expect(store.get("key1")).toBe("remote-value")
  })

  it("merge keeps local value when local is newer", () => {
    store.set("key1", "local-value", "node-a")
    const localTs = store.export().key1!.ts
    const remote = {
      key1: { value: "remote-old", ts: localTs - 1000, nodeId: "node-b" },
    }
    store.merge(remote)
    expect(store.get("key1")).toBe("local-value")
  })

  it("export returns all stored entries", () => {
    store.set("a", 1, "node-a")
    store.set("b", 2, "node-a")
    const exported = store.export()
    expect(exported.a?.value).toBe(1)
    expect(exported.b?.value).toBe(2)
  })

  it("merge with new remote keys adds them", () => {
    const remote = {
      new_key: { value: "new-value", ts: Date.now(), nodeId: "node-b" },
    }
    store.merge(remote)
    expect(store.get("new_key")).toBe("new-value")
  })
})

// ---------------------------------------------------------------------------
// TeamMode
// ---------------------------------------------------------------------------
describe("TeamMode", () => {
  let team: TeamMode

  const makeEntry = (access: string[] = []): SharedKnowledgeEntry => ({
    id: "entry-1",
    topic: "test",
    content: "content",
    publishedBy: "admin-user",
    access,
    createdAt: new Date().toISOString(),
  })

  const makeMember = (userId: string, role: TeamMember["role"]): TeamMember => ({
    userId,
    role,
    name: `User ${userId}`,
  })

  beforeEach(() => {
    team = new TeamMode()
  })

  it("addMember and getMember", () => {
    team.addMember(makeMember("user1", "member"))
    expect(team.getMember("user1")).toBeDefined()
    expect(team.getMember("user1")?.role).toBe("member")
  })

  it("removeMember removes the member", () => {
    team.addMember(makeMember("user2", "member"))
    team.removeMember("user2")
    expect(team.getMember("user2")).toBeUndefined()
  })

  it("canAccess: admin can access everything", () => {
    team.addMember(makeMember("admin1", "admin"))
    expect(team.canAccess("admin1", makeEntry(["other-user"]))).toBe(true)
  })

  it("canAccess: member can read public entries", () => {
    team.addMember(makeMember("member1", "member"))
    expect(team.canAccess("member1", makeEntry([]))).toBe(true)
  })

  it("canAccess: guest can read public entries", () => {
    team.addMember(makeMember("guest1", "guest"))
    expect(team.canAccess("guest1", makeEntry([]))).toBe(true)
  })

  it("canAccess: guest cannot access restricted entries", () => {
    team.addMember(makeMember("guest1", "guest"))
    expect(team.canAccess("guest1", makeEntry(["admin-user"]))).toBe(false)
  })

  it("canAccess: member in access list can access", () => {
    team.addMember(makeMember("member1", "member"))
    expect(team.canAccess("member1", makeEntry(["member1", "other"]))).toBe(true)
  })

  it("isEnabled returns true when members registered", () => {
    team.addMember(makeMember("u1", "member"))
    expect(team.isEnabled()).toBe(true)
  })

  it("isEnabled returns false when no members", () => {
    expect(team.isEnabled()).toBe(false)
  })
})
