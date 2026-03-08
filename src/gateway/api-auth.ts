/**
 * @file api-auth.ts
 * @description Environment-aware API token authentication for the Fastify gateway.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as a Fastify onRequest hook in server.ts.
 *   Authentication is skipped when GATEWAY_HOST is a loopback address (trusted local).
 *   When bound to a non-loopback address (LAN / VPS), every request must include:
 *     Authorization: Bearer <EDITH_API_TOKEN>
 *   Routes exempt from auth: GET /health, /webhooks/*, WebSocket /ws.
 *   If EDITH_API_TOKEN is not set and gateway is non-local, EDITH warns at startup
 *   and rejects all non-exempt requests with HTTP 401.
 *
 * @module gateway/api-auth
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.api-auth")

/** Addresses that are considered trusted local bindings (no auth required). */
const LOCALHOST_BINDINGS = new Set(["127.0.0.1", "::1", "localhost"])

/**
 * Returns true if the gateway host is a loopback address.
 * Auth is bypassed entirely when the gateway is local-only.
 *
 * @param host - The GATEWAY_HOST config value
 */
export function isLocalhostBinding(host: string): boolean {
  return LOCALHOST_BINDINGS.has(host)
}

/**
 * Validate an Authorization header value against the configured API token.
 * Expected format: "Bearer <token>"
 *
 * @param authHeader - The raw Authorization header value (or undefined)
 * @returns true if the token is present and matches EDITH_API_TOKEN
 */
export function checkApiToken(authHeader: string | undefined): boolean {
  const expected = config.EDITH_API_TOKEN
  if (!expected || !authHeader) return false
  if (!authHeader.startsWith("Bearer ")) return false
  return authHeader.slice(7) === expected
}

/**
 * Log a startup warning when the gateway is exposed publicly without a token.
 * Call once during server initialization.
 */
export function warnIfInsecure(): void {
  if (!isLocalhostBinding(config.GATEWAY_HOST) && !config.EDITH_API_TOKEN) {
    log.warn(
      "SECURITY WARNING: gateway is bound to a non-localhost address but EDITH_API_TOKEN is not set — all non-exempt REST requests will be rejected with 401",
      { GATEWAY_HOST: config.GATEWAY_HOST },
    )
  }
}
