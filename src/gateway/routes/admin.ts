/**
 * @file admin.ts
 * @description Gateway admin routes — landing page, dashboard redirect, metadata.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered by src/gateway/server.ts during gateway startup. Provides
 *   the root landing page (HTML for browsers, JSON for API clients) and
 *   administrative redirects.
 */
import type { FastifyInstance } from "fastify"

export interface AdminDeps {
  clients: Map<string, unknown>
  voiceSessions: Map<string, unknown>
  stopVoiceSession: (sessionId: string) => boolean
  handleUserMessage: (userId: string, text: string) => Promise<unknown> | unknown
}

/**
 * Register admin/landing routes on the given Fastify instance.
 */
export function registerAdmin(app: FastifyInstance, _deps: AdminDeps): void {
  app.get("/", async (req, reply) => {
    const accept = (req.headers.accept ?? "").toLowerCase()

    if (accept.includes("text/html")) {
      return reply
        .type("text/html")
        .send(buildLandingHtml())
    }

    return reply.send({
      service: "EDITH Gateway",
      status: "running",
      endpoints: {
        health: "/health",
        legionStatus: "/legion/status",
      },
    })
  })

  app.get("/dashboard", async (_req, reply) => {
    return reply.redirect("/")
  })
}

function buildLandingHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>EDITH Gateway</title></head>
<body>
  <h1>EDITH Gateway</h1>
  <ul>
    <li><a href="/health">/health</a></li>
    <li><a href="/legion/status">/legion/status</a></li>
  </ul>
</body>
</html>`
}
