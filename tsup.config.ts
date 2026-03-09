import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/main.ts", "src/cli/onboard.ts", "src/cli/doctor.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  external: [
    "playwright",
    "@lancedb/lancedb",
    "prisma",
    "@prisma/client",
    "baileys",
    "redis",
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})
