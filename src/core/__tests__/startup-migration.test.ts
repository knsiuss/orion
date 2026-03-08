/**
 * @file startup-migration.test.ts
 * @description Tests for the startup migration helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockExec } = vi.hoisted(() => ({ mockExec: vi.fn() }))

vi.mock("node:child_process", () => ({ exec: mockExec }))
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}))

// Mock config — enabled by default
vi.mock("../../config.js", () => {
  const cfg = { RUN_MIGRATIONS_ON_STARTUP: true }
  return {
    default: cfg,
    config: cfg,
  }
})

import { runMigrationsIfEnabled } from "../startup.js"

describe("runMigrationsIfEnabled", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls prisma migrate deploy when enabled", async () => {
    mockExec.mockImplementation((_cmd: string, cb: (err: null, stdout: string) => void) => {
      cb(null, "Migration applied")
    })
    await expect(runMigrationsIfEnabled()).resolves.not.toThrow()
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("prisma migrate deploy"),
      expect.any(Function)
    )
  })

  it("does not crash when migration fails — resolves gracefully", async () => {
    mockExec.mockImplementation((_cmd: string, cb: (err: Error) => void) => {
      cb(new Error("Migration failed"))
    })
    await expect(runMigrationsIfEnabled()).resolves.not.toThrow()
  })
})
