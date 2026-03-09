/**
 * @file service.test.ts
 * @description Unit tests for DaemonManager — verifies correct child-process
 * invocation (no shell injection) and gateway status check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// We DON'T want actual exec calls — mock child_process dynamically
const mockExecFileSync = vi.fn()

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}))

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
    promises: {
      readFile: vi.fn().mockResolvedValue(""),
    },
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(""),
  promises: {
    readFile: vi.fn().mockResolvedValue(""),
  },
}))

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return {
    ...actual,
    platform: vi.fn().mockReturnValue("linux"),
    homedir: vi.fn().mockReturnValue("/home/testuser"),
  }
})

// eslint-disable-next-line import/order
import { platform } from "node:os"
import { daemonManager } from "../service.js"

const mockPlatform = vi.mocked(platform)

describe("DaemonManager.install()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlatform.mockReturnValue("linux")
  })

  it("throws on unsupported platform", async () => {
    mockPlatform.mockReturnValue("freebsd" as NodeJS.Platform)
    await expect(daemonManager.install()).rejects.toThrow("Unsupported platform")
  })

  it("calls execFileSync with array args on Linux (no shell injection)", async () => {
    await daemonManager.install()

    // Should call systemctl 3 times with array args — never a shell string
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"])
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["--user", "enable", "edith"])
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["--user", "start", "edith"])

    // Crucial: ensure no call used shell concatenation (string as second arg instead of array)
    for (const call of mockExecFileSync.mock.calls) {
      expect(Array.isArray(call[1])).toBe(true)
    }
  })
})

describe("DaemonManager.uninstall()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls execFileSync with array args on Linux", async () => {
    mockPlatform.mockReturnValue("linux")
    await daemonManager.uninstall()
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["--user", "disable", "edith"])
    for (const call of mockExecFileSync.mock.calls) {
      expect(Array.isArray(call[1])).toBe(true)
    }
  })

  it("calls execFileSync with array args on Windows", async () => {
    mockPlatform.mockReturnValue("win32")
    await daemonManager.uninstall()
    expect(mockExecFileSync).toHaveBeenCalledWith("schtasks", ["/delete", "/tn", "EDITH Gateway", "/f"])
  })

  it("continues gracefully if the service was never installed", async () => {
    mockPlatform.mockReturnValue("linux")
    mockExecFileSync.mockImplementationOnce(() => { throw new Error("not found") })
    await expect(daemonManager.uninstall()).resolves.not.toThrow()
  })
})

describe("DaemonManager.status()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns running=true when gateway health endpoint responds ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    const status = await daemonManager.status()
    expect(status.running).toBe(true)
    expect(status.platform).toBeDefined()
  })

  it("returns running=false when fetch throws (gateway not running)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch
    const status = await daemonManager.status()
    expect(status.running).toBe(false)
  })

  it("returns running=false when response.ok is false", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    const status = await daemonManager.status()
    expect(status.running).toBe(false)
  })
})
