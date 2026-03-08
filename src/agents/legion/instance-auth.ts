/**
 * @file instance-auth.ts
 * @description HMAC-SHA256 authentication for inter-instance Legion communication.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - protocol.ts uses sign() and verifyToken() for all message authentication.
 *   - Uses node:crypto createHmac — no external dependencies.
 *   - Instance secret is loaded from environment at module init.
 */

import crypto from "node:crypto"
import { createLogger } from "../../logger.js"
import type { InstanceRole } from "./types.js"

const log = createLogger("legion.auth")

/** Token lifetime in seconds. */
const TOKEN_TTL_SECONDS = 3600

/** Instance authentication and token management. */
export class InstanceAuth {
  /** HMAC secret key for this instance. */
  private readonly secret: string

  constructor() {
    this.secret = process.env.LEGION_INSTANCE_SECRET ?? crypto.randomBytes(32).toString("hex")
    if (!process.env.LEGION_INSTANCE_SECRET) {
      log.warn("LEGION_INSTANCE_SECRET not set — using ephemeral random key")
    }
  }

  /**
   * Generate a signed JWT-like token for an instance.
   *
   * @param instanceId - Unique instance identifier.
   * @param role       - Instance role.
   * @returns Base64-encoded signed token string.
   */
  generateToken(instanceId: string, role: InstanceRole): string {
    const payload = {
      instanceId,
      role,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      iat: Math.floor(Date.now() / 1000),
    }
    const data = JSON.stringify(payload)
    const encoded = Buffer.from(data).toString("base64url")
    const sig = this.hmac(`${encoded}`)
    return `${encoded}.${sig}`
  }

  /**
   * Verify and decode a token.
   *
   * @param token - Token string from generateToken().
   * @returns Decoded payload or null if invalid/expired.
   */
  verifyToken(token: string): { instanceId: string; role: InstanceRole } | null {
    const parts = token.split(".")
    if (parts.length !== 2) return null
    const [encoded, sig] = parts as [string, string]

    const expectedSig = this.hmac(encoded)
    // timingSafeEqual requires equal-length buffers — check length first
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      log.warn("token signature mismatch")
      return null
    }

    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as {
        instanceId: string
        role: InstanceRole
        exp: number
      }
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        log.warn("token expired", { instanceId: payload.instanceId })
        return null
      }
      return { instanceId: payload.instanceId, role: payload.role }
    } catch {
      log.warn("token decode failed")
      return null
    }
  }

  /**
   * Sign an arbitrary payload object.
   *
   * @param payload - Object to sign.
   * @returns HMAC-SHA256 hex signature.
   */
  sign(payload: unknown): string {
    return this.hmac(JSON.stringify(payload))
  }

  /**
   * Compute HMAC-SHA256 of a string.
   *
   * @param data - Input string.
   * @returns Hex signature.
   */
  private hmac(data: string): string {
    return crypto.createHmac("sha256", this.secret).update(data).digest("hex")
  }
}

/** Singleton instance auth. */
export const instanceAuth = new InstanceAuth()
