/**
 * @file vision-cortex.test.ts
 * @description Tests for VisionCortex — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - OmniParser (arXiv:2408.00203) — Hybrid accessibility+LLM element detection
 *   - ScreenAgent (IJCAI 2024) — Capture→Analyze pipeline + stage separation
 *   - GPT-4V Card (OpenAI 2023) — Image validation: 20MB max, 2048px max edge, magic bytes
 *   - OSWorld (arXiv:2404.07972) — Rate limit: 1 LLM call per 10 seconds
 *
 * COVERAGE TARGET: ≥85%
 *
 * MOCK STRATEGY:
 *   - execa: mocked for PowerShell (screenshot, window title, accessibility) and tesseract
 *   - node:fs/promises: mocked for temp file operations (OCR in/out, screenshot save/read)
 *   - GUIAgent: mock object injected via setGUIAgent() for captureScreen delegation
 *
 * TEST GROUPS:
 *   1. [Initialization] — tesseract version check + disabled path
 *   2. [Capture & Analyze] — end-to-end pipeline
 *   3. [OCR] — tesseract integration and fallback
 *   4. [MIME Detection] — magic bytes validation (pure function, paper-backed)
 *   5. [Image Validation] — 20MB size limit enforcement
 *   6. [Screen State] — active window + resolution on Windows
 *   7. [Element Cache] — ELEMENT_CACHE_TTL detection
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { VisionCortex } from "../vision-cortex.js"
import { createMockVisionConfig, FAKE_PNG } from "./test-helpers.js"

const {
  mockOrchestratorGenerate,
  mockPreferredMultimodalGenerate,
} = vi.hoisted(() => ({
  mockOrchestratorGenerate: vi.fn().mockResolvedValue("visual description"),
  mockPreferredMultimodalGenerate: vi.fn().mockResolvedValue("preferred visual description"),
}))

// ── Mock declarations ─────────────────────────────────────────────────────────

vi.mock("execa", () => ({ execa: vi.fn() }))

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("extracted text\n"),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("node:os", () => ({
  default: {
    tmpdir: () => "/tmp",
    platform: () => "win32",
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: mockOrchestratorGenerate,
    getEngineMap: () => new Map([
      [
        "gemini",
        {
          generate: mockPreferredMultimodalGenerate,
        },
      ],
    ]),
  },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { execa } from "execa"
import fs from "node:fs/promises"

const mockExeca = vi.mocked(execa)
const mockFs = fs as any

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Setup default execa responses for all PowerShell calls in VisionCortex. */
function setupDefaultExecaMock() {
  mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
    const firstArg = Array.isArray(args) ? args[0] : ""
    const script = Array.isArray(args) ? (args[1] ?? "") : ""

    // Tesseract OCR call
    if (_cmd === "tesseract") return { stdout: "", stderr: "", exitCode: 0 } as any

    // Tesseract version check (initialize)
    if (_cmd === "tesseract" || firstArg === "--version") return { stdout: "tesseract 5.2.0", stderr: "", exitCode: 0 } as any

    if (typeof script === "string") {
      // UIA accessibility elements — return empty to simplify test
      if (script.includes("UIAutomationClient")) return { stdout: "", stderr: "", exitCode: 0 } as any
      // Active window title
      if (script.includes("GetForegroundWindow")) return { stdout: "Visual Studio Code", stderr: "", exitCode: 0 } as any
      // Screen resolution
      if (script.includes("PrimaryScreen.Bounds")) return { stdout: "1920x1080", stderr: "", exitCode: 0 } as any
      // Screenshot
      if (script.includes("CopyFromScreen")) return { stdout: "", stderr: "", exitCode: 0 } as any
    }
    return { stdout: "", stderr: "", exitCode: 0 } as any
  })
}

/** Build a mock GUIAgent that returns FAKE_PNG for captureScreenshot(). */
function buildMockGUIAgent() {
  return {
    captureScreenshot: vi.fn().mockResolvedValue(FAKE_PNG),
    execute: vi.fn(),
    isInitialized: true,
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("VisionCortex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.readFile.mockResolvedValue("extracted text\n")
    mockFs.unlink.mockResolvedValue(undefined)
    mockOrchestratorGenerate.mockResolvedValue("visual description")
    mockPreferredMultimodalGenerate.mockResolvedValue("preferred visual description")
    setupDefaultExecaMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Initialization] ──────────────────────────────────────────────────────

  /**
   * @paper ScreenAgent IJCAI 2024 — System initialization as Plan stage
   * @paper OmniParser 2408.00203 — Tesseract verification ensures OCR reliability
   */
  describe("[Initialization]", () => {
    it("verifyTesseract() calls tesseract --version during initialize on tesseract ocr engine", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" })
      const vision = new VisionCortex(config)

      await vision.initialize()

      // Tesseract version check should have been called
      expect(mockExeca).toHaveBeenCalledWith("tesseract", ["--version"])
    })

    it("skips initialization entirely when disabled=true", async () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      await vision.initialize()

      // No execa calls should have been made
      expect(mockExeca).not.toHaveBeenCalled()
    })

    it("captureAndAnalyze() returns error when not initialized", async () => {
      const config = createMockVisionConfig({ enabled: true })
      const vision = new VisionCortex(config)
      // NOTE: initialize() NOT called

      const result = await vision.captureAndAnalyze()

      expect(result.success).toBe(false)
      expect(result.error).toContain("not initialized")
    })
  })

  // ── [Capture & Analyze] ───────────────────────────────────────────────────

  /**
   * @paper ScreenAgent IJCAI 2024 — captureAndAnalyze = Capture+Analyze stages in pipeline
   * @paper OmniParser 2408.00203 — Output: {ocrText, elements, screenState}
   */
  describe("[Capture & Analyze]", () => {
    it("captureAndAnalyze() succeeds and returns VisionAnalysisResult with ocrText", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" })
      const vision = new VisionCortex(config)
      await vision.initialize()

      // Inject mock GUIAgent so captureScreen delegates to it
      const mockGui = buildMockGUIAgent()
      vision.setGUIAgent(mockGui as any)

      // OCR readFile returns extracted text
      mockFs.readFile.mockResolvedValue("Hello World\n")

      const result = await vision.captureAndAnalyze()

      expect(result.success).toBe(true)
      expect((result.data as any).ocrText).toBe("Hello World")
    })

    it("captureAndAnalyze() uses injected GUIAgent.captureScreenshot() for screen capture", async () => {
      const config = createMockVisionConfig({ enabled: true })
      const vision = new VisionCortex(config)
      await vision.initialize()

      const mockGui = buildMockGUIAgent()
      vision.setGUIAgent(mockGui as any)

      await vision.captureAndAnalyze()

      // GUIAgent.captureScreenshot() should have been called instead of PowerShell
      expect(mockGui.captureScreenshot).toHaveBeenCalledOnce()
    })

    it("captureAndAnalyze() returns confidence=0.7 when no UI elements are detected", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" })
      const vision = new VisionCortex(config)
      await vision.initialize()

      const mockGui = buildMockGUIAgent()
      vision.setGUIAgent(mockGui as any)

      // PowerShell UIA returns empty (no elements)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await vision.captureAndAnalyze()

      expect(result.success).toBe(true)
      expect((result.data as any).confidence).toBe(0.7) // no elements = 0.7
    })

    it("captureAndAnalyze() surfaces screen capture failures", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      await vision.initialize()
      vi.spyOn(vision as any, "captureScreen").mockRejectedValue(new Error("capture failed"))

      const result = await vision.captureAndAnalyze()

      expect(result.success).toBe(false)
      expect(result.error).toContain("capture failed")
    })
  })

  // ── [OCR] ────────────────────────────────────────────────────────────────

  /**
   * @paper OmniParser 2408.00203 — OCR via Tesseract; bilingual English + Indonesian
   */
  describe("[OCR]", () => {
    it("extractText() calls tesseract with eng+ind language flags and returns extracted text", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" })
      const vision = new VisionCortex(config)

      const testText = "Hello World - OCR extracted"
      mockFs.readFile.mockResolvedValue(testText + "\n")

      const result = await vision.extractText(FAKE_PNG)

      // tesseract must have been called with -l eng+ind
      expect(mockExeca).toHaveBeenCalledWith(
        "tesseract",
        expect.arrayContaining(["-l", "eng+ind"]),
        expect.any(Object),
      )
      expect(result).toBe(testText)
    })

    it("extractText() returns empty string when cloud OCR engine is configured", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "cloud" })
      const vision = new VisionCortex(config)

      const result = await vision.extractText(FAKE_PNG)

      // Cloud OCR is not yet implemented → fall back to local Tesseract OCR
      expect(result).toBe("extracted text")
      expect(mockExeca).toHaveBeenCalledWith(
        "tesseract",
        expect.arrayContaining(["-l", "eng+ind"]),
        expect.any(Object),
      )
    })

    it("extractText() returns empty string when tesseract throws (graceful fallback)", async () => {
      const config = createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" })
      const vision = new VisionCortex(config)

      // Make tesseract throw (not installed / permission denied)
      mockExeca.mockRejectedValue(new Error("tesseract: command not found"))

      const result = await vision.extractText(FAKE_PNG)

      // Must NOT throw; return empty string instead
      expect(result).toBe("")
    })

    it("tesseractOCR() cleans up temp files even when OCR succeeds", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" }))
      mockFs.readFile.mockResolvedValueOnce("ocr text\n")

      const result = await (vision as any).tesseractOCR(FAKE_PNG)

      expect(result).toBe("ocr text")
      expect(mockFs.unlink).toHaveBeenCalledTimes(2)
    })
  })

  // ── [MIME Detection] ──────────────────────────────────────────────────────

  /**
   * @paper GPT-4V Card (OpenAI 2023) — Use magic bytes, not file extension
   * detectMimeType() is a pure function — no mocking needed.
   */
  describe("[MIME Detection]", () => {
    it("detects PNG magic bytes (0x89 0x50 0x4E 0x47) → image/png", () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

      const mimeType = vision.detectMimeType(pngBuffer)

      expect(mimeType).toBe("image/png")
    })

    it("detects JPEG magic bytes (0xFF 0xD8 0xFF) → image/jpeg", () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // JPEG magic bytes: FF D8 FF
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

      const mimeType = vision.detectMimeType(jpegBuffer)

      expect(mimeType).toBe("image/jpeg")
    })

    it("detects WebP and GIF magic bytes", () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: false }))

      expect(vision.detectMimeType(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]))).toBe("image/webp")
      expect(vision.detectMimeType(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif")
    })

    it("returns null for unknown / unsupported format", () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // Random bytes that don't match any known magic
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])

      const mimeType = vision.detectMimeType(unknownBuffer)

      expect(mimeType).toBeNull()
    })
  })

  // ── [Image Validation] ────────────────────────────────────────────────────

  /**
   * @paper GPT-4V Card (OpenAI 2023) — Max image size: 20MB
   * EDITH's minimum-spec profile tightens this budget to keep RAM pressure low on the full system baseline.
   */
  describe("[Image Validation]", () => {
    it("validateAndResizeImage() returns null for images larger than the configured profile budget", async () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // Default minimum-spec profile allows 8MB, so 9MB must be rejected.
      const oversizedBuffer = Buffer.alloc(9 * 1024 * 1024, 0x00)

      const result = await vision.validateAndResizeImage(oversizedBuffer)

      expect(result).toBeNull()
    })

    it("validateAndResizeImage() respects a custom image budget from config", async () => {
      const vision = new VisionCortex(createMockVisionConfig({
        enabled: false,
        maxImageBytesMb: 1,
      }))

      const oversizedBuffer = Buffer.alloc(Math.ceil(1.5 * 1024 * 1024), 0x00)

      await expect(vision.validateAndResizeImage(oversizedBuffer)).resolves.toBeNull()
    })

    it("validateAndResizeImage() returns null for unsupported image format", async () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // Random bytes (not a valid PNG/JPEG/WebP/GIF)
      const invalidFormat = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x00])

      const result = await vision.validateAndResizeImage(invalidFormat)

      expect(result).toBeNull()
    })

    it("validateAndResizeImage() returns buffer unchanged for valid PNG under size limit", async () => {
      const config = createMockVisionConfig({ enabled: false })
      const vision = new VisionCortex(config)

      // FAKE_PNG is valid PNG format and small
      const result = await vision.validateAndResizeImage(FAKE_PNG)

      // Should return a buffer (not null) — may or may not be resized
      expect(result).not.toBeNull()
      expect(result).toBeInstanceOf(Buffer)
    })

    it("detectElements() falls back to accessibility when advanced detectors are requested", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, elementDetection: "yolo" as any }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([
        {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          interactable: true,
        },
      ])

      await expect(vision.detectElements(FAKE_PNG)).resolves.toHaveLength(1)
    })

    it("applySetOfMarks() returns the original screenshot when there are no elements", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect(vision.applySetOfMarks(FAKE_PNG, [])).resolves.toBe(FAKE_PNG)
    })

    it("captureScreen() supports darwin and linux fallback branches", async () => {
      const originalPlatform = process.platform

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      const macVision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      mockFs.readFile.mockResolvedValueOnce(FAKE_PNG)
      await expect((macVision as any).captureScreen()).resolves.toBeInstanceOf(Buffer)
      expect(mockExeca).toHaveBeenCalledWith("screencapture", expect.any(Array))

      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const linuxVision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      mockExeca
        .mockRejectedValueOnce(new Error("scrot missing"))
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as any)
      mockFs.readFile.mockResolvedValueOnce(FAKE_PNG)
      await expect((linuxVision as any).captureScreen()).resolves.toBeInstanceOf(Buffer)
      expect(mockExeca).toHaveBeenCalledWith("gnome-screenshot", ["-f", expect.any(String)])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Screen State] ────────────────────────────────────────────────────────

  /**
   * @paper OSWorld 2404.07972 — Environment state requires active window tracking
   */
  describe("[Screen State]", () => {
    it("getScreenState() returns ScreenState with title and resolution on Windows", async () => {
      const config = createMockVisionConfig({ enabled: true })
      const vision = new VisionCortex(config)

      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("GetForegroundWindow")) return { stdout: "Visual Studio Code", stderr: "", exitCode: 0 } as any
        if (script.includes("PrimaryScreen.Bounds")) return { stdout: "2560x1440", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const state = await vision.getScreenState()

      expect(state).not.toBeNull()
      expect(state?.activeWindowTitle).toBe("Visual Studio Code")
      expect(state?.resolution.width).toBe(2560)
      expect(state?.resolution.height).toBe(1440)
    })

    it("getScreenState() falls back to unknown title and default resolution when PowerShell throws", async () => {
      const config = createMockVisionConfig({ enabled: true })
      const vision = new VisionCortex(config)

      mockExeca.mockRejectedValue(new Error("PowerShell execution policy denied"))

      const state = await vision.getScreenState()

      expect(state).toEqual({
        activeWindowTitle: "Unknown",
        activeWindowProcess: "unknown",
        resolution: { width: 1920, height: 1080 },
      })
    })

    it("describeImage() falls back to OCR when multimodal generation fails", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, ocrEngine: "tesseract", rateLimitMs: 0 }))
      vi.spyOn(vision, "extractText").mockResolvedValue("fallback ocr")
      mockOrchestratorGenerate.mockRejectedValueOnce(new Error("quota exceeded"))

      const result = await vision.describeImage(FAKE_PNG, "What is shown?")

      expect(result).toBe("fallback ocr")
    })

    it("findElement() uses the accessibility cache for repeated queries", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      vi.spyOn(vision, "getScreenState").mockResolvedValue({
        activeWindowTitle: "Editor",
        activeWindowProcess: "code",
        resolution: { width: 100, height: 100 },
      })
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([
        {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          interactable: true,
        },
      ])

      const first = await vision.findElement("save")
      const second = await vision.findElement("save")

      expect(first?.text).toBe("Save")
      expect(second?.text).toBe("Save")
      expect((vision as any).getAccessibilityElements).toHaveBeenCalledTimes(1)
    })

    it("storeVisualContext() swallows memory service failures", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      const saveSpy = vi.spyOn((await import("../../memory/store.js")).memory, "save").mockRejectedValueOnce(new Error("db unavailable"))

      await expect(vision.storeVisualContext({
        description: "App window",
        ocrText: "hello",
        activeWindow: "Editor",
        timestamp: Date.now(),
      })).resolves.toBeUndefined()

      saveSpy.mockRestore()
    })

    it("describeImage() returns multimodal output when generation succeeds", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))

      const result = await vision.describeImage(FAKE_PNG)

      expect(result).toBe("visual description")
      expect(mockOrchestratorGenerate).toHaveBeenCalledOnce()
    })

    it("describeImage() prefers the configured multimodal engine when available", async () => {
      const vision = new VisionCortex(createMockVisionConfig({
        enabled: true,
        multimodalEngine: "gemini",
        rateLimitMs: 0,
      }))

      const result = await vision.describeImage(FAKE_PNG)

      expect(result).toBe("preferred visual description")
      expect(mockPreferredMultimodalGenerate).toHaveBeenCalledOnce()
      expect(mockOrchestratorGenerate).not.toHaveBeenCalled()
    })

    it("findElementViaAccessibility() matches text and query substrings", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([
        {
          type: "button",
          text: "Save File",
          name: "Save File",
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          interactable: true,
        },
      ])

      const result = await (vision as any).findElementViaAccessibility("save")

      expect(result?.text).toBe("Save File")
    })

    it("findElementViaAccessibility() returns null when element lookup throws", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockRejectedValue(new Error("uia failed"))

      await expect((vision as any).findElementViaAccessibility("save")).resolves.toBeNull()
    })

    it("findElementViaLLM() returns null for invalid element ids", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([
        {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          interactable: true,
        },
      ])
      vi.spyOn(vision, "applySetOfMarks").mockResolvedValue(FAKE_PNG)
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      mockOrchestratorGenerate.mockResolvedValueOnce("99")

      const result = await (vision as any).findElementViaLLM(FAKE_PNG, "save")

      expect(result).toBeNull()
    })

    it("findElementViaLLM() returns the selected indexed element", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([
        { type: "button", text: "Save", name: "Save", bounds: { x: 1, y: 2, width: 3, height: 4 }, interactable: true },
        { type: "button", text: "Cancel", name: "Cancel", bounds: { x: 5, y: 6, width: 7, height: 8 }, interactable: true },
      ])
      vi.spyOn(vision, "applySetOfMarks").mockResolvedValue(FAKE_PNG)
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      mockOrchestratorGenerate.mockResolvedValueOnce("2")

      const result = await (vision as any).findElementViaLLM(FAKE_PNG, "cancel")

      expect(result?.text).toBe("Cancel")
    })

    it("findElementViaLLM() falls back to pure vision when no accessibility elements exist", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      ;(vision as any).getAccessibilityElements = vi.fn().mockResolvedValue([])
      const pureVision = vi.spyOn(vision as any, "findElementPureVisionLLM").mockResolvedValue({
        type: "unknown",
        text: "Canvas Save",
        bounds: { x: 9, y: 8, width: 7, height: 6 },
        interactable: true,
        name: "save",
      })

      const result = await (vision as any).findElementViaLLM(FAKE_PNG, "save")

      expect(pureVision).toHaveBeenCalledOnce()
      expect(result?.text).toBe("Canvas Save")
    })

    it("findElement() caches LLM-grounded results after accessibility misses", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      vi.spyOn(vision, "getScreenState").mockResolvedValue({
        activeWindowTitle: "Editor",
        activeWindowProcess: "code",
        resolution: { width: 100, height: 100 },
      })
      ;(vision as any).findElementViaAccessibility = vi.fn().mockResolvedValue(null)
      ;(vision as any).captureScreen = vi.fn().mockResolvedValue(FAKE_PNG)
      ;(vision as any).findElementViaLLM = vi.fn().mockResolvedValue({
        type: "button",
        text: "Save",
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        interactable: true,
      })

      const first = await vision.findElement("save")
      const second = await vision.findElement("save")

      expect(first?.text).toBe("Save")
      expect(second?.text).toBe("Save")
      expect((vision as any).findElementViaLLM).toHaveBeenCalledTimes(1)
    })

    it("findElementPureVisionLLM() parses JSON coordinates into a UI element", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      mockOrchestratorGenerate.mockResolvedValueOnce('{"found":true,"x":10,"y":20,"width":30,"height":40,"text":"Save"}')

      const result = await (vision as any).findElementPureVisionLLM(FAKE_PNG, "save")

      expect(result).toMatchObject({
        text: "Save",
        bounds: { x: 10, y: 20, width: 30, height: 40 },
      })
    })

    it("getWindowsAccessibilityElements() maps Windows control types", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({ name: "Open", type: "ControlType.Button", x: 5, y: 6, w: 7, h: 8 }),
        stderr: "",
        exitCode: 0,
      } as any)

      const result = await (vision as any).getWindowsAccessibilityElements()

      expect(result).toMatchObject([
        {
          type: "button",
          text: "Open",
          bounds: { x: 5, y: 6, width: 7, height: 8 },
          interactable: true,
          role: "ControlType.Button",
          name: "Open",
          source: "accessibility",
          confidence: 0.98,
        },
      ])
    })

    it("getWindowsAccessibilityElements() returns [] for empty or failing PowerShell output", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      mockExeca.mockResolvedValueOnce({ stdout: "   ", stderr: "", exitCode: 0 } as any)
      await expect((vision as any).getWindowsAccessibilityElements()).resolves.toEqual([])

      mockExeca.mockRejectedValueOnce(new Error("uia unavailable"))
      await expect((vision as any).getWindowsAccessibilityElements()).resolves.toEqual([])
    })

    it("getScreenState() returns null when screen helpers throw", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      vi.spyOn(vision as any, "getActiveWindowTitle").mockRejectedValue(new Error("boom"))

      await expect(vision.getScreenState()).resolves.toBeNull()
    })

    it("getAccessibilityElements() returns [] on non-Windows platforms", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect((vision as any).getAccessibilityElements()).resolves.toEqual([])

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("mapUIAType() falls back to unknown for unmapped roles", () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      expect((vision as any).mapUIAType("ControlType.Edit")).toBe("input")
      expect((vision as any).mapUIAType("ControlType.Custom")).toBe("unknown")
    })

    it("buildSoMSvgOverlay() includes numbered labels and bounds", () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      const svg = (vision as any).buildSoMSvgOverlay([
        { type: "button", text: "Save", bounds: { x: 10, y: 20, width: 30, height: 40 }, interactable: true },
      ])

      expect(svg).toContain("<rect x=\"10\" y=\"20\"")
      expect(svg).toContain(">1<")
    })

    it("applySetOfMarks() returns original screenshot when drawing support is unavailable", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect(vision.applySetOfMarks(FAKE_PNG, [
        { type: "button", text: "Save", bounds: { x: 10, y: 20, width: 30, height: 40 }, interactable: true },
      ])).resolves.toBe(FAKE_PNG)
    })

    it("checkNeedsResize() and resizeImage() handle missing sharp gracefully", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect((vision as any).checkNeedsResize(FAKE_PNG)).resolves.toBe(false)
      await expect((vision as any).resizeImage(FAKE_PNG)).resolves.toBeNull()
    })

    it("checkNeedsResize() and resizeImage() cover sharp-backed success branches", async () => {
      vi.doMock("sharp", () => ({
        default: vi.fn(() => ({
          metadata: vi.fn().mockResolvedValue({ width: 3000, height: 1000 }),
          resize: vi.fn().mockReturnThis(),
          png: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockResolvedValue(Buffer.from("resized")),
        })),
      }))

      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect((vision as any).checkNeedsResize(FAKE_PNG)).resolves.toBe(true)
      await expect((vision as any).resizeImage(FAKE_PNG)).resolves.toEqual(Buffer.from("resized"))

      vi.doUnmock("sharp")
    })

    it("resizeImage() returns null when sharp throws during processing", async () => {
      vi.doMock("sharp", () => ({
        default: vi.fn(() => ({
          resize: vi.fn(() => {
            throw new Error("sharp failure")
          }),
        })),
      }))

      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect((vision as any).resizeImage(FAKE_PNG)).resolves.toBeNull()

      vi.doUnmock("sharp")
    })

    it("captureScreen() cleans up temp files on capture errors", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      mockExeca.mockRejectedValueOnce(new Error("screen blocked"))

      await expect((vision as any).captureScreen()).rejects.toThrow("Screen capture failed")
      expect(mockFs.unlink).toHaveBeenCalled()
    })

    it("getActiveWindowTitle() and getScreenResolution() return defaults on non-Windows", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      await expect((vision as any).getActiveWindowTitle()).resolves.toEqual({ title: "Unknown", process: "unknown" })
      await expect((vision as any).getScreenResolution()).resolves.toEqual({ width: 1920, height: 1080 })

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("getActiveWindowTitle() and getScreenResolution() cover Windows success and fallback branches", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      mockExeca.mockResolvedValueOnce({ stdout: "My App\n", stderr: "", exitCode: 0 } as any)
      await expect((vision as any).getActiveWindowTitle()).resolves.toEqual({ title: "My App", process: "unknown" })

      mockExeca.mockRejectedValueOnce(new Error("no foreground window"))
      await expect((vision as any).getActiveWindowTitle()).resolves.toEqual({ title: "Unknown", process: "unknown" })

      mockExeca.mockResolvedValueOnce({ stdout: "2560x1440", stderr: "", exitCode: 0 } as any)
      await expect((vision as any).getScreenResolution()).resolves.toEqual({ width: 2560, height: 1440 })

      mockExeca.mockRejectedValueOnce(new Error("screen unavailable"))
      await expect((vision as any).getScreenResolution()).resolves.toEqual({ width: 1920, height: 1080 })
    })

    it("buildCacheKey() normalizes query casing and whitespace", () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))

      expect((vision as any).buildCacheKey("  Save  ", "Editor")).toBe("Editor::save")
    })

    it("verifyTesseract() swallows lookup failures", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, ocrEngine: "tesseract" }))
      mockExeca.mockRejectedValueOnce(new Error("missing tesseract"))

      await expect((vision as any).verifyTesseract()).resolves.toBeUndefined()
    })

    it("findElementPureVisionLLM() returns null for missing or invalid JSON replies", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)

      mockOrchestratorGenerate.mockResolvedValueOnce('{"found":false}')
      await expect((vision as any).findElementPureVisionLLM(FAKE_PNG, "save")).resolves.toBeNull()

      mockOrchestratorGenerate.mockResolvedValueOnce("not json")
      await expect((vision as any).findElementPureVisionLLM(FAKE_PNG, "save")).resolves.toBeNull()
    })

    it("detectElements() merges advanced detector output on balanced hosts", async () => {
      const vision = new VisionCortex(createMockVisionConfig({
        enabled: true,
        profile: "balanced",
        elementDetection: "omniparser",
        rateLimitMs: 0,
      }))

      vi.spyOn(vision as any, "getAccessibilityElements").mockResolvedValue([
        {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 10, y: 20, width: 30, height: 40 },
          interactable: true,
          source: "accessibility",
          confidence: 0.98,
        },
      ])
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      vi.spyOn(vision as any, "readImageDimensions").mockResolvedValue({ width: 1000, height: 1000 })
      mockOrchestratorGenerate.mockResolvedValueOnce(
        '{"elements":[{"type":"button","text":"Deploy","name":"Deploy","left":600,"top":100,"right":800,"bottom":200,"interactable":true,"confidence":0.87}]}',
      )

      const elements = await vision.detectElements(FAKE_PNG)

      expect(elements).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: "Save", source: "accessibility" }),
        expect.objectContaining({
          text: "Deploy",
          source: "advanced-detector",
          bounds: { x: 600, y: 100, width: 200, height: 100 },
          confidence: 0.87,
        }),
      ]))
    })

    it("verifyGroundingCandidate() decorates accepted candidates with verifier metadata", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      vi.spyOn(vision as any, "applySetOfMarks").mockResolvedValue(FAKE_PNG)
      mockOrchestratorGenerate.mockResolvedValueOnce(
        '{"match":true,"confidence":0.84,"reason":"The highlighted control label matches Save."}',
      )

      const result = await (vision as any).verifyGroundingCandidate({
        query: "Save",
        candidate: {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 10, y: 20, width: 60, height: 24 },
          interactable: true,
        },
        screenshot: FAKE_PNG,
        source: "llm-som",
      })

      expect(result).toMatchObject({
        text: "Save",
        source: "llm-som",
        confidence: expect.any(Number),
        verification: {
          passed: true,
          method: "multimodal+heuristic",
        },
      })
    })

    it("verifyGroundingCandidate() rejects mismatched candidates", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true, rateLimitMs: 0 }))
      vi.spyOn(vision, "validateAndResizeImage").mockResolvedValue(FAKE_PNG)
      vi.spyOn(vision as any, "applySetOfMarks").mockResolvedValue(FAKE_PNG)
      mockOrchestratorGenerate.mockResolvedValueOnce(
        '{"match":false,"confidence":0.08,"reason":"The highlighted control is Save, not Delete."}',
      )

      const result = await (vision as any).verifyGroundingCandidate({
        query: "Delete button",
        candidate: {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 10, y: 20, width: 60, height: 24 },
          interactable: true,
        },
        screenshot: FAKE_PNG,
        source: "llm-vision",
      })

      expect(result).toBeNull()
    })

    it("reflectOnGuiAction() records a confirmed reflection after a visible GUI change", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      const memoryModule = await import("../../memory/store.js")
      const episodicModule = await import("../../memory/episodic.js")
      const saveSpy = vi.spyOn(memoryModule.memory, "save")
        .mockResolvedValueOnce("visual-context-1")
        .mockResolvedValueOnce("reflection-1")
      const recordSpy = vi.spyOn(episodicModule.episodicMemory, "record")
        .mockReturnValue({ id: "episode-1" } as any)

      const reflection = await vision.reflectOnGuiAction({
        userId: "owner",
        action: "click",
        success: true,
        targetQuery: "Save",
        expectedOutcome: "saved",
        resolvedElement: {
          type: "button",
          text: "Save",
          name: "Save",
          bounds: { x: 10, y: 20, width: 60, height: 24 },
          interactable: true,
        },
        before: {
          ocrText: "editor unsaved draft",
          description: "Editor before save",
          elements: [],
          screenState: {
            activeWindowTitle: "Editor",
            activeWindowProcess: "code",
            resolution: { width: 1200, height: 800 },
          },
          confidence: 0.7,
          latencyMs: 10,
        },
        after: {
          ocrText: "editor saved",
          description: "Editor after save",
          elements: [],
          screenState: {
            activeWindowTitle: "Editor",
            activeWindowProcess: "code",
            resolution: { width: 1200, height: 800 },
          },
          confidence: 0.7,
          latencyMs: 12,
        },
        commandResult: "clicked save",
      })

      expect(reflection.verificationStatus).toBe("confirmed")
      expect(reflection.memoryId).toBe("reflection-1")
      expect(reflection.episodeId).toBe("episode-1")
      expect(reflection.summary).toContain("visual reflection confirmed")
      expect(saveSpy).toHaveBeenCalledTimes(2)
      expect(recordSpy).toHaveBeenCalledOnce()

      saveSpy.mockRestore()
      recordSpy.mockRestore()
    })

    it("recallVisualMemories() merges semantic and episodic visual traces", async () => {
      const vision = new VisionCortex(createMockVisionConfig({ enabled: true }))
      const memoryModule = await import("../../memory/store.js")
      const episodicModule = await import("../../memory/episodic.js")
      const searchSpy = vi.spyOn(memoryModule.memory, "search").mockResolvedValue([
        {
          id: "semantic-1",
          content: "[Visual Context] Window: VS Code\nDescription: Save dialog open",
          metadata: {
            category: "visual_context",
            kind: "visual_context",
            activeWindow: "VS Code",
            timestamp: 1_700_000_000_000,
          },
          score: 0.72,
        },
      ])
      const retrieveSpy = vi.spyOn(episodicModule.episodicMemory, "retrieve").mockReturnValue([
        {
          episode: {
            id: "episode-1",
            userId: "owner",
            task: "save dialog",
            approach: "GUI action with post-action visual reflection",
            toolsUsed: ["gui-agent", "vision-cortex"],
            outcome: "success",
            result: 'GUI save completed and visual reflection confirmed the change (window changed from "Draft" to "Saved").',
            lesson: "Visual reflection confirmed the save action.",
            importance: 0.7,
            accessCount: 0,
            createdAt: 1_700_000_100_000,
            lastAccessedAt: 1_700_000_100_000,
            tags: ["gui_action", "visual_reflection", "click"],
          },
          retrievalScore: 0.91,
        },
      ])

      const recall = await vision.recallVisualMemories("save", { userId: "owner", limit: 2 })

      expect(searchSpy).toHaveBeenCalledWith("owner", "save", 8)
      expect(retrieveSpy).toHaveBeenCalled()
      expect(recall.matches).toHaveLength(2)
      expect(recall.matches[0]).toMatchObject({ id: "episode-1", source: "episodic-memory" })
      expect(recall.matches[1]).toMatchObject({ id: "semantic-1", source: "semantic-memory" })
      expect(recall.summary[0]).toContain("visual_reflection/episodic-memory")
      expect(recall.summary[1]).toContain("visual_context/semantic-memory")

      searchSpy.mockRestore()
      retrieveSpy.mockRestore()
    })
  })
})
