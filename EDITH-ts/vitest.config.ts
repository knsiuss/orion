import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      exclude: [
        "src/channels/**",
        "src/config.ts",
        "src/mcp/**",
        "src/voice/**",
      ],
      thresholds: {
        lines: 35,
        "src/os-agent/system-monitor.ts": { lines: 85, branches: 75 },
        "src/os-agent/gui-agent.ts": { lines: 85, branches: 75 },
        "src/os-agent/vision-cortex.ts": { lines: 80, branches: 70 },
        "src/os-agent/voice-io.ts": { lines: 75, branches: 65 },
        "src/os-agent/iot-bridge.ts": { lines: 85, branches: 75 },
        "src/os-agent/perception-fusion.ts": { lines: 90, branches: 80 },
        "src/os-agent/os-agent-tool.ts": { lines: 90, branches: 80 },
        "src/os-agent/index.ts": { lines: 80, branches: 70 },
      },
    },
  },
})
