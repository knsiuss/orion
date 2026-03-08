import type { RuntimeVisionConfig } from "../vision/runtime-config.js"
import type { VisionConfig } from "./types.js"

type LegacyVisionConfig = Partial<VisionConfig>

export function resolveOSVisionConfig(
  defaults: VisionConfig,
  runtimeVision: RuntimeVisionConfig,
  legacyVision?: LegacyVisionConfig,
): VisionConfig {
  return {
    ...defaults,
    enabled: runtimeVision.enabled ?? legacyVision?.enabled ?? defaults.enabled,
    profile: runtimeVision.profile ?? legacyVision?.profile ?? defaults.profile,
    ocrEngine: runtimeVision.ocrEngine ?? legacyVision?.ocrEngine ?? defaults.ocrEngine,
    elementDetection: runtimeVision.elementDetection ?? legacyVision?.elementDetection ?? defaults.elementDetection,
    multimodalEngine: runtimeVision.multimodalEngine ?? legacyVision?.multimodalEngine ?? defaults.multimodalEngine,
    monitorIntervalMs: runtimeVision.monitorIntervalMs ?? legacyVision?.monitorIntervalMs ?? defaults.monitorIntervalMs,
    rateLimitMs: runtimeVision.rateLimitMs ?? legacyVision?.rateLimitMs ?? defaults.rateLimitMs,
    maxImageBytesMb: runtimeVision.maxImageBytesMb ?? legacyVision?.maxImageBytesMb ?? defaults.maxImageBytesMb,
    maxImageEdgePx: runtimeVision.maxImageEdgePx ?? legacyVision?.maxImageEdgePx ?? defaults.maxImageEdgePx,
  }
}
