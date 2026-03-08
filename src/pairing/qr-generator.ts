/**
 * @file qr-generator.ts
 * @description One-time QR pairing token generator for device pairing (Phase 27).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Gateway routes call generate() to create a QR code payload.
 *   - Mobile app scans the QR and POSTs the token to /pair/complete.
 *   - QR rendering is client-side — this only produces the data payload.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../logger.js"

const log = createLogger("pairing.qr-generator")

/** One-time pairing token with expiry. */
interface PairingToken {
  /** One-time use token string. */
  token: string
  /** User ID this pairing invitation belongs to. */
  userId: string
  /** Unix timestamp when the token expires. */
  expiresAt: number
}

/** QR code generation result. */
export interface QRPayload {
  /** One-time pairing token. */
  token: string
  /** JSON-serialized payload to encode in the QR code. */
  payload: string
  /** Unix timestamp when this QR code expires. */
  expiresAt: number
}

/** Token validity window in milliseconds (5 minutes). */
const TOKEN_TTL_MS = 5 * 60 * 1000

/**
 * Generates one-time QR pairing tokens for secure device pairing.
 * QR rendering is deferred to the client — this generates the data only.
 */
export class QRGenerator {
  /** Active pending tokens keyed by token string. */
  private readonly pendingTokens = new Map<string, PairingToken>()

  /**
   * Generate a one-time pairing token and QR payload.
   *
   * @param userId     - User initiating the pairing.
   * @param gatewayUrl - Gateway URL the new device should connect to.
   * @returns QR code data payload with token and expiry.
   */
  generate(userId: string, gatewayUrl: string): QRPayload {
    // Expire old tokens for this user
    for (const [token, entry] of this.pendingTokens) {
      if (entry.userId === userId && entry.expiresAt < Date.now()) {
        this.pendingTokens.delete(token)
      }
    }

    const token = randomUUID()
    const expiresAt = Date.now() + TOKEN_TTL_MS

    this.pendingTokens.set(token, { token, userId, expiresAt })

    const qrData = {
      version: "1.0",
      token,
      userId,
      gatewayUrl,
      expiresAt,
    }

    log.info("QR pairing token generated", { userId, expiresAt })
    return {
      token,
      payload: JSON.stringify(qrData),
      expiresAt,
    }
  }

  /**
   * Validate a pairing token presented by a new device.
   *
   * @param token - Token from the scanned QR code.
   * @returns Validation result with userId if valid.
   */
  validate(token: string): { valid: boolean; userId?: string } {
    const entry = this.pendingTokens.get(token)
    if (!entry) {
      log.warn("QR token not found", { token: token.slice(0, 8) })
      return { valid: false }
    }

    if (entry.expiresAt < Date.now()) {
      this.pendingTokens.delete(token)
      log.warn("QR token expired", { userId: entry.userId })
      return { valid: false }
    }

    // Consume token (one-time use)
    this.pendingTokens.delete(token)
    log.info("QR token validated", { userId: entry.userId })
    return { valid: true, userId: entry.userId }
  }
}

/** Singleton QR generator. */
export const qrGenerator = new QRGenerator()
