/**
 * @file sandbox.test.ts
 * @description Unit tests for PermissionSandbox — permission checking, auth context
 * enforcement, quiet-hours gating, and high-risk action confirmation flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../gateway/auth-middleware.js", () => ({
  isAuthorizedSender: vi.fn().mockReturnValue(true),
}))

import { PermissionSandbox, PermissionAction } from "../sandbox.js"
import { isAuthorizedSender } from "../../gateway/auth-middleware.js"

const mockIsAuthorized = vi.mocked(isAuthorizedSender)

/** Build a minimal in-memory YAML config object for injection via load(). */
function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messaging: { enabled: true },
    proactive: { enabled: true },
    file_system: { enabled: true, read: true, write: true },
    terminal: { enabled: true },
    calendar: { enabled: true, read: true, write: true },
    search: { enabled: true },
    browsing: { enabled: true },
    ...overrides,
  }
}

async function buildSandbox(config = makeConfig()): Promise<PermissionSandbox> {
  const box = new PermissionSandbox()
  // Inject config directly by calling load() with a temp file via monkey-patch
  // since load() reads from disk. We override configProp directly for test isolation.
  ;(box as unknown as { config: unknown }).config = config
  return box
}

describe("PermissionSandbox.check()", () => {
  beforeEach(() => {
    mockIsAuthorized.mockReturnValue(true)
  })

  it("allows action when section is enabled", async () => {
    const box = await buildSandbox()
    const allowed = await box.check(PermissionAction.SEND_MESSAGE, "user1")
    expect(allowed).toBe(true)
  })

  it("denies action when section is disabled", async () => {
    const box = await buildSandbox(makeConfig({ messaging: { enabled: false } }))
    const allowed = await box.check(PermissionAction.SEND_MESSAGE, "user1")
    expect(allowed).toBe(false)
  })

  it("denies action when section is missing entirely", async () => {
    const box = await buildSandbox({})
    const allowed = await box.check(PermissionAction.SEND_MESSAGE, "user1")
    expect(allowed).toBe(false)
  })

  it("denies when isAuthorizedSender returns false", async () => {
    mockIsAuthorized.mockReturnValue(false)
    const box = await buildSandbox()
    const allowed = await box.check(PermissionAction.SEND_MESSAGE, "user1", {
      senderId: "stranger",
      channel: "telegram",
      authenticated: false,
    })
    expect(allowed).toBe(false)
  })

  it("denies high-risk action when not authenticated", async () => {
    const box = await buildSandbox()
    const allowed = await box.check(PermissionAction.FILE_WRITE, "user1", {
      senderId: "user1",
      channel: "telegram",
      authenticated: false,
    })
    expect(allowed).toBe(false)
  })

  it("allows high-risk action when authenticated", async () => {
    const box = await buildSandbox()
    const allowed = await box.check(PermissionAction.FILE_WRITE, "user1", {
      senderId: "user1",
      channel: "telegram",
      authenticated: true,
    })
    expect(allowed).toBe(true)
  })

  it("denies during quiet hours", async () => {
    const now = new Date()
    // Set quiet hours that include now
    const start = new Date(now.getTime() - 60 * 60 * 1000)
    const end = new Date(now.getTime() + 60 * 60 * 1000)
    const startStr = start.toTimeString().slice(0, 5)
    const endStr = end.toTimeString().slice(0, 5)

    const box = await buildSandbox(
      makeConfig({ messaging: { enabled: true, quiet_hours: { start: startStr, end: endStr } } }),
    )
    const allowed = await box.check(PermissionAction.SEND_MESSAGE, "user1")
    expect(allowed).toBe(false)
  })

  it("returns false for unknown action strings", async () => {
    const box = await buildSandbox()
    // Cast to bypass TS checking — simulates unknown future action
    const allowed = await box.check("nonexistent.action" as PermissionAction, "user1")
    expect(allowed).toBe(false)
  })
})

describe("PermissionSandbox.checkWithConfirm()", () => {
  beforeEach(() => {
    mockIsAuthorized.mockReturnValue(true)
  })

  it("returns false when channelManager is not set and confirm is required", async () => {
    const box = await buildSandbox(makeConfig({ terminal: { enabled: true, require_confirm: true } }))
    // No channelManager set
    const allowed = await box.checkWithConfirm(PermissionAction.TERMINAL_RUN, "user1", "run npm test")
    expect(allowed).toBe(false)
  })

  it("delegates to channelManager.sendWithConfirm when section has require_confirm", async () => {
    const box = await buildSandbox(makeConfig({ terminal: { enabled: true, require_confirm: true } }))
    const mockSendWithConfirm = vi.fn().mockResolvedValue(true)
    box.setChannelManager({ sendWithConfirm: mockSendWithConfirm })

    const allowed = await box.checkWithConfirm(PermissionAction.TERMINAL_RUN, "user1", "run tests")
    expect(allowed).toBe(true)
    expect(mockSendWithConfirm).toHaveBeenCalledOnce()
    // Third argument is the PermissionAction string ("terminal.run")
    expect(mockSendWithConfirm.mock.calls[0]?.[2]).toBe("terminal.run")
  })

  it("denies without channelManager even for high-risk actions", async () => {
    const box = await buildSandbox()
    // FILE_WRITE is high-risk — always requires confirmation
    const allowed = await box.checkWithConfirm(PermissionAction.FILE_WRITE, "user1", "write to /tmp/test")
    expect(allowed).toBe(false)
  })
})

describe("PermissionSandbox.getSection()", () => {
  it("returns the section for a known action", async () => {
    const box = await buildSandbox()
    const section = box.getSection(PermissionAction.SEND_MESSAGE)
    expect(section).not.toBeNull()
    expect(section?.enabled).toBe(true)
  })

  it("returns null for unknown actions", async () => {
    const box = await buildSandbox()
    const section = box.getSection("totally.unknown" as PermissionAction)
    expect(section).toBeNull()
  })
})

describe("PermissionSandbox.isHighRiskAction()", () => {
  it("considers FILE_WRITE, TERMINAL_RUN, CALENDAR_WRITE as high-risk", async () => {
    const box = await buildSandbox()
    const highRiskCheck = (action: PermissionAction): boolean =>
      (box as unknown as { isHighRiskAction: (a: PermissionAction) => boolean }).isHighRiskAction(action)

    expect(highRiskCheck(PermissionAction.FILE_WRITE)).toBe(true)
    expect(highRiskCheck(PermissionAction.TERMINAL_RUN)).toBe(true)
    expect(highRiskCheck(PermissionAction.CALENDAR_WRITE)).toBe(true)
    expect(highRiskCheck(PermissionAction.SEND_MESSAGE)).toBe(false)
    expect(highRiskCheck(PermissionAction.FILE_READ)).toBe(false)
  })
})
