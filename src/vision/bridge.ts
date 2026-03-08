/**
 * @file bridge.ts
 * @description VisionBridge — unified vision analysis with multi-provider routing.
 *
 * ARCHITECTURE:
 *   Provider priority chain (analyzeScreen / analyzeFrame / analyzeImageUrl):
 *     1. Ollama local     — when VISION_ENGINE='ollama' or system is offline
 *                           Models: qwen2.5-vl:7b (best), moondream (lightest)
 *     2. Gemini Flash 2.0 — fast, free tier, excellent vision (GEMINI_API_KEY)
 *     3. OpenAI Vision    — GPT-4o-mini / GPT-4o (OPENAI_API_KEY)
 *     4. Claude Vision    — Haiku / Sonnet (ANTHROPIC_API_KEY)
 *     5. Python sidecar   — legacy fallback
 *
 *   VISION_ENGINE config:
 *     "auto"   → full priority chain (default)
 *     "ollama" → force local only
 *     "gemini" → skip local, start from Gemini
 *
 *   OfflineCoordinator integration:
 *     When offlineCoordinator.isOffline(), Ollama is automatically preferred.
 *
 * PAPER BASIS:
 *   - Phase 9 design: "LOCAL IS THE ARMOR, CLOUD IS THE UPGRADE"
 *   - Qwen2.5-VL (Alibaba, 2024) — SOTA open-source vision, 7B params
 *   - Gemini 2.0 Flash (Google DeepMind, 2025) — fastest multimodal API
 *   - Moondream 2 (2024) — 1.8B edge-optimized multimodal
 *
 * @module vision/bridge
 */

import { execa } from "execa"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs/promises"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { offlineCoordinator } from "../offline/coordinator.js"
import { analyzeWithGemini, analyzeWithOpenAI, analyzeWithClaude, analyzeWithOllamaLocal, analyzeUrlWithGemini } from "./providers.js"

const logger = createLogger("vision.bridge")
const PY = config.PYTHON_PATH ?? "python"
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")

// Legacy Ollama function removed — replaced by analyzeWithOllamaLocal() in providers.ts

/**
 * Capture a screenshot and save to a temp file (platform-aware).
 * Returns the temp file path or null on failure.
 */
async function captureScreenshot(): Promise<string | null> {
  const tmpPath = path.join(
    process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
    `edith-screen-${Date.now()}.png`,
  )

  try {
    if (process.platform === "darwin") {
      await execa("screencapture", ["-x", tmpPath])
    } else if (process.platform === "win32") {
      // PowerShell screenshot
      await execa("powershell", [
        "-command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${tmpPath}') }`,
      ])
    } else {
      // Linux: try scrot, fall back to import (ImageMagick)
      await execa("scrot", [tmpPath]).catch(
        async () => execa("import", ["-window", "root", tmpPath]),
      )
    }
    return tmpPath
  } catch (err) {
    logger.warn("screenshot capture failed", { err })
    return null
  }
}

/**
 * VisionBridge — vision analysis with offline-capable provider routing.
 *
 * Phase 9 adds Ollama multimodal as a first-priority provider when:
 *   - VISION_ENGINE='ollama' is configured
 *   - OfflineCoordinator reports offline/degraded state
 *
 * The Python sidecar (Gemini / OpenAI Vision) remains the default cloud provider.
 */
export class VisionBridge {
  /**
   * Determine if Ollama local vision should be preferred.
   * True when VISION_ENGINE='ollama' or system is offline.
   * Always false for mobile clients — local models don't run on phone.
   *
   * @param isMobile - True when request originates from a mobile device
   */
  private shouldUseOllamaVision(isMobile = false): boolean {
    if (isMobile) return false
    return config.VISION_ENGINE === "ollama" || offlineCoordinator.isOffline()
  }

  /**
   * Run the full provider priority chain on a local image file.
   * Order: Ollama → Gemini → OpenAI → Claude → null (caller handles Python fallback)
   *
   * @param imagePath - Path to image file
   * @param prompt    - Analysis prompt
   * @returns Analysis text from first successful provider, or null
   */
  private async tryCloudProviders(imagePath: string, prompt: string): Promise<string | null> {
    // 1. Gemini Flash (free tier, fastest)
    if (config.VISION_ENGINE !== "ollama") {
      const result = await analyzeWithGemini(imagePath, prompt)
      if (result) return result
    }

    // 2. OpenAI Vision (GPT-4o-mini)
    const openaiResult = await analyzeWithOpenAI(imagePath, prompt)
    if (openaiResult) return openaiResult

    // 3. Claude Vision (Haiku)
    const claudeResult = await analyzeWithClaude(imagePath, prompt)
    if (claudeResult) return claudeResult

    return null
  }

  /**
   * Analyze the current screen content (desktop only — screen capture not available on phone).
   *
   * @param prompt - What to look for / analyze on screen
   */
  async analyzeScreen(prompt = "What is on the screen?"): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // Screenshot → analyzeFrame (desktop, not mobile)
    const screenshotPath = await captureScreenshot()
    if (screenshotPath) {
      try {
        const result = await this.analyzeFrame(screenshotPath, prompt, false)
        await fs.unlink(screenshotPath).catch(() => undefined)
        if (result) return result
      } catch (err) {
        logger.warn("screen analysis failed, falling back to Python", { err })
        await fs.unlink(screenshotPath).catch(() => undefined)
      }
    }

    // Fallback: Python sidecar
    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); print(VisionProcessor(s).analyze_screen(${JSON.stringify(
            prompt,
          )}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeScreen failed", err)
      return ""
    }
  }

  /**
   * Analyze an image file using the full provider chain.
   *
   * Priority:
   *   1. Ollama/moondream — desktop offline only, NEVER on mobile (isMobile=true skips)
   *   2. Gemini Flash 2.0 — free tier, lightweight HTTP call, works on phone
   *   3. OpenAI GPT-4o-mini
   *   4. Claude Haiku
   *   5. Python sidecar (legacy fallback)
   *
   * @param imagePath - Path to the image file
   * @param prompt    - Analysis prompt
   * @param isMobile  - When true, skips all local models (phone clients)
   */
  async analyzeFrame(imagePath: string, prompt = "What do you see?", isMobile = false): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // 1. Ollama local — desktop offline only, skip for mobile
    if (this.shouldUseOllamaVision(isMobile)) {
      const result = await analyzeWithOllamaLocal(imagePath, prompt)
      if (result) {
        logger.debug("frame analyzed via Ollama", { imagePath, length: result.length })
        return result
      }
      // If forced-ollama and it failed, don't fall through to cloud
      if (config.VISION_ENGINE === "ollama") {
        return ""
      }
    }

    // 2–4. Cloud provider chain (Gemini → OpenAI → Claude)
    const cloudResult = await this.tryCloudProviders(imagePath, prompt)
    if (cloudResult) {
      logger.debug("frame analyzed via cloud provider", { length: cloudResult.length })
      return cloudResult
    }

    // 5. Python sidecar (legacy fallback)
    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `import cv2; from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); frame = cv2.imread(${JSON.stringify(
            imagePath,
          )}); print(VisionProcessor(s).analyze_frame(frame, ${JSON.stringify(prompt)}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeFrame failed", err)
      return ""
    }
  }

  /**
   * Analyze an image from a URL (downloads first, then analyzes).
   * Always uses Ollama or Python cloud vision depending on routing.
   *
   * @param imageUrl - URL of the image to analyze
   * @param prompt   - Analysis prompt
   */
  async analyzeImageUrl(imageUrl: string, prompt = "Describe this image."): Promise<string> {
    if (!config.VISION_ENABLED) {
      return ""
    }

    // 1. Gemini can analyze URLs natively (no download needed) — try first
    if (!this.shouldUseOllamaVision() && config.GEMINI_API_KEY) {
      const result = await analyzeUrlWithGemini(imageUrl, prompt)
      if (result) return result
    }

    // 2. Ollama or other providers: download first, then analyzeFrame
    const tmpPath = path.join(
      process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
      `edith-img-${Date.now()}.png`,
    )
    try {
      const response = await fetch(imageUrl)
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer())
        await fs.writeFile(tmpPath, buffer)
        const result = await this.analyzeFrame(tmpPath, prompt)
        await fs.unlink(tmpPath).catch(() => undefined)
        if (result) return result
      }
    } catch (err) {
      logger.warn("URL image download failed", { err })
      await fs.unlink(tmpPath).catch(() => undefined)
    }

    // Fallback: Python sidecar
    try {
      const { stdout } = await execa(
        PY,
        [
          "-c",
          `from vision.processor import VisionProcessor; from vision.stream import CameraStream; s = CameraStream(); print(VisionProcessor(s).analyze_url(${JSON.stringify(imageUrl)}, ${JSON.stringify(prompt)}))`,
        ],
        { cwd: CWD, timeout: 30_000 },
      )
      return stdout.trim()
    } catch (err) {
      logger.error("analyzeImageUrl failed", err)
      return ""
    }
  }

  /**
   * Get current vision provider status for diagnostics.
   * Reports which provider would be selected given current config + connectivity.
   */
  getProviderStatus(): { provider: "ollama" | "gemini" | "openai" | "claude" | "python"; offline: boolean; model: string } {
    const offline = offlineCoordinator.isOffline()
    if (this.shouldUseOllamaVision()) {
      return { provider: "ollama", offline, model: config.VISION_OLLAMA_MODEL }
    }
    if (config.GEMINI_API_KEY) {
      return { provider: "gemini", offline, model: config.VISION_GEMINI_MODEL }
    }
    if (config.OPENAI_API_KEY) {
      return { provider: "openai", offline, model: config.VISION_OPENAI_MODEL }
    }
    if (config.ANTHROPIC_API_KEY) {
      return { provider: "claude", offline, model: config.VISION_CLAUDE_MODEL }
    }
    return { provider: "python", offline, model: "sidecar" }
  }
}

/** Singleton export. */
export const vision = new VisionBridge()
