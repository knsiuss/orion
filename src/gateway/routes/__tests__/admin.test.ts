/**
 * @file admin.test.ts
 * @description Route tests for gateway admin endpoints and landing page.
 */
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import { registerAdmin } from "../admin.js"

describe("registerAdmin", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("serves a browser-friendly landing page at GET /", async () => {
    const app = Fastify()
    registerAdmin(app, {
      clients: new Map(),
      voiceSessions: new Map(),
      stopVoiceSession: () => false,
      handleUserMessage: vi.fn(),
    })
    await app.ready()

    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("text/html")
    expect(res.body).toContain("EDITH Gateway")
    expect(res.body).toContain("/health")
    expect(res.body).toContain("/legion/status")

    await app.close()
  })

  it("returns JSON metadata for non-browser GET / clients", async () => {
    const app = Fastify()
    registerAdmin(app, {
      clients: new Map(),
      voiceSessions: new Map(),
      stopVoiceSession: () => false,
      handleUserMessage: vi.fn(),
    })
    await app.ready()

    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "application/json" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      service: "EDITH Gateway",
      status: "running",
      endpoints: {
        health: "/health",
        legionStatus: "/legion/status",
      },
    })

    await app.close()
  })

  it("redirects /dashboard to the gateway landing page", async () => {
    const app = Fastify()
    registerAdmin(app, {
      clients: new Map(),
      voiceSessions: new Map(),
      stopVoiceSession: () => false,
      handleUserMessage: vi.fn(),
    })
    await app.ready()

    const res = await app.inject({
      method: "GET",
      url: "/dashboard",
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("/")

    await app.close()
  })
})
