/**
 * @file user-channel-prefs.test.ts
 * @description Unit tests for UserChannelPrefs and mergeChannelOrder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted — use vi.hoisted() so variables are available in the factory.
const { mockFindUnique, mockUpsert } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
}))

// The service accesses userChannelPreference via dynamic key (pre-generate shim).
// We mirror that in the mock so the runtime lookup succeeds.
vi.mock("../../database/index.js", () => ({
  prisma: {
    userChannelPreference: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}))

import { mergeChannelOrder, UserChannelPrefs } from "../user-channel-prefs.js"

const GLOBAL_ORDER = ["telegram", "discord", "whatsapp", "sms", "email"]

describe("mergeChannelOrder", () => {
  it("returns globalOrder unchanged when userOrder is empty", () => {
    expect(mergeChannelOrder([], GLOBAL_ORDER)).toEqual(GLOBAL_ORDER)
  })

  it("moves user-preferred channels to the front", () => {
    const result = mergeChannelOrder(["whatsapp", "discord"], GLOBAL_ORDER)
    expect(result[0]).toBe("whatsapp")
    expect(result[1]).toBe("discord")
  })

  it("includes all channels from globalOrder exactly once", () => {
    const result = mergeChannelOrder(["whatsapp"], GLOBAL_ORDER)
    expect(result).toHaveLength(GLOBAL_ORDER.length)
    expect(new Set(result).size).toBe(GLOBAL_ORDER.length)
  })

  it("ignores userOrder channels not in globalOrder", () => {
    const result = mergeChannelOrder(["signal"], GLOBAL_ORDER)
    // "signal" is not in GLOBAL_ORDER — should not appear in result
    expect(result).not.toContain("signal")
    expect(result).toHaveLength(GLOBAL_ORDER.length)
  })

  it("preserves global fallback order for unlisted channels", () => {
    const result = mergeChannelOrder(["email"], GLOBAL_ORDER)
    // email moves first; the rest stay in original global order
    expect(result[0]).toBe("email")
    expect(result.slice(1)).toEqual(["telegram", "discord", "whatsapp", "sms"])
  })
})

describe("UserChannelPrefs", () => {
  let prefs: UserChannelPrefs

  beforeEach(() => {
    prefs = new UserChannelPrefs()
    vi.clearAllMocks()
  })

  it("returns empty array when no preference is stored", async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const order = await prefs.getChannelOrder("u1")
    expect(order).toEqual([])
  })

  it("returns stored preference from DB", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "u1",
      channelOrder: ["whatsapp", "telegram"],
      updatedAt: new Date(),
    })
    const order = await prefs.getChannelOrder("u1")
    expect(order).toEqual(["whatsapp", "telegram"])
  })

  it("caches DB result on second call (no second DB hit)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "u1",
      channelOrder: ["discord"],
      updatedAt: new Date(),
    })
    await prefs.getChannelOrder("u1")
    await prefs.getChannelOrder("u1") // should hit cache
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
  })

  it("promoteChannel moves channel to front", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "u2",
      channelOrder: ["telegram", "discord"],
      updatedAt: new Date(),
    })
    mockUpsert.mockResolvedValue({
      userId: "u2",
      channelOrder: ["discord", "telegram"],
      updatedAt: new Date(),
    })
    await prefs.promoteChannel("u2", "discord")
    const order = await prefs.getChannelOrder("u2")
    expect(order[0]).toBe("discord")
  })

  it("promoteChannel is no-op when channel is already first", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "u3",
      channelOrder: ["whatsapp", "telegram"],
      updatedAt: new Date(),
    })
    await prefs.promoteChannel("u3", "whatsapp") // already first
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
