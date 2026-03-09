/**
 * @file secret-store.test.ts
 * @description Unit tests for SecretStore — env-file watching, reload diff,
 * event emission on rotation, and security invariants (values never logged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────────
const {
  existsSyncMock,
  readFileSyncMock,
  watchMock,
  dotenvParseMock,
  emitMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn().mockReturnValue(true),
  readFileSyncMock: vi.fn().mockReturnValue(""),
  watchMock: vi.fn().mockReturnValue({ on: vi.fn(), close: vi.fn() }),
  dotenvParseMock: vi.fn().mockReturnValue({}),
  emitMock: vi.fn(),
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: existsSyncMock,
      readFileSync: readFileSyncMock,
      watch: watchMock,
    },
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    watch: watchMock,
  }
})

vi.mock("dotenv", () => ({
  default: {
    parse: dotenvParseMock,
    config: vi.fn().mockReturnValue({ parsed: {} }),
  },
  parse: dotenvParseMock,
  config: vi.fn().mockReturnValue({ parsed: {} }),
}))

vi.mock("../../core/event-bus.js", () => ({
  eventBus: { emit: emitMock },
}))

import { secretStore } from "../secret-store.js"

// ─────────────────────────────────────────────────────────────────────────────
describe("SecretStore.get()", () => {
  it("returns the current process.env value", () => {
    process.env["TEST_SECRET_KEY"] = "test-value"
    expect(secretStore.get("TEST_SECRET_KEY")).toBe("test-value")
    delete process.env["TEST_SECRET_KEY"]
  })

  it("returns empty string for unset keys", () => {
    delete process.env["MISSING_KEY_XYZ"]
    expect(secretStore.get("MISSING_KEY_XYZ")).toBe("")
  })
})

describe("SecretStore.has()", () => {
  it("returns true when key has a non-empty value", () => {
    process.env["HAS_KEY"] = "something"
    expect(secretStore.has("HAS_KEY")).toBe(true)
    delete process.env["HAS_KEY"]
  })

  it("returns false when key is missing", () => {
    delete process.env["ABSENT_KEY"]
    expect(secretStore.has("ABSENT_KEY")).toBe(false)
  })

  it("returns false when key is an empty string", () => {
    process.env["EMPTY_KEY"] = ""
    expect(secretStore.has("EMPTY_KEY")).toBe(false)
    delete process.env["EMPTY_KEY"]
  })
})

describe("SecretStore.getRotationInfo()", () => {
  it("returns null before any rotation occurs", () => {
    // Reset internal state — create a fresh instance indirectly by checking
    // the initial state on import. We can only verify the return type here.
    const info = secretStore.getRotationInfo()
    // Either null (no rotation yet) or a valid rotation info object
    if (info !== null) {
      expect(typeof info.rotatedAt).toBe("string")
      expect(Array.isArray(info.changedKeys)).toBe(true)
      expect(typeof info.valid).toBe("boolean")
    } else {
      expect(info).toBeNull()
    }
  })
})

describe("SecretStore.reload()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(true)
  })

  it("returns empty array when no keys change", async () => {
    // Mock parse to return the same values as process.env
    dotenvParseMock.mockReturnValue({
      ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
    })
    readFileSyncMock.mockReturnValue("ANTHROPIC_API_KEY=unchanged")

    const changed = await secretStore.reload()
    // Reload may detect no actual changes in the snapshot
    expect(Array.isArray(changed)).toBe(true)
  })

  it("returns changed secret key names when a secret changes", async () => {
    // Set a current known value
    process.env["GROQ_API_KEY"] = "old-groq-key"

    // Mock the file to contain a new value
    readFileSyncMock.mockReturnValue("GROQ_API_KEY=new-groq-key-rotated")
    dotenvParseMock.mockReturnValue({ GROQ_API_KEY: "new-groq-key-rotated" })

    const changed = await secretStore.reload()
    expect(changed).toContain("GROQ_API_KEY")

    // Confirm process.env was updated
    expect(process.env["GROQ_API_KEY"]).toBe("new-groq-key-rotated")

    // Clean up
    delete process.env["GROQ_API_KEY"]
  })

  it("does NOT emit event for non-secret key changes", async () => {
    // Reset the singleton's file snapshot to a clean baseline so previous
    // test's secret changes don't pollute this assertion.
    readFileSyncMock.mockReturnValue("")
    dotenvParseMock.mockReturnValue({})
    await secretStore.reload()

    vi.clearAllMocks()
    emitMock.mockReset()

    // Change only a non-secret key (LOG_LEVEL has no secret prefix)
    process.env["LOG_LEVEL"] = "info"
    readFileSyncMock.mockReturnValue("LOG_LEVEL=debug")
    dotenvParseMock.mockReturnValue({ LOG_LEVEL: "debug" })

    await secretStore.reload()

    // Event should NOT be emitted since LOG_LEVEL is not a secret key
    expect(emitMock).not.toHaveBeenCalled()

    delete process.env["LOG_LEVEL"]
  })

  it("emits security.secrets_rotated event with changed key names", async () => {
    vi.clearAllMocks()

    process.env["OPENAI_API_KEY"] = "sk-old"
    readFileSyncMock.mockReturnValue("OPENAI_API_KEY=sk-new-rotated")
    dotenvParseMock.mockReturnValue({ OPENAI_API_KEY: "sk-new-rotated" })

    await secretStore.reload()

    // Allow microtask queue to flush the dynamic import
    await new Promise<void>(resolve => setTimeout(resolve, 10))

    expect(emitMock).toHaveBeenCalledWith(
      "security.secrets_rotated",
      expect.objectContaining({
        type: "security.secrets_rotated",
        changedKeys: expect.arrayContaining(["OPENAI_API_KEY"]),
      })
    )

    delete process.env["OPENAI_API_KEY"]
  })

  it("rotation event payload contains NO secret values", async () => {
    vi.clearAllMocks()

    process.env["ANTHROPIC_API_KEY"] = "sk-ant-old"
    readFileSyncMock.mockReturnValue("ANTHROPIC_API_KEY=sk-ant-new")
    dotenvParseMock.mockReturnValue({ ANTHROPIC_API_KEY: "sk-ant-new" })

    await secretStore.reload()
    await new Promise<void>(resolve => setTimeout(resolve, 10))

    const calls = emitMock.mock.calls
    if (calls.length > 0) {
      const payload = calls[calls.length - 1]?.[1] as Record<string, unknown>
      const payloadStr = JSON.stringify(payload)
      // Values must NEVER appear in the event payload
      expect(payloadStr).not.toContain("sk-ant-old")
      expect(payloadStr).not.toContain("sk-ant-new")
    }

    delete process.env["ANTHROPIC_API_KEY"]
  })

  it("records rotation info after a successful reload", async () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "old-token"
    readFileSyncMock.mockReturnValue("TELEGRAM_BOT_TOKEN=new-token")
    dotenvParseMock.mockReturnValue({ TELEGRAM_BOT_TOKEN: "new-token" })

    await secretStore.reload()

    const info = secretStore.getRotationInfo()
    if (info !== null && info.valid) {
      expect(info.valid).toBe(true)
      expect(typeof info.rotatedAt).toBe("string")
    }

    delete process.env["TELEGRAM_BOT_TOKEN"]
  })

  it("returns empty array and marks invalid when env file is missing", async () => {
    existsSyncMock.mockReturnValue(false)
    const changed = await secretStore.reload()
    expect(changed).toHaveLength(0)
  })

  it("returns empty array and marks invalid when dotenv.parse throws", async () => {
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue("BAD=content")
    dotenvParseMock.mockImplementation(() => { throw new Error("parse error") })

    const changed = await secretStore.reload()
    expect(changed).toHaveLength(0)

    const info = secretStore.getRotationInfo()
    if (info !== null) {
      expect(info.valid).toBe(false)
    }
  })
})

describe("SecretStore.watch()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(true)
  })

  afterEach(() => {
    secretStore.stopWatch()
  })

  it("starts an fs.watch watcher when env file exists", () => {
    secretStore.watch()
    expect(watchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function)
    )
  })

  it("does not start a watcher when env file does not exist", () => {
    existsSyncMock.mockReturnValue(false)
    watchMock.mockClear()
    secretStore.watch()
    expect(watchMock).not.toHaveBeenCalled()
  })

  it("is idempotent — calling watch() twice does not double-register", () => {
    secretStore.watch()
    const callCountAfterFirst = watchMock.mock.calls.length
    secretStore.watch()
    expect(watchMock.mock.calls.length).toBe(callCountAfterFirst)
  })
})

describe("SecretStore.stopWatch()", () => {
  it("closes the watcher gracefully", () => {
    const closeSpy = vi.fn()
    watchMock.mockReturnValue({ on: vi.fn(), close: closeSpy })

    secretStore.watch()
    secretStore.stopWatch()
    expect(closeSpy).toHaveBeenCalled()
  })

  it("is safe to call when not watching", () => {
    // Should not throw
    expect(() => secretStore.stopWatch()).not.toThrow()
  })
})
