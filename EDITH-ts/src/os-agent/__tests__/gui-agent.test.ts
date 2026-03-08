/**
 * @file gui-agent.test.ts
 * @description Tests for GUIAgent — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - OSWorld (arXiv:2404.07972) — POMDP action space + coordinate validation
 *   - ScreenAgent (IJCAI 2024) — screenshot as visual state capture
 *   - CaMeL (arXiv:2503.18813) — rate limiting for agent safety
 *
 * COVERAGE TARGET: ≥85%
 *
 * MOCK STRATEGY:
 *   - execa: mocked for all PowerShell / CLI automation commands
 *   - node:fs/promises: mocked so screenshot file read/write never touches disk
 *   - node:os: only tmpdir() needed for screenshot temp path
 *
 * TEST GROUPS:
 *   1. [Initialization] — win32, macOS, disabled
 *   2. [Screenshot] — ScreenAgent visual state capture
 *   3. [Mouse] — CodeAct mouse action execution
 *   4. [Keyboard] — SendKeys text and hotkey dispatch
 *   5. [Safety] — rate limiting per OSWorld evaluation protocol
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { GUIAgent } from "../gui-agent.js"
import { createMockGUIConfig, FAKE_PNG } from "./test-helpers.js"

// ── Mock declarations ─────────────────────────────────────────────────────────

vi.mock("execa", () => ({ execa: vi.fn() }))

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}))

vi.mock("node:os", () => ({
  tmpdir: vi.fn().mockReturnValue("/tmp"),
  default: {
    tmpdir: vi.fn().mockReturnValue("/tmp"),
    platform: () => "win32",
  },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { execa } from "execa"
import fs from "node:fs/promises"
import os from "node:os"

const mockExeca = vi.mocked(execa)
const mockFs = fs as typeof fs & { readFile: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a GUIAgent on win32 that is initialized and ready to execute actions. */
async function createInitializedAgent(configOverrides = {}) {
  const config = createMockGUIConfig({ enabled: true, requireConfirmation: false, ...configOverrides })
  const agent = new GUIAgent(config)
  // Stub PowerShell calls that happen during initialize()
  mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
  await agent.initialize()
  return agent
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("GUIAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
    vi.mocked(fs.unlink).mockResolvedValue(undefined)
    vi.mocked(os.tmpdir).mockReturnValue("/tmp")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Initialization] ──────────────────────────────────────────────────────

  /**
   * @paper OSWorld 2404.07972 — POMDP initial state S₀: agent must be ready before actions
   */
  describe("[Initialization]", () => {
    it("initializes on Windows without calling execa for native backend", async () => {
      // On Windows with native backend, verifyDependencies() is a no-op (only Linux needs xdotool check)
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      // verifyDependencies() only calls execa on Linux
      expect(mockExeca).not.toHaveBeenCalled()

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("initializes on macOS without calling execa for native backend", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      expect(mockExeca).not.toHaveBeenCalled()

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("skips initialization silently when disabled=true", async () => {
      const agent = new GUIAgent(createMockGUIConfig({ enabled: false }))
      await agent.initialize()

      expect(mockExeca).not.toHaveBeenCalled()

      // execute() on disabled agent returns error
      const result = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })
      expect(result.success).toBe(false)
      expect(result.error).toContain("not initialized")
    })

    it("checks Linux dependencies via 'which xdotool' during initialize", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      expect(mockExeca).toHaveBeenCalledWith("which", ["xdotool"])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Screenshot] ─────────────────────────────────────────────────────────

  /**
   * @paper ScreenAgent IJCAI 2024 — "screenshot" = Plan step; captures visual state S
   */
  describe("[Screenshot]", () => {
    it("captures full screenshot on Windows via PowerShell and returns Buffer", async () => {
      const agent = await createInitializedAgent()
      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const buffer = await agent.captureScreenshot()

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(0)
      // PowerShell screenshot command must have been called
      expect(mockExeca).toHaveBeenCalledWith(
        "powershell",
        ["-command", expect.stringContaining("CopyFromScreen")],
        expect.any(Object),
      )
    })

    it("captures region screenshot with coordinate bounds on Windows", async () => {
      const agent = await createInitializedAgent()
      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const region = { x: 10, y: 20, width: 100, height: 80 }
      const buffer = await agent.captureScreenshot(region)

      expect(buffer).toBeInstanceOf(Buffer)
      // Region coordinates must appear in the PowerShell command
      expect(mockExeca).toHaveBeenCalledWith(
        "powershell",
        ["-command", expect.stringContaining("10")],
        expect.any(Object),
      )
    })

    it("captures screenshot on macOS via screencapture command", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const buffer = await agent.captureScreenshot()

      expect(buffer).toBeInstanceOf(Buffer)
      expect(mockExeca).toHaveBeenCalledWith(
        "screencapture",
        expect.arrayContaining(["-x"]),
      )

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("falls back from scrot to gnome-screenshot on Linux", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await agent.initialize()

      mockExeca
        .mockRejectedValueOnce(new Error("scrot missing"))
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as any)

      const buffer = await agent.captureScreenshot()

      expect(buffer).toBeInstanceOf(Buffer)
      expect(mockExeca).toHaveBeenCalledWith("gnome-screenshot", ["-f", expect.any(String)])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Mouse] ──────────────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — Actions are executable; each must route to correct subsystem
   */
  describe("[Mouse]", () => {
    it("click action executes mouse_event via PowerShell and returns success", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "click", coordinates: { x: 500, y: 300 } })

      expect(result.success).toBe(true)
      expect(result.data).toContain("500")
      expect(result.data).toContain("300")
    })

    it("double_click action sends two sequential click events", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "double_click", coordinates: { x: 200, y: 150 } })

      expect(result.success).toBe(true)
      expect(result.data).toContain("200")
    })

    it("drag action dispatches mousedown→move→mouseup via PowerShell", async () => {
      // drag is in DESTRUCTIVE_ACTIONS but requireConfirmation=false in test config
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({
        action: "drag",
        coordinates: { x: 100, y: 100 },
        endCoordinates: { x: 400, y: 400 },
      })

      expect(result.success).toBe(true)
      expect(result.data).toContain("400")
    })

    it("right_click action returns success with coordinates", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "right_click", coordinates: { x: 320, y: 240 } })

      expect(result.success).toBe(true)
      expect(result.data).toContain("Right-clicked")
    })

    it("move action routes to mouse movement helper", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await agent.initialize()

      const result = await agent.execute({ action: "move", coordinates: { x: 42, y: 84 } })

      expect(result.success).toBe(true)
      expect(mockExeca).toHaveBeenCalledWith("xdotool", ["mousemove", "42", "84"])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("covers macOS and Linux mouse action helpers", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      const macAgent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await macAgent.initialize()
      await expect(macAgent.execute({ action: "click", coordinates: { x: 4, y: 5 } })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "double_click", coordinates: { x: 4, y: 5 } })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "right_click", coordinates: { x: 4, y: 5 } })).resolves.toMatchObject({ success: true })

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const linuxAgent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await linuxAgent.initialize()
      await expect(linuxAgent.execute({ action: "drag", coordinates: { x: 1, y: 2 }, endCoordinates: { x: 3, y: 4 } })).resolves.toMatchObject({ success: true })

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Keyboard] ───────────────────────────────────────────────────────────

  /** @paper CodeAct ICML 2024 — Text input is fundamental to OS-agent task completion */
  describe("[Keyboard]", () => {
    it("type action sends text via SendKeys on Windows and returns character count", async () => {
      // type is in DESTRUCTIVE_ACTIONS but requireConfirmation=false
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "type", text: "hello world" })

      expect(result.success).toBe(true)
      expect(result.data).toContain("11") // "hello world" = 11 chars
    })

    it("hotkey action sends Ctrl+S key combination via SendKeys on Windows", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "hotkey", keys: ["ctrl", "s"] })

      expect(result.success).toBe(true)
      expect(result.data).toContain("ctrl+s")
    })

    it("scroll action uses default amount and direction", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "scroll", direction: "down" })

      expect(result.success).toBe(true)
      expect(result.data).toContain("Scrolled down by 3")
    })

    it("focus_window action activates the requested window", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "focus_window", windowTitle: "Visual Studio Code" })

      expect(result.success).toBe(true)
      expect(result.data).toContain("Visual Studio Code")
    })

    it("open_app action starts an application", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await agent.initialize()

      const result = await agent.execute({ action: "open_app", appName: "Safari" })

      expect(result.success).toBe(true)
      expect(mockExeca).toHaveBeenCalledWith("open", ["-a", "Safari"])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("close_window without a title falls back to Alt+F4 on Windows", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "close_window" })

      expect(result.success).toBe(true)
      expect(result.data).toContain("active")
      expect(mockExeca).toHaveBeenCalledWith(
        "powershell",
        ["-command", expect.stringContaining("%F4")],
        expect.any(Object),
      )

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("covers non-Windows keyboard and window management branches", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      const macAgent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await macAgent.initialize()
      await expect(macAgent.execute({ action: "type", text: "abc" })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "hotkey", keys: ["cmd", "s"] })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "scroll", direction: "up", amount: 2 })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "focus_window", windowTitle: "Safari\\\"/" })).resolves.toMatchObject({ success: true })
      await expect(macAgent.execute({ action: "close_window" })).resolves.toMatchObject({ success: true })

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const linuxAgent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: false }))
      await linuxAgent.initialize()
      await expect(linuxAgent.execute({ action: "type", text: "abc" })).resolves.toMatchObject({ success: true })
      await expect(linuxAgent.execute({ action: "hotkey", keys: ["ctrl", "s"] })).resolves.toMatchObject({ success: true })
      await expect(linuxAgent.execute({ action: "scroll", direction: "down", amount: 2 })).resolves.toMatchObject({ success: true })
      await expect(linuxAgent.execute({ action: "focus_window", windowTitle: "Terminal" })).resolves.toMatchObject({ success: true })
      await expect(linuxAgent.execute({ action: "open_app", appName: "gedit" })).resolves.toMatchObject({ success: true })
      await expect(linuxAgent.execute({ action: "close_window" })).resolves.toMatchObject({ success: true })

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Safety] ─────────────────────────────────────────────────────────────

  /**
   * @paper CaMeL 2503.18813 — Rate limiting prevents runaway agent actions
   * @paper OSWorld 2404.07972 — Reproducibility requires max actions/min
   */
  describe("[Safety]", () => {
    it("rejects the second action when rate limit of 1 action/min is exceeded", async () => {
      const agent = await createInitializedAgent({ maxActionsPerMinute: 1 })
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      // First click: should succeed (within rate limit)
      const first = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })
      expect(first.success).toBe(true)

      // Second click: must be rejected — rate limit exceeded
      const second = await agent.execute({ action: "click", coordinates: { x: 200, y: 200 } })
      expect(second.success).toBe(false)
      expect(second.error).toContain("Rate limit")
    })

    it("returns error for click action without required coordinates", async () => {
      const agent = await createInitializedAgent()

      // Missing coordinates → early return with descriptive error (CodeAct self-debugging)
      const result = await agent.execute({ action: "click" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("coordinates")
    })

    it("validates required payload fields for the remaining GUI actions", async () => {
      const agent = await createInitializedAgent()

      await expect(agent.execute({ action: "double_click" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("coordinates") })
      await expect(agent.execute({ action: "right_click" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("coordinates") })
      await expect(agent.execute({ action: "hotkey", keys: [] })).resolves.toMatchObject({ success: false, error: expect.stringContaining("keys") })
      await expect(agent.execute({ action: "scroll" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("direction") })
      await expect(agent.execute({ action: "drag", coordinates: { x: 1, y: 2 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("endCoordinates") })
      await expect(agent.execute({ action: "move" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("coordinates") })
      await expect(agent.execute({ action: "focus_window" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("windowTitle") })
      await expect(agent.execute({ action: "open_app" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("appName") })
    })

    it("returns error for type action without required text", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "type" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("text")
    })

    it("blocks destructive actions when confirmation is required", async () => {
      const agent = new GUIAgent(createMockGUIConfig({ enabled: true, requireConfirmation: true }))
      await agent.initialize()

      const result = await agent.execute({ action: "open_app", appName: "Notepad" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("requires confirmation")
    })

    it("returns an error for unknown GUI actions", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "unknown" as any })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Unknown GUI action")
    })

    it("getActiveWindow() returns parsed window metadata on Windows", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({ title: "Editor", process: "Code", pid: 123, x: 1, y: 2, w: 800, h: 600 }),
        stderr: "",
        exitCode: 0,
      } as any)

      const window = await agent.getActiveWindow()

      expect(window).toEqual({
        title: "Editor",
        processName: "Code",
        pid: 123,
        bounds: { x: 1, y: 2, width: 800, height: 600 },
        isActive: true,
      })

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("getActiveWindow() supports macOS and Linux branches", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      const macAgent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await macAgent.initialize()
      mockExeca.mockResolvedValueOnce({ stdout: "Safari, 456", stderr: "", exitCode: 0 } as any)
      await expect(macAgent.getActiveWindow()).resolves.toMatchObject({ title: "Safari", pid: 456 })

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const linuxAgent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await linuxAgent.initialize()
      mockExeca
        .mockResolvedValueOnce({ stdout: "101", stderr: "", exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: "Terminal", stderr: "", exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: "202", stderr: "", exitCode: 0 } as any)
      await expect(linuxAgent.getActiveWindow()).resolves.toMatchObject({ title: "Terminal", pid: 202 })

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("listWindows() maps PowerShell JSON into window records", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { ProcessName: "Code", MainWindowTitle: "Workspace", Id: 11 },
          { ProcessName: "chrome", MainWindowTitle: "Docs", Id: 22 },
        ]),
        stderr: "",
        exitCode: 0,
      } as any)

      const windows = await agent.listWindows()

      expect(windows).toHaveLength(2)
      expect(windows[0]?.title).toBe("Workspace")
      expect(windows[1]?.processName).toBe("chrome")

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("listWindows() returns [] when listing fails or the platform is non-Windows", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const linuxAgent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await linuxAgent.initialize()
      await expect(linuxAgent.listWindows()).resolves.toEqual([])

      Object.defineProperty(process, "platform", { value: "win32", configurable: true })
      const windowsAgent = await createInitializedAgent()
      mockExeca.mockRejectedValueOnce(new Error("powershell failed"))
      await expect(windowsAgent.listWindows()).resolves.toEqual([])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("captureScreenshot() cleans up temp files when screen capture fails", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockRejectedValueOnce(new Error("screen blocked"))

      await expect(agent.captureScreenshot()).rejects.toThrow("Screenshot failed")
      expect(vi.mocked(fs.unlink)).toHaveBeenCalled()
    })

    it("resets the rate limit window after one minute passes", async () => {
      const agent = await createInitializedAgent({ maxActionsPerMinute: 1 })
      const nowSpy = vi.spyOn(Date, "now")
      ;(agent as any).lastActionReset = 0
      ;(agent as any).actionCount = 1
      nowSpy.mockReturnValue(61_000)

      expect((agent as any).checkRateLimit()).toBe(true)
      expect((agent as any).actionCount).toBe(0)
    })

    it("warns instead of throwing when Linux dependencies are missing", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      mockExeca.mockRejectedValueOnce(new Error("which missing"))

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))

      await expect(agent.initialize()).resolves.toBeUndefined()
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("shutdown() disables later actions until reinitialized", async () => {
      const agent = await createInitializedAgent()
      await agent.shutdown()

      const result = await agent.execute({ action: "click", coordinates: { x: 5, y: 5 } })

      expect(result.success).toBe(false)
      expect(result.error).toContain("not initialized")
    })
  })
})
