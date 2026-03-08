/**
 * @file webhook-verifier.test.ts
 * @description Tests for webhook HMAC signature verification.
 */
import { describe, it, expect, vi } from "vitest"
import crypto from "node:crypto"

vi.mock("../../config.js", () => ({
  default: {
    TELEGRAM_WEBHOOK_SECRET: "my-bot-token",
    WHATSAPP_APP_SECRET: "wa-app-secret",
    DISCORD_PUBLIC_KEY: "",
  },
}))

import {
  verifyTelegramSignature,
  verifyWhatsAppSignature,
  isWebhookVerificationEnabled,
  verifyWebhook,
} from "../webhook-verifier.js"

describe("verifyTelegramSignature", () => {
  it("returns true for valid signature", () => {
    const body = JSON.stringify({ update_id: 123 })
    const secretKey = crypto.createHash("sha256").update("my-bot-token").digest()
    const expected = crypto.createHmac("sha256", secretKey).update(body).digest("hex")
    expect(verifyTelegramSignature(body, expected)).toBe(true)
  })

  it("returns false for invalid signature", () => {
    expect(verifyTelegramSignature("body", "badsig")).toBe(false)
  })

  it("returns false for empty signature", () => {
    expect(verifyTelegramSignature("body", "")).toBe(false)
  })
})

describe("verifyWhatsAppSignature", () => {
  it("returns true for valid sha256= signature", () => {
    const body = "test-body"
    const expected = "sha256=" + crypto.createHmac("sha256", "wa-app-secret").update(body).digest("hex")
    expect(verifyWhatsAppSignature(body, expected)).toBe(true)
  })

  it("returns false for wrong signature", () => {
    expect(verifyWhatsAppSignature("body", "sha256=wronghex")).toBe(false)
  })

  it("returns false for missing sha256= prefix", () => {
    expect(verifyWhatsAppSignature("body", "justhex")).toBe(false)
  })
})

describe("isWebhookVerificationEnabled", () => {
  it("returns true for telegram (secret configured)", () => {
    expect(isWebhookVerificationEnabled("telegram")).toBe(true)
  })
  it("returns true for whatsapp (secret configured)", () => {
    expect(isWebhookVerificationEnabled("whatsapp")).toBe(true)
  })
  it("returns false for discord (no key configured)", () => {
    expect(isWebhookVerificationEnabled("discord")).toBe(false)
  })
  it("returns false for unknown channel", () => {
    expect(isWebhookVerificationEnabled("signal")).toBe(false)
  })
})

describe("verifyWebhook", () => {
  it("passes through when verification not enabled for channel", () => {
    expect(verifyWebhook("signal", "body", {})).toBe(true)
  })

  it("returns false for telegram with missing header", () => {
    expect(verifyWebhook("telegram", "body", {})).toBe(false)
  })
})
