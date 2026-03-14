import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.e2e.test.ts", "**/*.live.test.ts"],
    environment: "node",
  },
})
