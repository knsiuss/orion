/**
 * @file webhook-verifier.ts
 * @description HMAC webhook signature verification for inbound channel requests.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by server.ts for POST /webhooks/:channel requests before they are
 *   routed to channel handlers. Verification is skipped (returns true) when the
 *   relevant secret is not configured — enabling gradual rollout.
 *
 *   Supported schemes:
 *     Telegram: HMAC-SHA256(body, SHA256(TELEGRAM_WEBHOOK_SECRET))
 *               Header: X-Telegram-Bot-Api-Secret-Token
 *     WhatsApp: HMAC-SHA256(body, WHATSAPP_APP_SECRET), prefixed "sha256="
 *               Header: X-Hub-Signature-256
 *     Discord:  Ed25519 — not implemented (requires native module), passthrough.
 *
 *   Uses crypto.timingSafeEqual to prevent timing oracle attacks.
 *
 * @module gateway/webhook-verifier
 */

import crypto from "node:crypto"
import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.webhook-verifier")

/**
 * Returns true if webhook verification is configured for the given channel.
 * When false, verifyWebhook() will always return true (passthrough).
 *
 * @param channel - Channel name (e.g. "telegram", "whatsapp")
 */
export function isWebhookVerificationEnabled(channel: string): boolean {
  switch (channel) {
    case "telegram": return Boolean(config.TELEGRAM_WEBHOOK_SECRET)
    case "whatsapp": return Boolean(config.WHATSAPP_APP_SECRET)
    case "discord":  return Boolean(config.DISCORD_PUBLIC_KEY)
    default: return false
  }
}

/**
 * Verify a Telegram webhook request signature.
 * Telegram computes: HMAC-SHA256(body, SHA256(bot_token))
 *
 * @param body - Raw request body as string
 * @param signature - Value of X-Telegram-Bot-Api-Secret-Token header
 */
export function verifyTelegramSignature(body: string, signature: string): boolean {
  if (!signature) return false
  try {
    const secretKey = crypto.createHash("sha256").update(config.TELEGRAM_WEBHOOK_SECRET).digest()
    const expected = crypto.createHmac("sha256", secretKey).update(body).digest("hex")
    const sigBuf = Buffer.from(signature.padEnd(expected.length, "\0"))
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length) return false
    return crypto.timingSafeEqual(sigBuf, expBuf)
  } catch {
    log.warn("telegram signature verification error")
    return false
  }
}

/**
 * Verify a WhatsApp Cloud API webhook request signature.
 * WhatsApp computes: "sha256=" + HMAC-SHA256(body, app_secret)
 *
 * @param body - Raw request body as string
 * @param signature - Value of X-Hub-Signature-256 header (e.g. "sha256=abc123")
 */
export function verifyWhatsAppSignature(body: string, signature: string): boolean {
  if (!signature.startsWith("sha256=")) return false
  try {
    const expected = "sha256=" + crypto.createHmac("sha256", config.WHATSAPP_APP_SECRET).update(body).digest("hex")
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length) return false
    return crypto.timingSafeEqual(sigBuf, expBuf)
  } catch {
    log.warn("whatsapp signature verification error")
    return false
  }
}

/**
 * Verify an inbound webhook for the given channel.
 * Returns true if verification passes OR if verification is not configured.
 *
 * @param channel - Channel name (e.g. "telegram", "whatsapp")
 * @param body - Raw request body as string
 * @param headers - Request headers (keys should be lowercase)
 */
export function verifyWebhook(
  channel: string,
  body: string,
  headers: Record<string, string | undefined>,
): boolean {
  if (!isWebhookVerificationEnabled(channel)) return true

  switch (channel) {
    case "telegram":
      return verifyTelegramSignature(body, headers["x-telegram-bot-api-secret-token"] ?? "")
    case "whatsapp":
      return verifyWhatsAppSignature(body, headers["x-hub-signature-256"] ?? "")
    default:
      return true
  }
}
