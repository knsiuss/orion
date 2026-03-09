/**
 * @file security-utils.test.ts
 * @description Unit tests for security utility modules:
 *   - dangerous-tools.ts (isCommandBlocked, DANGEROUS_TOOL_NAMES)
 *   - safe-regex.ts (safeMatch, isReDoSSafe)
 *   - secret-equal.ts (secretEqual)
 */
import { describe, expect, it } from "vitest"

import { isCommandBlocked, DANGEROUS_TOOL_NAMES, BLOCKED_COMMAND_PATTERNS } from "../dangerous-tools.js"
import { safeMatch, isReDoSSafe } from "../safe-regex.js"
import { secretEqual } from "../secret-equal.js"

// ─────────────────────────────────────────────────────────────────────────────
// dangerous-tools
// ─────────────────────────────────────────────────────────────────────────────
describe("isCommandBlocked", () => {
  it("blocks rm -rf /", () => {
    expect(isCommandBlocked("rm -rf /")).toBe(true)
  })

  it("blocks rm -rf ~", () => {
    expect(isCommandBlocked("rm -rf ~/important")).toBe(true)
  })

  it("blocks format c:", () => {
    expect(isCommandBlocked("format C:")).toBe(true)
  })

  it("blocks mkfs commands", () => {
    expect(isCommandBlocked("mkfs.ext4 /dev/sdb")).toBe(true)
  })

  it("blocks dd write to disk", () => {
    expect(isCommandBlocked("dd if=/dev/zero of=/dev/sda")).toBe(true)
  })

  it("blocks shutdown -h now", () => {
    expect(isCommandBlocked("sudo shutdown -h now")).toBe(true)
  })

  it("blocks halt", () => {
    expect(isCommandBlocked("halt")).toBe(true)
  })

  it("allows safe commands", () => {
    expect(isCommandBlocked("ls -la")).toBe(false)
    expect(isCommandBlocked("git status")).toBe(false)
    expect(isCommandBlocked("echo hello")).toBe(false)
    expect(isCommandBlocked("npm install")).toBe(false)
  })

  it("allows rm on specific safe path", () => {
    // rm -rf without / or ~ should not match
    expect(isCommandBlocked("rm -rf ./build/temp")).toBe(false)
  })
})

describe("DANGEROUS_TOOL_NAMES", () => {
  it("contains expected dangerous tool names", () => {
    expect(DANGEROUS_TOOL_NAMES.has("shell_exec")).toBe(true)
    expect(DANGEROUS_TOOL_NAMES.has("eval_code")).toBe(true)
    expect(DANGEROUS_TOOL_NAMES.has("file_delete")).toBe(true)
    expect(DANGEROUS_TOOL_NAMES.has("db_query")).toBe(true)
  })

  it("does not contain safe tool names", () => {
    expect(DANGEROUS_TOOL_NAMES.has("get_weather")).toBe(false)
    expect(DANGEROUS_TOOL_NAMES.has("search_web")).toBe(false)
  })
})

describe("BLOCKED_COMMAND_PATTERNS", () => {
  it("is an array of RegExp instances", () => {
    expect(Array.isArray(BLOCKED_COMMAND_PATTERNS)).toBe(true)
    expect(BLOCKED_COMMAND_PATTERNS.every((p) => p instanceof RegExp)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// safe-regex
// ─────────────────────────────────────────────────────────────────────────────
describe("safeMatch", () => {
  it("returns match for valid pattern", () => {
    const result = safeMatch("hello world", /hello (\w+)/)
    expect(result).not.toBeNull()
    expect(result?.[1]).toBe("world")
  })

  it("returns null for non-matching input", () => {
    const result = safeMatch("hello", /xyz/)
    expect(result).toBeNull()
  })

  it("returns null on regex execution error (Symbol.match throws)", () => {
    const badPattern = { [Symbol.match]: () => { throw new Error("forced") } } as unknown as RegExp
    const result = safeMatch("test", badPattern)
    expect(result).toBeNull()
  })

  it("returns match result when within timeout", () => {
    const result = safeMatch("abc123", /\d+/, 1000)
    expect(result?.[0]).toBe("123")
  })
})

describe("isReDoSSafe", () => {
  it("flags (a+)+ as ReDoS-unsafe", () => {
    expect(isReDoSSafe("(a+)+")).toBe(false)
  })

  it("flags (a*)* as ReDoS-unsafe", () => {
    expect(isReDoSSafe("(a*)*")).toBe(false)
  })

  it("approves simple safe patterns", () => {
    expect(isReDoSSafe("^[a-z]+$")).toBe(true)
    expect(isReDoSSafe("\\d{4}-\\d{2}-\\d{2}")).toBe(true)
    expect(isReDoSSafe("hello|world")).toBe(true)
  })

  it("approves patterns with single quantifiers on groups (no nested quantifiers)", () => {
    // (abc)+ has no quantifier inside the group, so it is considered safe
    expect(isReDoSSafe("(abc)+")).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// secret-equal
// ─────────────────────────────────────────────────────────────────────────────
describe("secretEqual", () => {
  it("returns true for identical strings", () => {
    expect(secretEqual("correct-horse-battery", "correct-horse-battery")).toBe(true)
  })

  it("returns false for different strings", () => {
    expect(secretEqual("secret123", "secret456")).toBe(false)
  })

  it("returns false for empty vs non-empty string", () => {
    expect(secretEqual("", "notempty")).toBe(false)
  })

  it("returns true for empty strings compared to each other", () => {
    expect(secretEqual("", "")).toBe(true)
  })

  it("is case-sensitive", () => {
    expect(secretEqual("Secret", "secret")).toBe(false)
  })

  it("handles long strings", () => {
    const long = "x".repeat(10000)
    expect(secretEqual(long, long)).toBe(true)
    expect(secretEqual(long, long + "x")).toBe(false)
  })
})
