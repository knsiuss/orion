/**
 * @file knip.config.ts
 * @description Dead export and unused dependency detection configuration.
 *
 * Run with: pnpm knip
 */

export default {
  project: ["src/**/*.ts"],
  ignore: [
    "src/**/*.test.ts",
    "src/**/__tests__/**",
    "python/**",
    "apps/**",
  ],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: [
    // Prisma CLI is used via npx / pnpm exec, not imported
    "prisma",
    // tsx is used as a dev runner
    "tsx",
  ],
}
