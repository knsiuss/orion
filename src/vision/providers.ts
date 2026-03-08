/**
 * @file providers.ts
 * @description Lightweight vision providers — cloud-first, mobile-compatible.
 *
 * ARCHITECTURE:
 *   EDITH runs on both laptop and phone. Vision must stay lightweight:
 *
 *   CLOUD PROVIDERS (pure HTTP, zero local weight — works on phone):
 *     - Gemini Flash 2.0  (free tier, fastest, recommended primary)
 *     - OpenAI GPT-4o-mini (cheap, reliable fallback)
 *     - Claude Haiku      (Anthropic fallback)
 *
 *   LOCAL PROVIDER (desktop-only, offline fallback):
 *     - Ollama + moondream  (1.1GB — smallest viable vision model)
 *       NOT for phone. Only activates when VISION_ENGINE='ollama' or offline on desktop.
 *
 *   Mobile rule: phone clients send images to the gateway → gateway calls cloud API.
 *   No local model ever runs on the phone itself.
 *
 *   No new dependencies — uses SDKs already in package.json:
 *     @google/generative-ai · openai · @anthropic-ai/sdk
 *
 * @module vision/providers
 */

import fs from "node:fs/promises"
import path from "node:path"

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("vision.providers")

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read an image file and return base64-encoded string + MIME type.
 *
 * @param imagePath - Absolute or relative path to image
 * @returns { base64, mimeType } or null on failure
 */
async function imageToBase64(
  imagePath: string,
): Promise<{ base64: string; mimeType: "image/png" | "image/jpeg" | "image/webp" } | null> {
  try {
    const data = await fs.readFile(imagePath)
    const ext = path.extname(imagePath).toLowerCase()
    const mimeType =
      ext === ".jpg" || ext === ".jpeg"
        ? ("image/jpeg" as const)
        : ext === ".webp"
          ? ("image/webp" as const)
          : ("image/png" as const)
    return { base64: data.toString("base64"), mimeType }
  } catch (err) {
    log.warn("imageToBase64 failed", { imagePath, err })
    return null
  }
}

// ─── Gemini Flash Vision ──────────────────────────────────────────────────────

/**
 * Analyze an image using Google Gemini Flash vision.
 *
 * Uses `gemini-2.0-flash` (free tier, very fast, strong vision).
 * Falls back to `gemini-1.5-flash` if 2.0 is unavailable.
 *
 * @param imagePath - Path to image file
 * @param prompt    - Analysis prompt
 * @returns Analysis text, or null if unavailable
 */
export async function analyzeWithGemini(imagePath: string, prompt: string): Promise<string | null> {
  if (!config.GEMINI_API_KEY) return null

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai")
    const img = await imageToBase64(imagePath)
    if (!img) return null

    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: config.VISION_GEMINI_MODEL,
    })

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: img.base64, mimeType: img.mimeType } },
    ])

    const text = result.response.text().trim()
    log.debug("Gemini vision ok", { length: text.length, model: config.VISION_GEMINI_MODEL })
    return text
  } catch (err) {
    log.warn("Gemini vision failed", { err })
    return null
  }
}

/**
 * Analyze an image from a URL using Gemini Flash vision.
 *
 * @param imageUrl - Public image URL
 * @param prompt   - Analysis prompt
 * @returns Analysis text, or null if unavailable
 */
export async function analyzeUrlWithGemini(imageUrl: string, prompt: string): Promise<string | null> {
  if (!config.GEMINI_API_KEY) return null

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai")
    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: config.VISION_GEMINI_MODEL })

    const result = await model.generateContent([
      prompt,
      {
        fileData: {
          mimeType: "image/jpeg",
          fileUri: imageUrl,
        },
      },
    ])

    const text = result.response.text().trim()
    log.debug("Gemini URL vision ok", { length: text.length })
    return text
  } catch (err) {
    log.warn("Gemini URL vision failed", { err })
    return null
  }
}

// ─── OpenAI Vision ────────────────────────────────────────────────────────────

/**
 * Analyze an image using OpenAI GPT-4o vision.
 *
 * Uses `gpt-4o-mini` by default (cost-efficient, strong vision).
 * Switch to `gpt-4o` in config for maximum quality.
 *
 * @param imagePath - Path to image file
 * @param prompt    - Analysis prompt
 * @returns Analysis text, or null if unavailable
 */
export async function analyzeWithOpenAI(imagePath: string, prompt: string): Promise<string | null> {
  if (!config.OPENAI_API_KEY) return null

  try {
    const { default: OpenAI } = await import("openai")
    const img = await imageToBase64(imagePath)
    if (!img) return null

    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY })
    const response = await client.chat.completions.create({
      model: config.VISION_OPENAI_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`,
                detail: "auto",
              },
            },
          ],
        },
      ],
      max_tokens: 1024,
    })

    const text = response.choices[0]?.message?.content?.trim() ?? ""
    log.debug("OpenAI vision ok", { length: text.length, model: config.VISION_OPENAI_MODEL })
    return text || null
  } catch (err) {
    log.warn("OpenAI vision failed", { err })
    return null
  }
}

// ─── Anthropic Claude Vision ──────────────────────────────────────────────────

/**
 * Analyze an image using Anthropic Claude vision.
 *
 * Uses `claude-haiku-4-5-20251001` by default (fast + cheap).
 * Switch to `claude-sonnet-4-6` in config for best quality.
 *
 * @param imagePath - Path to image file
 * @param prompt    - Analysis prompt
 * @returns Analysis text, or null if unavailable
 */
export async function analyzeWithClaude(imagePath: string, prompt: string): Promise<string | null> {
  if (!config.ANTHROPIC_API_KEY) return null

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    const img = await imageToBase64(imagePath)
    if (!img) return null

    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: config.VISION_CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    })

    const block = response.content[0]
    const text = block?.type === "text" ? block.text.trim() : ""
    log.debug("Claude vision ok", { length: text.length, model: config.VISION_CLAUDE_MODEL })
    return text || null
  } catch (err) {
    log.warn("Claude vision failed", { err })
    return null
  }
}

// ─── Ollama local vision (desktop-only, offline fallback) ────────────────────

/**
 * Analyze an image using a local Ollama vision model.
 *
 * DESKTOP ONLY — do not invoke from mobile clients.
 * Default model: moondream (1.1GB) — smallest viable vision model.
 * For better accuracy on desktop: `ollama pull llava:7b` (4.5GB).
 *
 * @param imagePath - Path to image file
 * @param prompt    - Analysis prompt
 * @param model     - Ollama model name (default from VISION_OLLAMA_MODEL)
 * @returns Analysis text, or null if Ollama unavailable
 */
export async function analyzeWithOllamaLocal(
  imagePath: string,
  prompt: string,
  model?: string,
): Promise<string | null> {
  const ollamaUrl = config.OLLAMA_BASE_URL?.trim() || "http://localhost:11434"
  const targetModel = model ?? config.VISION_OLLAMA_MODEL

  try {
    const data = await fs.readFile(imagePath)
    const base64Image = data.toString("base64")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: targetModel,
        prompt,
        images: [base64Image],
        stream: false,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    const result = (await response.json()) as { response?: string }
    const text = result.response?.trim() ?? ""
    log.debug("Ollama vision ok", { model: targetModel, length: text.length })
    return text || null
  } catch (err) {
    log.warn("Ollama vision failed", { model: targetModel, err })
    return null
  }
}
