import { describe, expect, it } from "vitest"

import { resolveRuntimeVisionConfig } from "../runtime-config.js"
import type { EdithConfig } from "../../config/edith-config.js"

describe("resolveRuntimeVisionConfig", () => {
  it("prefers top-level vision config as the source of truth", () => {
    const resolved = resolveRuntimeVisionConfig({
      env: {},
      voice: {} as EdithConfig["voice"],
      vision: {
        enabled: true,
        profile: "balanced",
        ocrEngine: "tesseract",
        elementDetection: "accessibility",
        multimodalEngine: "openai",
        monitorIntervalMs: 4_000,
        rateLimitMs: 10_000,
        maxImageBytesMb: 20,
        maxImageEdgePx: 2_048,
      },
      identity: { name: "EDITH", emoji: "✦", theme: "dark minimal" },
      agents: {
        defaults: {
          model: { primary: "openai/gpt-4o", fallbacks: [] },
          workspace: "./workspace",
          bootstrapMaxChars: 65_536,
          bootstrapTotalMaxChars: 100_000,
        },
      },
      channels: {
        whatsapp: {},
        telegram: {},
        discord: {},
        signal: {},
        slack: {},
        line: {},
        matrix: {},
        teams: {},
        bluebubbles: {},
      },
      skills: {
        allowBundled: [],
        load: { extraDirs: [], watch: false },
        entries: {},
      },
      mcp: { servers: [] },
      osAgent: {} as EdithConfig["osAgent"],
    } as unknown as EdithConfig)

    expect(resolved.enabled).toBe(true)
    expect(resolved.profile).toBe("balanced")
    expect(resolved.multimodalEngine).toBe("openai")
    expect(resolved.maxImageBytesMb).toBe(20)
  })

  it("falls back to the legacy osAgent vision config when top-level vision is absent", () => {
    const resolved = resolveRuntimeVisionConfig({
      osAgent: {
        vision: {
          enabled: true,
          profile: "balanced",
          ocrEngine: "tesseract",
          elementDetection: "accessibility",
          multimodalEngine: "anthropic",
          monitorIntervalMs: 5_000,
          rateLimitMs: 9_000,
          maxImageBytesMb: 16,
          maxImageEdgePx: 1_600,
        },
      },
    } as unknown as EdithConfig)

    expect(resolved.enabled).toBe(true)
    expect(resolved.profile).toBe("balanced")
    expect(resolved.multimodalEngine).toBe("anthropic")
    expect(resolved.maxImageBytesMb).toBe(16)
    expect(resolved.maxImageEdgePx).toBe(1_600)
  })

  it("normalizes the legacy lite-1gb profile into the minimum-spec runtime profile", () => {
    const resolved = resolveRuntimeVisionConfig({
      osAgent: {
        vision: {
          enabled: true,
          profile: "lite-1gb" as "lite-1gb",
        },
      },
    } as unknown as EdithConfig)

    expect(resolved.enabled).toBe(true)
    expect(resolved.profile).toBe("minimum-spec")
    expect(resolved.ocrEngine).toBe("tesseract")
    expect(resolved.elementDetection).toBe("accessibility")
  })
})
