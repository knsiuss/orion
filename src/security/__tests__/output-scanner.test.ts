/**
 * @file output-scanner.test.ts
 * @description Vitest suite for OutputScanner — secret redaction and harmful-content detection.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Exercises OutputScanner.scan() exported from src/security/output-scanner.ts.
 *   The scanner applies SENSITIVE_OUTPUT_PATTERNS (API keys, GitHub tokens, JWTs,
 *   passwords) and WARNING_PATTERNS (harmful instructions) to the raw LLM output
 *   string before it is delivered to the user.
 */

import { describe, expect, it } from "vitest"

import { OutputScanner, outputScanner } from "../output-scanner.js"

// ---------------------------------------------------------------------------
// API key patterns — sk- prefix (OpenAI-style)
// ---------------------------------------------------------------------------

describe("OutputScanner — OpenAI-style API key (sk-...)", () => {
  it("detects and redacts a 32-char sk- key", () => {
    const key = "sk-" + "a".repeat(32)
    const result = outputScanner.scan(`Use this key: ${key}`)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("API key in output")
    expect(result.sanitized).toContain("[API_KEY_REDACTED]")
    expect(result.sanitized).not.toMatch(/sk-[a-zA-Z0-9]{32,}/)
  })

  it("detects sk- key embedded mid-sentence", () => {
    const key = "sk-" + "Z".repeat(40)
    const result = outputScanner.scan(`Please set OPENAI_KEY=${key} in your .env file`)
    expect(result.safe).toBe(false)
    expect(result.sanitized).not.toContain(key)
  })

  it("detects a longer-than-minimum sk- key (40 chars after prefix)", () => {
    const key = "sk-" + "b".repeat(40)
    const result = outputScanner.scan(key)
    expect(result.issues).toContain("API key in output")
  })

  it("does NOT flag an sk- string with fewer than 32 chars after the prefix", () => {
    // "sk-tooshort" has only 8 chars after the prefix — below threshold
    const result = outputScanner.scan("The prefix sk-tooshort is not a real API key")
    expect(result.issues).not.toContain("API key in output")
  })
})

// ---------------------------------------------------------------------------
// GitHub personal access tokens — ghp_ prefix (exactly 36 chars after prefix)
// ---------------------------------------------------------------------------

describe("OutputScanner — GitHub token (ghp_...)", () => {
  it("detects and redacts a ghp_ token of exactly 36 chars after the prefix", () => {
    const token = "ghp_" + "A".repeat(36)
    const result = outputScanner.scan(`Your GitHub PAT is ${token}`)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("GitHub token in output")
    expect(result.sanitized).toContain("[GITHUB_TOKEN_REDACTED]")
    expect(result.sanitized).not.toContain(token)
  })

  it("does NOT flag a ghp_ string with fewer than 36 chars after the prefix", () => {
    const shortToken = "ghp_" + "B".repeat(10)
    const result = outputScanner.scan(`Token attempt: ${shortToken}`)
    expect(result.issues).not.toContain("GitHub token in output")
  })
})

// ---------------------------------------------------------------------------
// AWS access key — AKIA prefix
// The scanner does NOT currently implement an AKIA pattern; this test documents
// that intentional gap so it is explicit rather than silently assumed.
// ---------------------------------------------------------------------------

describe("OutputScanner — AWS access key (AKIA...) — gap documentation", () => {
  it("does NOT redact AKIA-style keys (pattern not yet implemented)", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE"
    const result = outputScanner.scan(`AWS key: ${awsKey}`)
    // Behaviour is documented: not caught until pattern is added
    expect(result.sanitized).toContain(awsKey)
  })
})

// ---------------------------------------------------------------------------
// JWT tokens — eyJ... three-segment format
// ---------------------------------------------------------------------------

describe("OutputScanner — JWT token (eyJ...)", () => {
  it("detects and redacts a standard three-segment JWT", () => {
    // Each segment must be >= 20 base64url chars per the pattern
    const header  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"          // 36 chars
    const payload = "eyJzdWIiOiJ1c2VyLTAwMSIsImlhdCI6MTYwMDAwMH0"    // 44 chars
    const sig     = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"    // 43 chars
    const jwt = `${header}.${payload}.${sig}`

    const result = outputScanner.scan(`Here is your token: ${jwt}`)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("JWT token in output")
    expect(result.sanitized).toContain("[JWT_REDACTED]")
    expect(result.sanitized).not.toContain(jwt)
  })

  it("does NOT flag a short eyJ string whose segments are below the 20-char threshold", () => {
    // All three segments are < 20 chars
    const short = "eyJhbGci.eyJz.sig"
    const result = outputScanner.scan(`Value: ${short}`)
    expect(result.issues).not.toContain("JWT token in output")
  })

  it("does NOT flag a dotted version string like 'v1.0.0-rc.1' as a JWT", () => {
    const result = outputScanner.scan("Release v1.0.0-rc.1 is now available.")
    expect(result.issues).not.toContain("JWT token in output")
  })
})

// ---------------------------------------------------------------------------
// Password patterns
// ---------------------------------------------------------------------------

describe("OutputScanner — password patterns", () => {
  it("detects 'password: value' (colon separator, quoted value)", () => {
    const result = outputScanner.scan(`Login with password: "supersecret123"`)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("Password in output")
    expect(result.sanitized).toContain("password: [REDACTED]")
  })

  it("detects 'password=value' (assignment style, 8+ chars)", () => {
    const result = outputScanner.scan("Config: password=Hunter2password")
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("Password in output")
  })

  it("is case-insensitive for the PASSWORD keyword", () => {
    const result = outputScanner.scan("Your PASSWORD: VerySecure99!")
    expect(result.issues).toContain("Password in output")
  })

  it("does NOT flag a password value shorter than 8 characters", () => {
    // "short" is only 5 chars — below the 8-char minimum in the pattern
    const result = outputScanner.scan("password: short")
    expect(result.issues).not.toContain("Password in output")
  })
})

// ---------------------------------------------------------------------------
// Clean output passes through unchanged
// ---------------------------------------------------------------------------

describe("OutputScanner — clean output", () => {
  it("marks a normal sentence as safe", () => {
    const result = outputScanner.scan("The weather in Jakarta today is 32 degrees Celsius.")
    expect(result.safe).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it("returns the original string unchanged when no secrets are present", () => {
    const clean = "Here is a summary of the TypeScript documentation you requested."
    const result = outputScanner.scan(clean)
    expect(result.sanitized).toBe(clean)
  })

  it("marks an empty string as safe", () => {
    const result = outputScanner.scan("")
    expect(result.safe).toBe(true)
    expect(result.sanitized).toBe("")
  })

  it("does not flag a normal HTTPS URL as a secret", () => {
    const result = outputScanner.scan("Visit https://docs.anthropic.com for the API reference.")
    expect(result.safe).toBe(true)
  })

  it("does not flag a UUID as a secret", () => {
    const result = outputScanner.scan("Session ID: 550e8400-e29b-41d4-a716-446655440000")
    expect(result.safe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Multiple secrets in a single output string
// ---------------------------------------------------------------------------

describe("OutputScanner — multiple secrets in one output", () => {
  it("reports and redacts both an API key and a GitHub token found together", () => {
    const apiKey  = "sk-" + "x".repeat(32)
    const ghToken = "ghp_" + "Y".repeat(36)
    const output  = `OPENAI_KEY=${apiKey} and GH_TOKEN=${ghToken}`

    const result = outputScanner.scan(output)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("API key in output")
    expect(result.issues).toContain("GitHub token in output")
    expect(result.sanitized).not.toContain(apiKey)
    expect(result.sanitized).not.toContain(ghToken)
  })

  it("accumulates one issue entry per pattern category, not per occurrence", () => {
    // Two separate sk- keys in the same string should produce one issue label
    const key1 = "sk-" + "a".repeat(32)
    const key2 = "sk-" + "b".repeat(40)
    const result = outputScanner.scan(`Key 1: ${key1}  Key 2: ${key2}`)
    expect(result.issues.filter((i) => i === "API key in output")).toHaveLength(1)
  })

  it("redacts both API key and password when both appear in the same string", () => {
    const key = "sk-" + "c".repeat(32)
    const output = `Key=${key} and password: secretvalue123`
    const result = outputScanner.scan(output)
    expect(result.issues).toContain("API key in output")
    expect(result.issues).toContain("Password in output")
    expect(result.sanitized).not.toContain(key)
  })
})

// ---------------------------------------------------------------------------
// WARNING_PATTERNS — potentially harmful instructions
// ---------------------------------------------------------------------------

describe("OutputScanner — harmful instruction patterns", () => {
  it("flags 'step N kill/harm/attack/steal' style content", () => {
    const result = outputScanner.scan("Step 1: kill the process and harm the target.")
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("Potentially harmful instructions in output")
  })

  it("flags 'instructions to hack' phrasing", () => {
    const result = outputScanner.scan("Here are instructions to hack the target system.")
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("Potentially harmful instructions in output")
  })

  it("flags 'guide to exploit' phrasing", () => {
    const result = outputScanner.scan("A complete guide to exploit this vulnerability.")
    expect(result.safe).toBe(false)
    expect(result.issues).toContain("Potentially harmful instructions in output")
  })

  it("does NOT redact the text body for warning patterns — only marks unsafe", () => {
    // Warning patterns flag but do not sanitize the text
    const harmful = "Step 1 attack the server with force."
    const result = outputScanner.scan(harmful)
    expect(result.sanitized).toContain("Step 1 attack the server with force.")
  })

  it("does not flag generic step-by-step cooking instructions", () => {
    const result = outputScanner.scan("Step 1: mix the flour. Step 2: add butter.")
    expect(result.issues).not.toContain("Potentially harmful instructions in output")
  })
})

// ---------------------------------------------------------------------------
// OutputScanner singleton exported as outputScanner
// ---------------------------------------------------------------------------

describe("outputScanner singleton", () => {
  it("is an instance of OutputScanner", () => {
    expect(outputScanner).toBeInstanceOf(OutputScanner)
  })

  it("new OutputScanner() produces equivalent results to the singleton", () => {
    const fresh = new OutputScanner()
    const key = "sk-" + "z".repeat(32)
    const fromSingleton = outputScanner.scan(key)
    const fromFresh = fresh.scan(key)
    expect(fromFresh.safe).toBe(fromSingleton.safe)
    expect(fromFresh.issues).toEqual(fromSingleton.issues)
  })
})
