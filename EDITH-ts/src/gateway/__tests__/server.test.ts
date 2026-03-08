import crypto from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getConfigBootstrapStateMock } = vi.hoisted(() => ({
  getConfigBootstrapStateMock: vi.fn(),
}))

vi.mock("../../config/edith-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/edith-config.js")>()
  return {
    ...actual,
    getConfigBootstrapState: getConfigBootstrapStateMock,
    resolveConfiguredWorkspaceDir: () => "C:/tmp/workbenches/testing",
  }
})

import { __gatewayTestUtils, GatewayServer } from "../server.js"

describe("gateway/server helpers", () => {
  beforeEach(() => {
    getConfigBootstrapStateMock.mockReset()
    getConfigBootstrapStateMock.mockResolvedValue({
      hasConfigFile: false,
      hasSecretState: false,
      reasons: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parseDaysParam clamps invalid and out-of-range values safely", () => {
    expect(__gatewayTestUtils.parseDaysParam(undefined)).toBe(7)
    expect(__gatewayTestUtils.parseDaysParam("abc")).toBe(7)
    expect(__gatewayTestUtils.parseDaysParam("0")).toBe(1)
    expect(__gatewayTestUtils.parseDaysParam("999")).toBe(30)
    expect(__gatewayTestUtils.parseDaysParam("14")).toBe(14)
  })

  it("does not authorize global admin endpoint when ADMIN_TOKEN is unset", () => {
    expect(__gatewayTestUtils.isAdminTokenAuthorized(undefined, undefined)).toBe(false)
    expect(__gatewayTestUtils.isAdminTokenAuthorized("x", undefined)).toBe(false)
  })

  it("uses timing-safe comparison for admin token checks via digest comparison", () => {
    const timingSpy = vi.spyOn(crypto, "timingSafeEqual")
    const hmacSpy = vi.spyOn(crypto, "createHmac")

    expect(__gatewayTestUtils.isAdminTokenAuthorized("secret", "secret")).toBe(true)
    expect(__gatewayTestUtils.isAdminTokenAuthorized("wrong", "secret")).toBe(false)

    expect(timingSpy).toHaveBeenCalled()
    expect(hmacSpy).toHaveBeenCalled()
  })

  it("allows unauthenticated config bootstrap only from loopback when admin token is unset and config is pristine", async () => {
    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed({ headers: {}, ip: "127.0.0.1" }, undefined),
    ).resolves.toBe(true)
    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed({ headers: {}, ip: "::1" }, undefined),
    ).resolves.toBe(true)
    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed({ headers: {}, ip: "10.0.0.42" }, undefined),
    ).resolves.toBe(false)
    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed(
        { headers: { authorization: "Bearer local-token" }, ip: "127.0.0.1" },
        undefined,
      ),
    ).resolves.toBe(false)
    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed({ headers: {}, ip: "127.0.0.1" }, "admin-secret"),
    ).resolves.toBe(false)
  })

  it("denies authless config bootstrap once persisted secret-bearing state exists", async () => {
    getConfigBootstrapStateMock.mockResolvedValue({
      hasConfigFile: true,
      hasSecretState: true,
      reasons: ["voice.stt.providers.deepgram.apiKey"],
    })

    await expect(
      __gatewayTestUtils.isConfigBootstrapAllowed({ headers: {}, ip: "127.0.0.1" }, undefined),
    ).resolves.toBe(false)
  })

  it("detects loopback address variants for config bootstrap checks", () => {
    expect(__gatewayTestUtils.isLoopbackAddress("127.0.0.1")).toBe(true)
    expect(__gatewayTestUtils.isLoopbackAddress("::1")).toBe(true)
    expect(__gatewayTestUtils.isLoopbackAddress("::ffff:127.0.0.1")).toBe(true)
    expect(__gatewayTestUtils.isLoopbackAddress("localhost")).toBe(true)
    expect(__gatewayTestUtils.isLoopbackAddress("192.168.1.20")).toBe(false)
  })

  it("normalizes client messages and rejects non-object payloads", () => {
    expect(() => __gatewayTestUtils.normalizeIncomingClientMessage("hello")).toThrow()

    const msg = __gatewayTestUtils.normalizeIncomingClientMessage({
      type: "voice_start",
      mimeType: "audio/webm",
      language: "id",
      channelCount: 2,
      sampleRate: 48_000,
      requestId: "r1",
    })

    expect(msg.type).toBe("voice_start")
    expect(msg.mimeType).toBe("audio/webm")
    expect(msg.language).toBe("id")
    expect(msg.channelCount).toBe(2)
    expect(msg.sampleRate).toBe(48_000)
  })

  it("redacts nested voice provider secrets", () => {
    const redacted = __gatewayTestUtils.redactSecrets({
      voice: {
        stt: {
          providers: {
            deepgram: {
              apiKey: "dg-secret",
            },
          },
        },
        wake: {
          providers: {
            picovoice: {
              accessKey: "pv-secret",
            },
          },
        },
      },
    }) as Record<string, {
      stt: { providers: { deepgram: { apiKey: string } } }
      wake: { providers: { picovoice: { accessKey: string } } }
    }>

    expect(redacted.voice.stt.providers.deepgram.apiKey).toBe("***")
    expect(redacted.voice.wake.providers.picovoice.accessKey).toBe("***")
  })

  it("exports CSP header policy", () => {
    expect(__gatewayTestUtils.CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
  })

  it("serves a gateway landing page at GET /", async () => {
    const server = new GatewayServer(0)

    try {
      const response = await (server as unknown as {
        app: { inject: (options: { method: string; url: string; headers?: Record<string, string> }) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }> }
      }).app.inject({
        method: "GET",
        url: "/",
        headers: { accept: "text/html" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers["content-type"]).toContain("text/html")
      expect(response.body).toContain("EDITH Control")
      expect(response.body).toContain("System State")
      expect(response.body).toContain("Command Deck")
      expect(response.body).toContain("Action Center")
      expect(response.body).toContain("Copy setup")
    } finally {
      await server.stop().catch(() => {})
    }
  })

  it("returns machine-readable gateway home payload for JSON clients", async () => {
    const server = new GatewayServer(0)

    try {
      const response = await (server as unknown as {
        app: { inject: (options: { method: string; url: string; headers?: Record<string, string> }) => Promise<{ statusCode: number; json: () => Record<string, unknown> }> }
      }).app.inject({
        method: "GET",
        url: "/",
        headers: { accept: "application/json" },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        name: "EDITH Control",
        workbenchName: "testing",
      })
    } finally {
      await server.stop().catch(() => {})
    }
  })
})
