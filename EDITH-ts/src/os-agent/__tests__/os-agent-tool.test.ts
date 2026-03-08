/**
 * @file os-agent-tool.test.ts
 * @description Tests for createOSAgentTool — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - CodeAct (arXiv:2402.01030, ICML 2024) — Action routing coverage: ∀ a ∈ A routes correctly
 *   - WebArena (arXiv:2307.13854, ICLR 2024) — Functional correctness: test outcomes, not internals
 *   - CaMeL (arXiv:2503.18813) — Dangerous actions must surface errors, not crash
 *
 * COVERAGE TARGET: ≥90%
 *
 * MOCK STRATEGY:
 *   - 'ai': mocked as passthrough tool() so execute() is directly testable
 *   - All OSAgent subsystems: mock objects with vi.fn() methods
 *
 * TEST GROUPS:
 *   1. [Action Routing] — every action routes to correct subsystem (CodeAct coverage matrix)
 *   2. [Validation] — missing required params return error strings, never throw
 *   3. [Error Handling] — subsystem failures surface as error strings
 *   4. [Edge Cases] — perception, list_windows, unknown actions
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { createOSAgentTool } from "../os-agent-tool.js"

// ── Mock declarations ─────────────────────────────────────────────────────────

/** Passthrough mock: tool(config) → config, making execute() directly accessible. */
vi.mock("ai", () => ({
  tool: vi.fn((config: unknown) => config),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a complete mock OSAgent with all subsystems as vi.fn() mocks. */
function buildMockOSAgent() {
  const execute = vi.fn(async (input: any) => {
    if (input?.type === "gui") {
      return {
        success: true,
        data: {
          result: "action completed",
          resolvedElement: input.payload?.targetQuery
            ? { text: "Save", bounds: { x: 10, y: 20, width: 30, height: 40 } }
            : undefined,
          reflection: { summary: "visual reflection confirmed the change" },
        },
      }
    }

    return { success: true, data: {} }
  })

  return {
    execute,
    gui: {
      execute: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: "action completed",
      }),
      listWindows: vi.fn<[], Promise<{ title: string; processName: string }[]>>().mockResolvedValue([
        { title: "VS Code", processName: "code", pid: 1234, bounds: { x: 0, y: 0, width: 800, height: 600 }, isActive: true },
      ]),
      isInitialized: true,
    },
    vision: {
      captureAndAnalyze: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { ocrText: "Hello World", elements: [], screenshotSize: 12345 },
      }),
      isInitialized: true,
    },
    voice: {
      speak: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { textLength: 10, audioBytes: 4000 },
      }),
      isInitialized: true,
    },
    system: {
      state: {
        cpuUsage: 25,
        ramUsage: 60,
        diskUsage: 40,
        topProcesses: ["code", "node"],
        networkConnected: true,
        idleTimeSeconds: 5,
      },
      executeCommand: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { stdout: "command output", stderr: "" },
      }),
      isInitialized: true,
    },
    iot: {
      parseNaturalLanguage: vi.fn<[], Array<{ domain: string; service: string; entityId: string }>>().mockReturnValue([
        { domain: "light", service: "turn_on", entityId: "light.bedroom" },
      ]),
      execute: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: {},
      }),
      isInitialized: true,
    },
    perception: {
      summarize: vi.fn<[], string>().mockReturnValue("System: CPU 25%, RAM 60% | Activity: coding"),
      getSnapshot: vi.fn<[], Promise<any>>().mockResolvedValue({ timestamp: Date.now() }),
    },
    recallVisualMemory: vi.fn<[], Promise<any>>().mockResolvedValue({
      query: "save",
      matches: [{ id: "m1", kind: "visual_reflection", source: "episodic-memory", content: "save reflection", score: 0.9 }],
      summary: ["1. [visual_reflection/episodic-memory] save reflection"],
    }),
    getContextSnapshot: vi.fn<[], Promise<any>>().mockResolvedValue({ timestamp: Date.now() }),
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("createOSAgentTool", () => {
  let mockAgent: ReturnType<typeof buildMockOSAgent>
  let toolDef: { execute: (input: any) => Promise<string>; inputSchema?: any; description?: string }

  beforeEach(() => {
    vi.resetAllMocks()
    mockAgent = buildMockOSAgent()
    // Passthrough mock: tool(config) returns config object, so execute is directly accessible
    toolDef = createOSAgentTool(mockAgent as any) as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Action Routing] ─────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — ∀ a ∈ A: route(a) → correct subsystem
   * Verify the action routing matrix covers all primary action types.
   */
  describe("[Action Routing]", () => {
    it("routes 'click' action through osAgent.execute() with correct coordinates", async () => {
      const result = await toolDef.execute({ action: "click", x: 100, y: 200 })

      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({ action: "click", coordinates: { x: 100, y: 200 } }),
        }),
      )
      expect(typeof result).toBe("string")
      expect(result).toContain("action completed")
    })

    it("routes 'click' with a natural-language target through osAgent.execute()", async () => {
      const result = await toolDef.execute({
        action: "click",
        target: "Save button",
        expectedOutcome: "saved",
      })

      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({
            action: "click",
            targetQuery: "Save button",
            expectedOutcome: "saved",
          }),
        }),
      )
      expect(result).toContain("Grounded target: Save")
      expect(result).toContain("Reflect:")
    })

    it("routes 'type' action through osAgent.execute() with provided text", async () => {
      const result = await toolDef.execute({ action: "type", text: "hello" })

      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({ action: "type", text: "hello" }),
        }),
      )
      expect(typeof result).toBe("string")
    })

    it("routes 'screenshot' to vision.captureAndAnalyze() and returns OCR summary", async () => {
      const result = await toolDef.execute({ action: "screenshot" })

      expect(mockAgent.vision.captureAndAnalyze).toHaveBeenCalledOnce()
      expect(result).toContain("12345") // screenshotSize
      expect(result).toContain("Hello World") // ocrText
    })

    it("routes 'speak' to voice.speak() with provided text", async () => {
      const result = await toolDef.execute({ action: "speak", text: "hello world" })

      expect(mockAgent.voice.speak).toHaveBeenCalledWith("hello world")
      expect(typeof result).toBe("string")
    })

    it("routes 'system_info' to system.state getter and returns JSON", async () => {
      const result = await toolDef.execute({ action: "system_info" })

      // system.state getter was accessed (not a function call in the mock, but the assertion is on the output)
      const parsed = JSON.parse(result)
      expect(parsed.cpuUsage).toBe(25)
      expect(parsed.ramUsage).toBe(60)
    })

    it("routes 'iot' to iot.parseNaturalLanguage() then iot.execute()", async () => {
      const result = await toolDef.execute({ action: "iot", iotCommand: "nyalakan lampu kamar" })

      expect(mockAgent.iot.parseNaturalLanguage).toHaveBeenCalledWith("nyalakan lampu kamar")
      expect(mockAgent.iot.execute).toHaveBeenCalledWith(
        expect.objectContaining({ target: "home_assistant", domain: "light" }),
      )
      expect(result).toContain("light.bedroom")
    })

    it("routes 'shell' to system.executeCommand() and returns stdout", async () => {
      const result = await toolDef.execute({ action: "shell", command: "echo hello" })

      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("echo hello")
      expect(result).toBe("command output")
    })

    it("returns stderr or a no-output fallback for shell commands without stdout", async () => {
      mockAgent.system.executeCommand
        .mockResolvedValueOnce({ success: true, data: { stdout: "", stderr: "warning" } })
        .mockResolvedValueOnce({ success: true, data: { stdout: "", stderr: "" } })

      await expect(toolDef.execute({ action: "shell", command: "warn" })).resolves.toBe("warning")
      await expect(toolDef.execute({ action: "shell", command: "silent" })).resolves.toBe("(no output)")
    })

    it("routes 'open_app' through osAgent.execute() with appName", async () => {
      const result = await toolDef.execute({ action: "open_app", name: "Notepad" })

      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({ action: "open_app", appName: "Notepad" }),
        }),
      )
      expect(typeof result).toBe("string")
    })

    it("routes 'visual_memory' to recallVisualMemory()", async () => {
      const result = await toolDef.execute({ action: "visual_memory", text: "save flow", limit: 3 })

      expect(mockAgent.recallVisualMemory).toHaveBeenCalledWith("save flow", 3)
      expect(result).toContain("visual_reflection")
      expect(result).toContain("save reflection")
    })

    it("routes 'perception' to perception.summarize() without refreshing", async () => {
      const result = await toolDef.execute({ action: "perception" })

      expect(mockAgent.perception.summarize).toHaveBeenCalledOnce()
      expect(result).toContain("CPU 25%")
    })

    it("routes 'double_click' and 'right_click' through osAgent.execute()", async () => {
      await toolDef.execute({ action: "double_click", x: 9, y: 8 })
      await toolDef.execute({ action: "right_click", x: 7, y: 6 })

      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({ action: "double_click", coordinates: { x: 9, y: 8 } }),
        }),
      )
      expect(mockAgent.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gui",
          payload: expect.objectContaining({ action: "right_click", coordinates: { x: 7, y: 6 } }),
        }),
      )
    })

    it("routes 'hotkey', 'scroll', 'focus_window', and 'close_window' through osAgent.execute()", async () => {
      await toolDef.execute({ action: "hotkey", keys: ["ctrl", "shift", "esc"] })
      await toolDef.execute({ action: "scroll", direction: "up", amount: 5 })
      await toolDef.execute({ action: "focus_window", name: "Terminal" })
      await toolDef.execute({ action: "close_window", name: "Terminal" })

      expect(mockAgent.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "gui", payload: expect.objectContaining({ action: "hotkey", keys: ["ctrl", "shift", "esc"] }) }))
      expect(mockAgent.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "gui", payload: expect.objectContaining({ action: "scroll", direction: "up", amount: 5 }) }))
      expect(mockAgent.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "gui", payload: expect.objectContaining({ action: "focus_window", windowTitle: "Terminal" }) }))
      expect(mockAgent.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "gui", payload: expect.objectContaining({ action: "close_window", windowTitle: "Terminal" }) }))
    })
  })

  // ── [Validation] ─────────────────────────────────────────────────────────

  /**
   * @paper WebArena ICLR 2024 — Agent needs descriptive errors for self-correction
   * @paper CaMeL 2503.18813 — Missing params must surface errors, not crash
   */
  describe("[Validation]", () => {
    it("returns coordinate-or-target validation error for click without x/y", async () => {
      const result = await toolDef.execute({ action: "click" })

      expect(result).toContain("Error:")
      expect(result).toContain("coordinates")
      expect(mockAgent.execute).not.toHaveBeenCalled()
    })

    it("returns 'Error: text required' for type action without text", async () => {
      const result = await toolDef.execute({ action: "type" })

      expect(result).toContain("Error:")
      expect(result).toContain("text")
      expect(mockAgent.execute).not.toHaveBeenCalled()
    })

    it("returns error for 'shell' action without command", async () => {
      const result = await toolDef.execute({ action: "shell" })

      expect(result).toContain("Error:")
      expect(result).toContain("command")
      expect(mockAgent.system.executeCommand).not.toHaveBeenCalled()
    })

    it("returns error for 'iot' action without iotCommand", async () => {
      const result = await toolDef.execute({ action: "iot" })

      expect(result).toContain("Error:")
      expect(mockAgent.iot.parseNaturalLanguage).not.toHaveBeenCalled()
    })

    it("returns error for 'speak' action without text", async () => {
      const result = await toolDef.execute({ action: "speak" })

      expect(result).toContain("Error:")
      expect(mockAgent.voice.speak).not.toHaveBeenCalled()
    })

    it("returns a parse failure when iot natural language produces no commands", async () => {
      mockAgent.iot.parseNaturalLanguage.mockReturnValue([])

      const result = await toolDef.execute({ action: "iot", iotCommand: "do something impossible" })

      expect(result).toContain("Could not parse IoT command")
      expect(mockAgent.iot.execute).not.toHaveBeenCalled()
    })
  })

  // ── [Error Handling] ─────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — Self-debugging: error messages must be actionable
   */
  describe("[Error Handling]", () => {
    it("returns error string when vision.captureAndAnalyze() fails", async () => {
      mockAgent.vision.captureAndAnalyze.mockResolvedValue({
        success: false,
        error: "Screen capture permission denied",
      })

      const result = await toolDef.execute({ action: "screenshot" })

      expect(result).toContain("Screenshot failed")
      expect(result).toContain("permission denied")
    })

    it("returns error string when gui.execute() fails — no throw to LLM", async () => {
      mockAgent.execute.mockResolvedValueOnce({
        success: false,
        error: "element not found",
      })

      const result = await toolDef.execute({ action: "click", x: 999, y: 999 })

      expect(result).toContain("Failed:")
      expect(result).toContain("element not found")
    })

    it("returns error string when voice.speak() fails — no throw to LLM", async () => {
      mockAgent.voice.speak.mockResolvedValue({
        success: false,
        error: "TTS engine unavailable",
      })

      const result = await toolDef.execute({ action: "speak", text: "hello" })

      expect(result).toContain("TTS failed")
      expect(result).toContain("unavailable")
    })

    it("returns command failures from shell execution", async () => {
      mockAgent.system.executeCommand.mockResolvedValue({
        success: false,
        error: "permission denied",
      })

      const result = await toolDef.execute({ action: "shell", command: "rm -rf /" })

      expect(result).toBe("Command failed: permission denied")
    })
  })

  // ── [Edge Cases] ─────────────────────────────────────────────────────────

  describe("[Edge Cases]", () => {
    it("list_windows returns formatted window list", async () => {
      const result = await toolDef.execute({ action: "list_windows" })

      expect(mockAgent.gui.listWindows).toHaveBeenCalledOnce()
      expect(result).toContain("VS Code")
      expect(result).toContain("code") // processName
    })

    it("list_windows returns 'No windows found' when list is empty", async () => {
      mockAgent.gui.listWindows.mockResolvedValue([])

      const result = await toolDef.execute({ action: "list_windows" })

      expect(result).toBe("No windows found")
    })

    it("active_context calls getContextSnapshot() then perception.summarize()", async () => {
      const result = await toolDef.execute({ action: "active_context" })

      expect(mockAgent.getContextSnapshot).toHaveBeenCalledOnce()
      expect(mockAgent.perception.summarize).toHaveBeenCalledOnce()
      expect(result).toContain("CPU 25%")
    })

    it("tool has correct inputSchema with action enum that includes all major actions", () => {
      expect(toolDef.inputSchema).toBeDefined()
      // inputSchema is a Zod object; verify it can parse valid input
      const parsed = toolDef.inputSchema.safeParse({ action: "screenshot" })
      expect(parsed.success).toBe(true)
    })

    it("tool description string mentions the major action categories", () => {
      expect(toolDef.description).toBeDefined()
      expect(toolDef.description).toContain("screenshot")
      expect(toolDef.description).toContain("click")
    })

    it("clipboard_read uses platform-specific command routing", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      await toolDef.execute({ action: "clipboard_read" })
      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("Get-Clipboard")

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      await toolDef.execute({ action: "clipboard_read" })
      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("pbpaste")

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("clipboard_write uses direct command on Windows and piped command elsewhere", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })
      await toolDef.execute({ action: "clipboard_write", text: "hello" })
      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("Set-Clipboard -Value 'hello'")

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      await toolDef.execute({ action: "clipboard_write", text: "hello linux" })
      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith(expect.stringContaining("xclip -selection clipboard"))

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("clipboard operations surface subsystem failures", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "win32", configurable: true })
      mockAgent.system.executeCommand.mockResolvedValueOnce({ success: false, error: "clipboard locked" })
      await expect(toolDef.execute({ action: "clipboard_write", text: "hello" })).resolves.toBe("Failed: clipboard locked")

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      mockAgent.system.executeCommand.mockResolvedValueOnce({ success: false, error: "xclip missing" })
      await expect(toolDef.execute({ action: "clipboard_write", text: "hello" })).resolves.toBe("Failed: xclip missing")

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("surfaces unexpected tool exceptions as OS-Agent error strings", async () => {
      mockAgent.execute.mockRejectedValueOnce(new Error("boom"))

      const result = await toolDef.execute({ action: "click", x: 1, y: 2 })

      expect(result).toContain("OS-Agent error:")
      expect(result).toContain("boom")
    })

    it("returns the default branch for unsupported actions", async () => {
      const result = await toolDef.execute({ action: "unsupported" as any })

      expect(result).toBe("Unknown action: unsupported")
    })
  })
})
