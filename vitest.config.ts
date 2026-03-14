import { defineConfig } from "vitest/config"
import type { Plugin } from "vite"

/**
 * Strip shebang lines (#!/usr/bin/env node) from .js files before vitest transforms them.
 * bin/edith.js uses CRLF line endings (Windows) — handle both \r\n and \n.
 * Without this, vitest/esbuild throws "SyntaxError: Invalid or unexpected token".
 */
const stripShebangPlugin: Plugin = {
  name: "strip-shebang",
  enforce: "pre",
  transform(code, id) {
    // Match shebang at start of file, handling both CRLF (\r\n) and LF (\n)
    if (code.charCodeAt(0) === 35 && code.charCodeAt(1) === 33) {
      // Starts with #! — strip the entire first line
      const newlineIdx = code.indexOf("\n")
      if (newlineIdx === -1) {
        return { code: "" }
      }
      return { code: `// (shebang stripped)\n${code.slice(newlineIdx + 1)}` }
    }
  },
}

export default defineConfig({
  plugins: [stripShebangPlugin],
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        lines: 45,
        functions: 45,
        branches: 35,
        statements: 45,
      },
      exclude: [
        "src/cli/**",
        "src/database/**",
        "**/*.test.ts",
        "**/__tests__/**",
        "dist/**",
        "node_modules/**",
        "src/main.ts",
      ],
    },
  },
})
