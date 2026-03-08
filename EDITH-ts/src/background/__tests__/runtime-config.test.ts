import { describe, expect, it } from "vitest"

import {
  resolveRuntimeMacroConfig,
  resolveRuntimeProactiveConfig,
} from "../runtime-config.js"

describe("resolveRuntimeProactiveConfig", () => {
  it("uses conservative Phase 6 defaults for the system minimum requirement", () => {
    const resolved = resolveRuntimeProactiveConfig()

    expect(resolved.enabled).toBe(true)
    expect(resolved.quietHours).toEqual({ start: "22:00", end: "07:00" })
    expect(resolved.channels).toEqual({ desktop: true, mobile: true, voice: false })
    expect(resolved.fileWatcher).toEqual({
      enabled: false,
      paths: [],
      debounceMs: 500,
      summaryWindowMs: 300_000,
    })
    expect(resolved.maxWatchedPaths).toBe(5)
  })

  it("maps legacy osAgent watch paths into the top-level proactive runtime", () => {
    const resolved = resolveRuntimeProactiveConfig({
      env: {},
      voice: {} as never,
      vision: {} as never,
      proactive: undefined as never,
      macros: undefined as never,
      identity: {} as never,
      agents: {} as never,
      channels: {} as never,
      skills: {} as never,
      mcp: {} as never,
      osAgent: {
        enabled: false,
        gui: {} as never,
        vision: {} as never,
        voice: {} as never,
        system: {
          enabled: true,
          watchPaths: [
            "C:/workspace",
            "C:/workspace",
            "C:/secrets",
          ],
          watchClipboard: false,
          watchActiveWindow: true,
          resourceCheckIntervalMs: 4_000,
          cpuWarningThreshold: 90,
          ramWarningThreshold: 85,
          diskWarningThreshold: 90,
        },
        iot: {} as never,
        perceptionIntervalMs: 2_000,
      },
    })

    expect(resolved.fileWatcher.enabled).toBe(true)
    expect(resolved.fileWatcher.paths).toEqual(["C:/workspace", "C:/secrets"])
    expect(resolved.schedulerIntervalMs).toBe(4_000)
  })
})

describe("resolveRuntimeMacroConfig", () => {
  it("normalizes macro runtime defaults", () => {
    expect(resolveRuntimeMacroConfig()).toEqual({
      enabled: true,
      yamlPath: "macros.yaml",
      maxConcurrent: 1,
    })
  })

  it("prefers top-level macro config when present", () => {
    expect(resolveRuntimeMacroConfig({
      env: {},
      voice: {} as never,
      vision: {} as never,
      proactive: {} as never,
      macros: {
        enabled: false,
        yamlPath: "workspace/macros/phase-6.yaml",
        maxConcurrent: 3,
      },
      identity: {} as never,
      agents: {} as never,
      channels: {} as never,
      skills: {} as never,
      mcp: {} as never,
      osAgent: {} as never,
    })).toEqual({
      enabled: false,
      yamlPath: "workspace/macros/phase-6.yaml",
      maxConcurrent: 3,
    })
  })
})
