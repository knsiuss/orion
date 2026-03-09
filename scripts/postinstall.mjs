/**
 * @file postinstall.mjs
 * @description Postinstall script for EDITH.
 *   Runs `prisma generate` to build the Prisma client.
 *   - In project dev mode (pnpm install): uses local prisma from devDependencies.
 *   - In global npm install: local prisma CLI is absent (devDep not installed),
 *     so we fall back to `npx --yes prisma@<version> generate`.
 *   Exits 0 in all cases to avoid blocking installation.
 */

import { execSync } from "child_process"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, "..", "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

const prismaVersion =
  (pkg.devDependencies?.prisma ?? pkg.dependencies?.prisma ?? "latest").replace(
    /[^0-9.]/g,
    ""
  ) || "latest"

function run(cmd, label) {
  console.log(`[EDITH postinstall] ${label}`)
  execSync(cmd, { stdio: "inherit", shell: true })
}

// Attempt 1: local prisma CLI (works in dev / pnpm install where prisma is a devDep)
try {
  run("prisma generate", "Running prisma generate (local)...")
  process.exit(0)
} catch {
  // prisma CLI not available locally — expected during npm install -g
}

// Attempt 2: npx prisma generate (downloads CLI one-time, works during npm install -g)
try {
  run(
    `npx --yes prisma@${prismaVersion} generate`,
    `Running npx prisma@${prismaVersion} generate (global install fallback)...`
  )
  process.exit(0)
} catch (err) {
  console.warn(
    "[EDITH postinstall] Warning: Could not run prisma generate.",
    "\n  → Run `npx prisma generate` manually from the EDITH install directory before first launch.",
    "\n  → Or it will be attempted automatically on first `edith` launch."
  )
  process.exit(0)
}
