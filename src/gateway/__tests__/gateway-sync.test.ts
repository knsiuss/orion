/**
 * @file gateway-sync.test.ts
 * @description Tests for Phase 27 gateway sync modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { GatewaySync } from "../gateway-sync.js"
import { SyncTransport } from "../sync-transport.js"
import { NetworkDiscovery } from "../network-discovery.js"

// ---------------------------------------------------------------------------
// GatewaySync
// ---------------------------------------------------------------------------
describe("GatewaySync", () => {
  let gatewaySync: GatewaySync

  beforeEach(() => {
    gatewaySync = new GatewaySync()
  })

  it("registerPeer and push calls syncTransport.send", async () => {
    // Mock global fetch to simulate successful HTTP sync
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal("fetch", mockFetch)

    gatewaySync.registerPeer("peer-1", "http://peer1:18789")
    await gatewaySync.push({ type: "test", data: "hello" })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("peer1:18789"),
      expect.objectContaining({ method: "POST" }),
    )

    vi.unstubAllGlobals()
  })

  it("unregisterPeer removes peer from routing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal("fetch", mockFetch)

    gatewaySync.registerPeer("peer-2", "http://peer2:18789")
    gatewaySync.unregisterPeer("peer-2")
    await gatewaySync.push({ type: "test" })

    expect(mockFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("receive does not throw for unknown delta types", async () => {
    await expect(gatewaySync.receive({ type: "unknown" })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SyncTransport
// ---------------------------------------------------------------------------
describe("SyncTransport", () => {
  let transport: SyncTransport

  beforeEach(() => {
    transport = new SyncTransport()
  })

  it("send returns true on HTTP 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal("fetch", mockFetch)

    const result = await transport.send("http://peer:18789", { data: "test" })
    expect(result).toBe(true)

    vi.unstubAllGlobals()
  })

  it("send returns false on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    vi.stubGlobal("fetch", mockFetch)

    const result = await transport.send("http://peer:18789", { data: "test" })
    expect(result).toBe(false)

    vi.unstubAllGlobals()
  })

  it("send returns false when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"))
    vi.stubGlobal("fetch", mockFetch)

    const result = await transport.send("http://peer:18789", { data: "test" })
    expect(result).toBe(false)

    vi.unstubAllGlobals()
  })

  it("getBestTransport returns http when no WS connection", () => {
    expect(transport.getBestTransport("http://peer:18789")).toBe("http")
  })
})

// ---------------------------------------------------------------------------
// NetworkDiscovery
// ---------------------------------------------------------------------------
describe("NetworkDiscovery", () => {
  let discovery: NetworkDiscovery

  beforeEach(() => {
    discovery = new NetworkDiscovery()
  })

  it("advertise does not throw when bonjour is not installed", () => {
    expect(() => discovery.advertise(18789)).not.toThrow()
  })

  it("discover returns empty array when bonjour is not installed", async () => {
    const result = await discovery.discover()
    expect(Array.isArray(result)).toBe(true)
  })

  it("stop does not throw when nothing is running", () => {
    expect(() => discovery.stop()).not.toThrow()
  })
})
