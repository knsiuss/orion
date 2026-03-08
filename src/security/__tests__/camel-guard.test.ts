/**
 * @file camel-guard.test.ts
 * @description Vitest suite for CaMeL guard taint tracking and capability-token system.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Exercises CamelGuard.check(), issueCapabilityToken(), readCapabilityToken(),
 *   validateCapabilityToken(), and inferToolResultTaintSources() exported from
 *   src/security/camel-guard.ts.
 *   HMAC signing uses EDITH_CAPABILITY_SECRET from the environment; falls back to
 *   the hard-coded dev string "edith-local-dev-capability-secret" when absent.
 *
 * PAPER BASIS:
 *   - CaMeL (Capability Minimal Language): arXiv:2503.18813 — taint propagation and
 *     privilege separation for LLM tool-call pipelines.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CamelGuard,
  camelGuard,
  inferToolResultTaintSources,
  type CamelCheckInput,
  type TaintSource,
} from "../camel-guard.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fully-populated CamelCheckInput with sensible defaults. */
function makeInput(overrides: Partial<CamelCheckInput> = {}): CamelCheckInput {
  return {
    actorId: "user-001",
    toolName: "fileAgent",
    action: "write",
    taintedSources: ["web_content"],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// check() — clean (untainted) input is always allowed
// ---------------------------------------------------------------------------

describe("CamelGuard.check() — clean input", () => {
  it("allows action when taintedSources is empty", () => {
    // arrange + act
    const result = camelGuard.check(makeInput({ taintedSources: [] }))
    // assert
    expect(result.allowed).toBe(true)
  })

  it("does not attach a rejection reason for untainted input", () => {
    const result = camelGuard.check(makeInput({ taintedSources: [] }))
    expect(result.reason).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// check() — read-only actions bypass the taint gate
// ---------------------------------------------------------------------------

describe("CamelGuard.check() — read-only actions allowed despite taint", () => {
  it("allows browser navigate with web_content taint", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "browser", action: "navigate", taintedSources: ["web_content"] }),
    )
    expect(result.allowed).toBe(true)
  })

  it("allows browser click with web_content taint", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "browser", action: "click", taintedSources: ["web_content"] }),
    )
    expect(result.allowed).toBe(true)
  })

  it("allows fileAgent read with file_content taint", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "fileAgent", action: "read", taintedSources: ["file_content"] }),
    )
    expect(result.allowed).toBe(true)
  })

  it("allows fileAgent info with file_content taint", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "fileAgent", action: "info", taintedSources: ["file_content"] }),
    )
    expect(result.allowed).toBe(true)
  })

  it("allows fileAgent list with file_content taint", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "fileAgent", action: "list", taintedSources: ["file_content"] }),
    )
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// check() — tainted write-like actions blocked without a token
// ---------------------------------------------------------------------------

describe("CamelGuard.check() — tainted action blocked without capability token", () => {
  it("blocks fileAgent write when no capabilityToken is supplied", () => {
    const result = camelGuard.check(makeInput({ capabilityToken: undefined }))
    expect(result.allowed).toBe(false)
  })

  it("rejection reason includes the tool name and action", () => {
    const result = camelGuard.check(makeInput({ capabilityToken: undefined }))
    expect(result.reason).toMatch(/fileAgent\.write/i)
  })

  it("rejection reason mentions capability token", () => {
    const result = camelGuard.check(makeInput({ capabilityToken: undefined }))
    expect(result.reason).toMatch(/capability token/i)
  })

  it("blocks codeRunner exec with code_output taint and no token", () => {
    const result = camelGuard.check(
      makeInput({ toolName: "codeRunner", action: "exec", taintedSources: ["code_output"] }),
    )
    expect(result.allowed).toBe(false)
  })

  it("blocks when multiple taint sources present and no token supplied", () => {
    const result = camelGuard.check(
      makeInput({ taintedSources: ["web_content", "file_content"], capabilityToken: undefined }),
    )
    expect(result.allowed).toBe(false)
  })

  it("deduplicates sources before gate check — still blocks on deduplicated taint", () => {
    // [web_content, web_content] deduplicates to [web_content]; taint is still present.
    const sources: TaintSource[] = ["web_content", "web_content"]
    const result = camelGuard.check(makeInput({ taintedSources: sources, capabilityToken: undefined }))
    expect(result.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// issueCapabilityToken() — token structure
// ---------------------------------------------------------------------------

describe("CamelGuard.issueCapabilityToken() — token structure", () => {
  it("returns a string with exactly two dot-separated segments", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
    })
    const segments = token.split(".")
    expect(segments).toHaveLength(2)
    expect(segments[0]!.length).toBeGreaterThan(0)
    expect(segments[1]!.length).toBeGreaterThan(0)
  })

  it("round-trips the full payload through readCapabilityToken", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-abc",
      toolName: "codeRunner",
      action: "exec",
      taintedSources: ["code_output"],
    })
    const payload = guard.readCapabilityToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.actorId).toBe("user-abc")
    expect(payload!.toolName).toBe("codeRunner")
    expect(payload!.action).toBe("exec")
    expect(payload!.taintedSources).toContain("code_output")
    expect(payload!.version).toBe(1)
  })

  it("deduplicates taint sources stored inside the token", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content", "web_content"],
    })
    const payload = guard.readCapabilityToken(token)!
    const occurrences = payload.taintedSources.filter((s) => s === "web_content")
    expect(occurrences).toHaveLength(1)
  })

  it("sets issuedAt to approximately the current time", () => {
    const guard = new CamelGuard()
    const before = Date.now()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: [],
    })
    const after = Date.now()
    const payload = guard.readCapabilityToken(token)!
    expect(payload.issuedAt).toBeGreaterThanOrEqual(before)
    expect(payload.issuedAt).toBeLessThanOrEqual(after)
  })

  it("sets expiresAt to a timestamp in the future", () => {
    const guard = new CamelGuard()
    const before = Date.now()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: [],
    })
    const payload = guard.readCapabilityToken(token)!
    expect(payload.expiresAt).toBeGreaterThan(before)
  })

  it("respects custom ttlMs and enforces the 1 000 ms minimum", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: [],
      ttlMs: 2_000,
    })
    const payload = guard.readCapabilityToken(token)!
    const diff = payload.expiresAt - payload.issuedAt
    expect(diff).toBeGreaterThanOrEqual(1_900)
    expect(diff).toBeLessThanOrEqual(2_100)
  })

  it("enforces 1 000 ms minimum TTL when ttlMs is below threshold", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: [],
      ttlMs: 1, // below minimum — should be clamped to 1 000
    })
    const payload = guard.readCapabilityToken(token)!
    const diff = payload.expiresAt - payload.issuedAt
    expect(diff).toBeGreaterThanOrEqual(1_000)
  })
})

// ---------------------------------------------------------------------------
// readCapabilityToken() — invalid / tampered tokens return null
// ---------------------------------------------------------------------------

describe("CamelGuard.readCapabilityToken() — invalid tokens", () => {
  it("returns null for a completely invalid string", () => {
    expect(camelGuard.readCapabilityToken("notavalidtoken")).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(camelGuard.readCapabilityToken("")).toBeNull()
  })

  it("returns null when the signature segment is tampered", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "u",
      toolName: "t",
      action: "a",
      taintedSources: [],
    })
    const [payloadSeg] = token.split(".")
    const tampered = `${payloadSeg!}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    expect(guard.readCapabilityToken(tampered)).toBeNull()
  })

  it("returns null when the payload segment is corrupted base64url", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "u",
      toolName: "t",
      action: "a",
      taintedSources: [],
    })
    const [, sig] = token.split(".")
    // "bm90anNvbg" is base64url for "notjson" — valid base64 but invalid JSON
    const corrupted = `bm90anNvbg.${sig!}`
    expect(guard.readCapabilityToken(corrupted)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// check() — token expiration enforced
// ---------------------------------------------------------------------------

describe("CamelGuard.check() — expired token rejected", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("blocks a tainted action when the capability token has expired", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
      ttlMs: 1_000, // minimum; expires after 1 s
    })

    // Advance clock well past expiry
    vi.advanceTimersByTime(10_000)

    const result = guard.check({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
      capabilityToken: token,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/expired/i)
  })
})

// ---------------------------------------------------------------------------
// check() — valid token grants access; scope mismatches are caught
// ---------------------------------------------------------------------------

describe("CamelGuard.check() — valid token grants / scope enforcement", () => {
  it("allows tainted fileAgent write when a matching capability token is supplied", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
    })
    const result = guard.check({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
      capabilityToken: token,
    })
    expect(result.allowed).toBe(true)
  })

  it("blocks when actorId in token does not match the caller", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
    })
    const result = guard.check({
      actorId: "attacker-999",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
      capabilityToken: token,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/actor mismatch/i)
  })

  it("blocks when toolName in token does not match the call", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
    })
    const result = guard.check({
      actorId: "user-001",
      toolName: "codeRunner", // different tool
      action: "write",
      taintedSources: ["web_content"],
      capabilityToken: token,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/scope mismatch/i)
  })

  it("blocks when action in token does not match the call", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"],
    })
    const result = guard.check({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "delete", // different action
      taintedSources: ["web_content"],
      capabilityToken: token,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/scope mismatch/i)
  })

  it("blocks when caller claims a taint source not covered by the token", () => {
    const guard = new CamelGuard()
    const token = guard.issueCapabilityToken({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content"], // token only covers web_content
    })
    const result = guard.check({
      actorId: "user-001",
      toolName: "fileAgent",
      action: "write",
      taintedSources: ["web_content", "file_content"], // extra source not in token
      capabilityToken: token,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/taint scope mismatch/i)
  })
})

// ---------------------------------------------------------------------------
// HMAC secret isolation — tokens must not cross-validate between secrets
// ---------------------------------------------------------------------------

describe("CamelGuard — HMAC secret isolation", () => {
  afterEach(() => {
    delete process.env["EDITH_CAPABILITY_SECRET"]
  })

  it("rejects a token issued under secret-A when validated with secret-B", () => {
    // Guard A uses the dev fallback (no env var set)
    delete process.env["EDITH_CAPABILITY_SECRET"]
    const guardA = new CamelGuard()
    const token = guardA.issueCapabilityToken({
      actorId: "u",
      toolName: "t",
      action: "a",
      taintedSources: [],
    })

    // Guard B uses a completely different secret
    process.env["EDITH_CAPABILITY_SECRET"] = "completely-different-secret-xyz"
    const guardB = new CamelGuard()

    expect(guardB.readCapabilityToken(token)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// inferToolResultTaintSources()
// ---------------------------------------------------------------------------

describe("inferToolResultTaintSources()", () => {
  it("returns ['web_content'] for browser navigate", () => {
    expect(inferToolResultTaintSources("browser", "navigate")).toEqual(["web_content"])
  })

  it("returns ['web_content'] for any browser action (all browser actions are web)", () => {
    expect(inferToolResultTaintSources("browser", "click")).toEqual(["web_content"])
  })

  it("returns ['file_content'] for fileAgent read", () => {
    expect(inferToolResultTaintSources("fileAgent", "read")).toEqual(["file_content"])
  })

  it("returns ['file_content'] for fileAgent info", () => {
    expect(inferToolResultTaintSources("fileAgent", "info")).toEqual(["file_content"])
  })

  it("returns ['file_content'] for fileAgent list", () => {
    expect(inferToolResultTaintSources("fileAgent", "list")).toEqual(["file_content"])
  })

  it("returns ['code_output'] for codeRunner exec", () => {
    expect(inferToolResultTaintSources("codeRunner", "exec")).toEqual(["code_output"])
  })

  it("returns [] for an unrecognised tool", () => {
    expect(inferToolResultTaintSources("unknownTool", "doSomething")).toEqual([])
  })

  it("returns [] for fileAgent write (non-read action yields no taint inference)", () => {
    expect(inferToolResultTaintSources("fileAgent", "write")).toEqual([])
  })

  it("returns [] for fileAgent delete (non-read action)", () => {
    expect(inferToolResultTaintSources("fileAgent", "delete")).toEqual([])
  })
})
