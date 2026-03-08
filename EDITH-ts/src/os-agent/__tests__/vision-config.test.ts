import { describe, expect, it } from "vitest"

import { getDefaultOSAgentConfig } from "../defaults.js"
import { resolveOSVisionConfig } from "../vision-config.js"
import type { RuntimeVisionConfig } from "../../vision/runtime-config.js"

function buildRuntimeVisionConfig(overrides: Partial<RuntimeVisionConfig> = {}): RuntimeVisionConfig {
  return {
    enabled: true,
    profile: "minimum-spec",
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "auto",
    monitorIntervalMs: 8_000,
    rateLimitMs: 12_000,
    maxImageBytesMb: 8,
    maxImageEdgePx: 1_280,
    ...overrides,
  }
}

describe("resolveOSVisionConfig", () => {
  it("maps top-level runtime vision config into the OS-agent vision config", () => {
    const defaults = getDefaultOSAgentConfig().vision
    const runtimeVision = buildRuntimeVisionConfig({
      enabled: true,
      profile: "balanced",
      multimodalEngine: "openai",
      monitorIntervalMs: 4_000,
      rateLimitMs: 10_000,
      maxImageBytesMb: 20,
      maxImageEdgePx: 2_048,
    })

    const resolved = resolveOSVisionConfig(defaults, runtimeVision)

    expect(resolved.enabled).toBe(true)
    expect(resolved.profile).toBe("balanced")
    expect(resolved.multimodalEngine).toBe("openai")
    expect(resolved.monitorIntervalMs).toBe(4_000)
    expect(resolved.rateLimitMs).toBe(10_000)
    expect(resolved.maxImageBytesMb).toBe(20)
    expect(resolved.maxImageEdgePx).toBe(2_048)
  })

  it("retains safe defaults when the runtime config stays on the minimum-spec profile", () => {
    const defaults = getDefaultOSAgentConfig().vision
    const resolved = resolveOSVisionConfig(defaults, buildRuntimeVisionConfig())

    expect(resolved.profile).toBe("minimum-spec")
    expect(resolved.multimodalEngine).toBe("auto")
    expect(resolved.maxImageBytesMb).toBe(8)
    expect(resolved.maxImageEdgePx).toBe(1_280)
  })
})
