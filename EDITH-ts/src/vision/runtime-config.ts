import config from "../config.js"
import { loadEdithConfig, type EdithConfig } from "../config/edith-config.js"

export interface RuntimeVisionConfig {
  enabled: boolean
  profile: "minimum-spec" | "balanced"
  ocrEngine: "tesseract" | "cloud"
  elementDetection: "accessibility" | "yolo" | "omniparser"
  multimodalEngine: "auto" | "gemini" | "openai" | "anthropic" | "ollama"
  monitorIntervalMs: number
  rateLimitMs: number
  maxImageBytesMb: number
  maxImageEdgePx: number
}

const PROFILE_DEFAULTS: Record<RuntimeVisionConfig["profile"], Omit<RuntimeVisionConfig, "enabled" | "profile">> = {
  "minimum-spec": {
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "auto",
    monitorIntervalMs: 8_000,
    rateLimitMs: 12_000,
    maxImageBytesMb: 8,
    maxImageEdgePx: 1_280,
  },
  balanced: {
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "auto",
    monitorIntervalMs: 4_000,
    rateLimitMs: 10_000,
    maxImageBytesMb: 20,
    maxImageEdgePx: 2_048,
  },
}

function normalizeProfile(profile?: string): RuntimeVisionConfig["profile"] {
  return profile === "balanced" ? "balanced" : "minimum-spec"
}

function normalizeMultimodalEngine(engine?: string): RuntimeVisionConfig["multimodalEngine"] {
  if (
    engine === "gemini"
    || engine === "openai"
    || engine === "anthropic"
    || engine === "ollama"
  ) {
    return engine
  }

  return "auto"
}

function pickPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

type LegacyVisionConfig = Partial<Omit<RuntimeVisionConfig, "enabled" | "profile">> & {
  enabled?: boolean
  profile?: RuntimeVisionConfig["profile"] | "lite-1gb"
}

export function resolveRuntimeVisionConfig(edithConfig?: EdithConfig): RuntimeVisionConfig {
  const topLevel = edithConfig?.vision
  const legacyVision = edithConfig?.osAgent?.vision as LegacyVisionConfig | undefined
  const profile = normalizeProfile(topLevel?.profile ?? legacyVision?.profile)
  const defaults = PROFILE_DEFAULTS[profile]

  return {
    enabled: topLevel?.enabled ?? legacyVision?.enabled ?? config.VISION_ENABLED,
    profile,
    ocrEngine: topLevel?.ocrEngine ?? legacyVision?.ocrEngine ?? defaults.ocrEngine,
    elementDetection: topLevel?.elementDetection ?? legacyVision?.elementDetection ?? defaults.elementDetection,
    multimodalEngine: normalizeMultimodalEngine(
      topLevel?.multimodalEngine
      ?? legacyVision?.multimodalEngine
      ?? config.VISION_ENGINE,
    ),
    monitorIntervalMs: pickPositiveNumber(
      topLevel?.monitorIntervalMs ?? legacyVision?.monitorIntervalMs,
      defaults.monitorIntervalMs,
    ),
    rateLimitMs: pickPositiveNumber(
      topLevel?.rateLimitMs ?? legacyVision?.rateLimitMs,
      defaults.rateLimitMs,
    ),
    maxImageBytesMb: pickPositiveNumber(
      topLevel?.maxImageBytesMb ?? legacyVision?.maxImageBytesMb,
      defaults.maxImageBytesMb,
    ),
    maxImageEdgePx: pickPositiveNumber(
      topLevel?.maxImageEdgePx ?? legacyVision?.maxImageEdgePx,
      defaults.maxImageEdgePx,
    ),
  }
}

export async function loadRuntimeVisionConfig(): Promise<RuntimeVisionConfig> {
  const edithConfig = await loadEdithConfig()
  return resolveRuntimeVisionConfig(edithConfig)
}
