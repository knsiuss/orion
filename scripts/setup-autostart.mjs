#!/usr/bin/env node
/**
 * setup-autostart.mjs
 * Detects OS and prints platform-specific instructions for running EDITH on boot.
 * Generates template files with correct absolute paths substituted.
 * Usage: pnpm run setup:autostart
 */

import { platform } from "node:os"
import { resolve, dirname } from "node:path"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const installDir = resolve(__dirname, "..")
const user = process.env.USER ?? process.env.USERNAME ?? "edith"
const os = platform()

function fill(template, replacements) {
  return Object.entries(replacements).reduce(
    (s, [k, v]) => s.replaceAll(k, v),
    template
  )
}

function readTemplate(filename) {
  return readFileSync(resolve(__dirname, filename), "utf-8")
}

// Ensure .edith/logs exists for log output paths
mkdirSync(resolve(installDir, ".edith", "logs"), { recursive: true })

console.log("\n=== EDITH Auto-start Setup ===")
console.log(`Install directory : ${installDir}`)
console.log(`Detected OS       : ${os}`)
console.log(`User              : ${user}\n`)

const replacements = {
  __INSTALL_DIR__: installDir,
  __USER__: user,
}

if (os === "linux") {
  const src = readTemplate("edith.service")
  const out = fill(src, replacements)
  const outPath = "/tmp/edith.service"
  writeFileSync(outPath, out)
  console.log(`✓ systemd unit written to ${outPath}\n`)
  console.log("Run these commands to install:\n")
  console.log(`  sudo cp ${outPath} /etc/systemd/system/`)
  console.log("  sudo systemctl daemon-reload")
  console.log("  sudo systemctl enable edith")
  console.log("  sudo systemctl start edith")
  console.log("\nTo check status:")
  console.log("  sudo systemctl status edith")
} else if (os === "darwin") {
  const src = readTemplate("com.edith.plist")
  const out = fill(src, replacements)
  const launchAgentsDir = `${process.env.HOME}/Library/LaunchAgents`
  const dest = `${launchAgentsDir}/com.edith.plist`
  mkdirSync(launchAgentsDir, { recursive: true })
  writeFileSync(dest, out)
  console.log(`✓ launchd plist written to ${dest}\n`)
  console.log("Run to enable:")
  console.log(`  launchctl load -w ${dest}`)
  console.log("\nTo stop EDITH:")
  console.log(`  launchctl unload ${dest}`)
} else if (os === "win32") {
  console.log("Windows detected.\n")
  console.log("Option 1 — PM2 (recommended, works in any shell):")
  console.log("  npm install -g pm2")
  console.log(`  pm2 start "${installDir}\\scripts\\ecosystem.config.cjs"`)
  console.log("  pm2 save")
  console.log("  pm2 startup  (follow the printed command)\n")
  console.log("Option 2 — Task Scheduler:")
  console.log("  1. Open Task Scheduler → Create Basic Task")
  console.log(`  2. Program: node`)
  console.log(`  3. Arguments: --import tsx/esm "${installDir}\\src\\main.ts"`)
  console.log(`  4. Start in: ${installDir}`)
  console.log("  5. Set trigger: At startup / At logon")
} else {
  console.log(`Unknown OS: ${os}`)
}

// Always show PM2 as universal fallback
console.log("\n--- Universal: PM2 (works on all platforms) ---")
console.log("  npm install -g pm2")
const ecosystemPath = resolve(__dirname, "ecosystem.config.cjs")
// Write PM2 config with correct install dir
const pm2Src = readTemplate("ecosystem.config.cjs")
const pm2Out = fill(pm2Src, replacements)
writeFileSync(ecosystemPath, pm2Out)
console.log(`  pm2 start ${ecosystemPath}`)
console.log("  pm2 save\n")
