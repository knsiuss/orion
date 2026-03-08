/**
 * @file api-auth.test.ts
 * @description Unit tests for environment-aware gateway API token auth.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    EDITH_API_TOKEN: "secret-token",
    GATEWAY_HOST: "0.0.0.0",
  },
}))

import { checkApiToken, isLocalhostBinding, warnIfInsecure } from "../api-auth.js"

describe("isLocalhostBinding", () => {
  it("returns true for 127.0.0.1", () => expect(isLocalhostBinding("127.0.0.1")).toBe(true))
  it("returns true for ::1", () => expect(isLocalhostBinding("::1")).toBe(true))
  it("returns true for localhost", () => expect(isLocalhostBinding("localhost")).toBe(true))
  it("returns false for 0.0.0.0", () => expect(isLocalhostBinding("0.0.0.0")).toBe(false))
  it("returns false for external IP", () => expect(isLocalhostBinding("192.168.1.10")).toBe(false))
})

describe("checkApiToken", () => {
  it("passes with correct Bearer token", () => expect(checkApiToken("Bearer secret-token")).toBe(true))
  it("rejects wrong token", () => expect(checkApiToken("Bearer wrong")).toBe(false))
  it("rejects missing header", () => expect(checkApiToken(undefined)).toBe(false))
  it("rejects empty string", () => expect(checkApiToken("")).toBe(false))
  it("rejects bare token (no Bearer prefix)", () => expect(checkApiToken("secret-token")).toBe(false))
})

describe("warnIfInsecure", () => {
  it("does not throw", () => expect(() => warnIfInsecure()).not.toThrow())
})
