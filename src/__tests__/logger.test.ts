/**
 * @file logger.test.ts
 * @description Unit tests for logger.ts pure functions — mirrors openclaw's logger.test.ts pattern.
 *
 * Only verifies the exported pure helpers (buildLogFilename, pruneOldLogs) and
 * the createLogger scope/level contract. File I/O tests use a real temp directory.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildLogFilename, createLogger, pruneOldLogs } from "../logger.js"

// ---------------------------------------------------------------------------
// buildLogFilename
// ---------------------------------------------------------------------------

describe("buildLogFilename", () => {
  it("formats YYYY-MM-DD correctly", () => {
    const name = buildLogFilename(new Date("2026-03-09T10:00:00Z"))
    expect(name).toBe("edith-2026-03-09.log")
  })

  it("zero-pads single-digit month and day", () => {
    const name = buildLogFilename(new Date("2026-01-05T00:00:00Z"))
    expect(name).toBe("edith-2026-01-05.log")
  })

  it("returns a string matching the expected pattern", () => {
    const name = buildLogFilename(new Date())
    expect(name).toMatch(/^edith-\d{4}-\d{2}-\d{2}\.log$/)
  })
})

// ---------------------------------------------------------------------------
// pruneOldLogs
// ---------------------------------------------------------------------------

describe("pruneOldLogs", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-logger-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("deletes files older than retainDays", () => {
    const oldFile = path.join(tmpDir, "edith-2020-01-01.log")
    fs.writeFileSync(oldFile, "old")

    pruneOldLogs(tmpDir, new Date("2026-03-09T00:00:00Z"), 7)

    expect(fs.existsSync(oldFile)).toBe(false)
  })

  it("keeps files within the retention window", () => {
    const recentFile = path.join(tmpDir, "edith-2026-03-08.log")
    fs.writeFileSync(recentFile, "recent")

    pruneOldLogs(tmpDir, new Date("2026-03-09T00:00:00Z"), 7)

    expect(fs.existsSync(recentFile)).toBe(true)
  })

  it("ignores files that do not match the log pattern", () => {
    const unrelated = path.join(tmpDir, "other.txt")
    fs.writeFileSync(unrelated, "data")

    pruneOldLogs(tmpDir, new Date("2026-03-09T00:00:00Z"), 7)

    expect(fs.existsSync(unrelated)).toBe(true)
  })

  it("does not throw when directory does not exist", () => {
    expect(() => {
      pruneOldLogs(path.join(os.tmpdir(), "edith-nonexistent-dir-xyz"), new Date(), 7)
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

describe("createLogger", () => {
  it("returns an object with debug/info/warn/error methods", () => {
    const log = createLogger("test.scope")
    expect(typeof log.debug).toBe("function")
    expect(typeof log.info).toBe("function")
    expect(typeof log.warn).toBe("function")
    expect(typeof log.error).toBe("function")
  })

  it("routes info to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const log = createLogger("test.stdout")
    log.info("hello stdout")
    expect(write.mock.calls.some((args) => String(args[0]).includes("hello stdout"))).toBe(true)
    write.mockRestore()
  })

  it("routes error to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const log = createLogger("test.stderr")
    log.error("hello stderr")
    expect(write.mock.calls.some((args) => String(args[0]).includes("hello stderr"))).toBe(true)
    write.mockRestore()
  })

  it("includes the scope in the formatted line", () => {
    const lines: string[] = []
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    const log = createLogger("my.module")
    log.info("scope check")
    expect(lines.join("")).toContain("[my.module]")
    write.mockRestore()
  })
})
