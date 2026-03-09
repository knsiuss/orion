/**
 * @file doctor.ts
 * @description EDITH health check CLI. Validates database, API keys, ports, and tools.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Standalone CLI entry point (pnpm doctor). Uses banner.ts for consistent branding.
 */

import fs from "node:fs/promises"
import net from "node:net"

import { execa } from "execa"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { printBanner, printStatusBox, colors, type StatusItem, type StatusSection } from "./banner.js"

const log = createLogger("cli.doctor")

type Level = "ok" | "warn" | "error"

interface CheckResult {
  level: Level
  label: string
  detail: string
}

async function checkPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  try {
    await prisma.$connect()
    const count = await prisma.message.count()
    results.push({ level: "ok", label: "Database", detail: `Connected (SQLite, ${count} messages)` })
  } catch (error) {
    results.push({ level: "error", label: "Database", detail: `Failed to connect: ${String(error)}` })
  }

  try {
    await memory.init()
    results.push({ level: "ok", label: "LanceDB", detail: "Initialized" })
  } catch (error) {
    results.push({ level: "error", label: "LanceDB", detail: `Init failed: ${String(error)}` })
  }

  const apiChecks: Array<{ name: string; value: string }> = [
    { name: "Anthropic", value: config.ANTHROPIC_API_KEY },
    { name: "OpenAI", value: config.OPENAI_API_KEY },
    { name: "Gemini", value: config.GEMINI_API_KEY },
    { name: "Groq", value: config.GROQ_API_KEY },
    { name: "OpenRouter", value: config.OPENROUTER_API_KEY },
  ]

  for (const item of apiChecks) {
    if (item.value.trim()) {
      results.push({ level: "ok", label: item.name, detail: "API key configured" })
    } else {
      results.push({ level: "warn", label: item.name, detail: "API key missing" })
    }
  }

  try {
    await fs.access(config.PERMISSIONS_FILE)
    results.push({ level: "ok", label: "Permissions", detail: `Found ${config.PERMISSIONS_FILE}` })
  } catch {
    results.push({ level: "error", label: "Permissions", detail: `Missing ${config.PERMISSIONS_FILE}` })
  }

  try {
    const { stdout, stderr } = await execa(config.PYTHON_PATH, ["--version"], { timeout: 10_000 })
    results.push({ level: "ok", label: "Python", detail: (stdout || stderr).trim() || "Detected" })
  } catch (error) {
    results.push({ level: "error", label: "Python", detail: `Not available: ${String(error)}` })
  }

  const gatewayFree = await checkPortAvailable(config.GATEWAY_PORT)
  results.push({
    level: gatewayFree ? "ok" : "warn",
    label: "Gateway Port",
    detail: gatewayFree
      ? `Port ${config.GATEWAY_PORT} available`
      : `Port ${config.GATEWAY_PORT} already in use`,
  })

  const webchatFree = await checkPortAvailable(config.WEBCHAT_PORT)
  results.push({
    level: webchatFree ? "ok" : "warn",
    label: "WebChat Port",
    detail: webchatFree
      ? `Port ${config.WEBCHAT_PORT} available`
      : `Port ${config.WEBCHAT_PORT} already in use`,
  })

  if (config.DISCORD_BOT_TOKEN.trim() && !config.DISCORD_CHANNEL_ID.trim()) {
    results.push({ level: "warn", label: "Discord", detail: "Token configured but DISCORD_CHANNEL_ID missing" })
  }

  if (config.TELEGRAM_BOT_TOKEN.trim() && !config.TELEGRAM_CHAT_ID.trim()) {
    results.push({ level: "warn", label: "Telegram", detail: "Token configured but TELEGRAM_CHAT_ID missing" })
  }

  if (config.WHATSAPP_ENABLED) {
    results.push({ level: "ok", label: "WhatsApp", detail: "Enabled" })
  }

  // Check if at least one LLM API key is configured
  const hasAnyKey = apiChecks.some((item) => item.value.trim().length > 0)
  if (!hasAnyKey) {
    results.push({ level: "error", label: "LLM Provider", detail: "No API key configured — EDITH needs at least one" })
  }

  // Check workspace/SOUL.md exists
  try {
    await fs.access("workspace/SOUL.md")
    results.push({ level: "ok", label: "SOUL.md", detail: "Found workspace/SOUL.md" })
  } catch {
    results.push({ level: "error", label: "SOUL.md", detail: "Missing workspace/SOUL.md — persona file required" })
  }

  // Check .env file exists
  try {
    await fs.access(".env")
    results.push({ level: "ok", label: ".env", detail: "Found .env file" })
  } catch {
    results.push({ level: "warn", label: ".env", detail: "No .env file — using environment defaults" })
  }

  // Check if gateway is reachable (if port is in use, it might be running)
  if (!gatewayFree) {
    try {
      const r = await fetch(`http://127.0.0.1:${config.GATEWAY_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (r.ok) {
        results.push({ level: "ok", label: "Gateway Health", detail: "Gateway responding at /health" })
      } else {
        results.push({ level: "warn", label: "Gateway Health", detail: `Gateway returned ${r.status}` })
      }
    } catch {
      results.push({ level: "warn", label: "Gateway Health", detail: "Port in use but /health unreachable" })
    }
  }

  return results
}

/** Groups flat check results into themed StatusSections. */
function groupResults(results: CheckResult[]): StatusSection[] {
  const storageLabels = new Set(["Database", "LanceDB"])
  const apiLabels = new Set(["Anthropic", "OpenAI", "Gemini", "Groq", "OpenRouter"])
  const networkLabels = new Set(["Gateway Port", "WebChat Port", "Gateway Health"])

  const toItem = (r: CheckResult): StatusItem => ({
    label: r.label,
    value: r.detail,
    level: r.level,
  })

  const storage = results.filter((r) => storageLabels.has(r.label)).map(toItem)
  const apiKeys = results.filter((r) => apiLabels.has(r.label)).map(toItem)
  const network = results.filter((r) => networkLabels.has(r.label)).map(toItem)
  const tools = results.filter(
    (r) => !storageLabels.has(r.label) && !apiLabels.has(r.label) && !networkLabels.has(r.label),
  ).map(toItem)

  const sections: StatusSection[] = []
  if (storage.length > 0) sections.push({ title: "Storage", items: storage })
  if (apiKeys.length > 0) sections.push({ title: "API Keys", items: apiKeys })
  if (network.length > 0) sections.push({ title: "Network", items: network })
  if (tools.length > 0) sections.push({ title: "Tools & Config", items: tools })

  return sections
}

async function main(): Promise<void> {
  printBanner({ subtitle: "Doctor" })

  const results = await runChecks()
  const errors = results.filter((item) => item.level === "error").length
  const warnings = results.filter((item) => item.level === "warn").length

  const sections = groupResults(results)
  printStatusBox(sections)

  // Summary line
  if (errors > 0) {
    process.stdout.write(colors.error(`  ${errors} error(s), ${warnings} warning(s)\n`))
  } else if (warnings > 0) {
    process.stdout.write(colors.warning(`  0 errors, ${warnings} warning(s)\n`))
  } else {
    process.stdout.write(colors.success("  All checks passed\n"))
  }

  await prisma.$disconnect().catch((error: unknown) => log.warn("prisma disconnect failed", error))

  process.exit(errors > 0 ? 1 : 0)
}

void main()
