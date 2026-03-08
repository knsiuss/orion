import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { pathToFileURL } from "node:url"

import dotenv from "dotenv"
import { execa } from "execa"

import { printBanner, colors, spinner } from "./banner.js"

type ChannelChoice = "telegram" | "discord" | "whatsapp" | "webchat"
type ProviderChoice = "groq" | "openrouter" | "anthropic" | "openai" | "gemini" | "ollama"
type WhatsAppSetupMode = "scan" | "cloud"

type WriteMode = "write" | "print"

interface OnboardArgs {
  flow: "quickstart"
  channel: ChannelChoice | null
  provider: ProviderChoice | null
  whatsappMode: WhatsAppSetupMode | null
  writeMode: WriteMode
  yes: boolean
}

interface EnvTemplate {
  content: string
  source: ".env" | ".env.example" | "empty"
}

interface OnboardEnvPaths {
  envPath: string
  envExamplePath: string
}

interface QuickstartPlan {
  channel: ChannelChoice
  provider: ProviderChoice
  updates: Record<string, string>
  computerUseEnabled: boolean
}

interface NextStepCommands {
  doctor: string
  all: string
  onboard: string
}

const DEFAULT_ONBOARD_COMPUTER_USE_CONFIG = {
  enabled: true,
  planner: "lats",
  fallbackPlanner: "dag",
  maxEpisodes: 30,
  maxStepsPerEpisode: 20,
  explorationConstant: 1.4142135623730951,
  expansionBranches: 3,
  taskTimeoutMs: 120000,
  browser: {
    injectSetOfMark: true,
    maxElements: 50,
    pageTimeoutMs: 15000,
    headless: true,
  },
  fileAgent: {
    allowedPaths: ["./workspace", "./workbenches"],
    maxFileSizeMb: 10,
    allowWrite: true,
  },
} as const

const CHANNEL_CHOICES: ReadonlyArray<{ key: ChannelChoice; label: string; description: string }> = [
  { key: "telegram", label: "Telegram (recommended)", description: "Fastest path for phone testing via Bot API" },
  { key: "discord", label: "Discord", description: "Good for DMs or one allowlisted server channel" },
  { key: "whatsapp", label: "WhatsApp (Cloud API)", description: "Phone-native test via Meta WhatsApp Cloud API + webhook" },
  { key: "webchat", label: "WebChat (local browser)", description: "No external token needed; local-only testing" },
]

const PROVIDER_CHOICES: ReadonlyArray<{ key: ProviderChoice; label: string; description: string }> = [
  { key: "groq", label: "Groq (recommended quick start)", description: "Fast and easy for chat testing" },
  { key: "openrouter", label: "OpenRouter", description: "Many models behind one API key" },
  { key: "anthropic", label: "Anthropic", description: "Claude API key" },
  { key: "openai", label: "OpenAI", description: "OpenAI API key" },
  { key: "gemini", label: "Gemini", description: "Google AI Studio / Gemini API key" },
  { key: "ollama", label: "Ollama (local model)", description: "No paid API key required" },
]

const WHATSAPP_MODE_CHOICES: ReadonlyArray<{ key: WhatsAppSetupMode; label: string; description: string }> = [
  { key: "scan", label: "Scan QR (recommended)", description: "Fastest OpenClaw-style test using Baileys (no Meta dashboard)" },
  { key: "cloud", label: "Cloud API", description: "Official Meta API with webhook, token, and phone number ID" },
]

function printHelp(): void {
  console.log("EDITH Onboarding (OpenClaw-inspired)")
  console.log("====================================")
  console.log("")
  console.log("Usage:")
  console.log("  pnpm quickstart   # beginner-friendly quickstart wizard (recommended)")
  console.log("  pnpm onboard -- [--channel telegram|discord|whatsapp|webchat] [--provider groq|openrouter|anthropic|openai|gemini|ollama] [--whatsapp-mode scan|cloud]")
  console.log("  pnpm wa:scan      # one-command WhatsApp QR setup (OpenClaw-style)")
  console.log("  pnpm run setup    # compatibility alias (avoid bare `pnpm setup`, it conflicts with pnpm built-in)")
  console.log("")
  console.log("Options:")
  console.log("  --flow quickstart   Only supported flow (default)")
  console.log("  --channel <name>    Preselect a channel")
  console.log("  --provider <name>   Preselect an AI provider")
  console.log("  --print-only        Do not write .env; print the planned changes")
  console.log("  --write             Force writing .env without print-only")
  console.log("  --yes               Non-interactive mode: use defaults, skip optional prompts, and skip final confirmation")
  console.log("  --non-interactive   Alias for --yes (OpenClaw-style automation flag)")
  console.log("  --wizard            Compatibility no-op (reserved for setup parity)")
  console.log("  --help, -h          Show this help")
}

function isChannelChoice(value: string): value is ChannelChoice {
  return CHANNEL_CHOICES.some((item) => item.key === value)
}

function isProviderChoice(value: string): value is ProviderChoice {
  return PROVIDER_CHOICES.some((item) => item.key === value)
}

function isWhatsAppSetupMode(value: string): value is WhatsAppSetupMode {
  return WHATSAPP_MODE_CHOICES.some((item) => item.key === value)
}

export function parseOnboardArgs(argv: string[]): OnboardArgs {
  let flow: "quickstart" = "quickstart"
  let channel: ChannelChoice | null = null
  let provider: ProviderChoice | null = null
  let whatsappMode: WhatsAppSetupMode | null = null
  let writeMode: WriteMode = "write"
  let yes = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--flow" && argv[i + 1]) {
      const next = argv[i + 1]
      i += 1
      if (next !== "quickstart") {
        throw new Error(`Unsupported --flow '${next}'. Only 'quickstart' is currently supported.`)
      }
      flow = "quickstart"
      continue
    }
    if (arg === "--flow=quickstart") {
      flow = "quickstart"
      continue
    }
    if (arg === "--channel" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isChannelChoice(next)) {
        throw new Error(`Invalid --channel '${next}'`)
      }
      channel = next
      continue
    }
    if (arg.startsWith("--channel=")) {
      const next = arg.slice("--channel=".length).trim().toLowerCase()
      if (!isChannelChoice(next)) {
        throw new Error(`Invalid --channel '${next}'`)
      }
      channel = next
      continue
    }
    if (arg === "--provider" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isProviderChoice(next)) {
        throw new Error(`Invalid --provider '${next}'`)
      }
      provider = next
      continue
    }
    if (arg === "--whatsapp-mode" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isWhatsAppSetupMode(next)) {
        throw new Error(`Invalid --whatsapp-mode '${next}'`)
      }
      whatsappMode = next
      continue
    }
    if (arg.startsWith("--whatsapp-mode=")) {
      const next = arg.slice("--whatsapp-mode=".length).trim().toLowerCase()
      if (!isWhatsAppSetupMode(next)) {
        throw new Error(`Invalid --whatsapp-mode '${next}'`)
      }
      whatsappMode = next
      continue
    }
    if (arg.startsWith("--provider=")) {
      const next = arg.slice("--provider=".length).trim().toLowerCase()
      if (!isProviderChoice(next)) {
        throw new Error(`Invalid --provider '${next}'`)
      }
      provider = next
      continue
    }
    if (arg === "--print-only") {
      writeMode = "print"
      continue
    }
    if (arg === "--write") {
      writeMode = "write"
      continue
    }
    if (arg === "--yes" || arg === "-y" || arg === "--non-interactive") {
      yes = true
      continue
    }
    if (arg === "--wizard") {
      continue
    }
  }

  return { flow, channel, provider, whatsappMode, writeMode, yes }
}

function providerEnvKey(provider: ProviderChoice): "GROQ_API_KEY" | "OPENROUTER_API_KEY" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY" | "OLLAMA_BASE_URL" {
  switch (provider) {
    case "groq":
      return "GROQ_API_KEY"
    case "openrouter":
      return "OPENROUTER_API_KEY"
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "openai":
      return "OPENAI_API_KEY"
    case "gemini":
      return "GEMINI_API_KEY"
    case "ollama":
      return "OLLAMA_BASE_URL"
  }
}

function readEnvValueMap(content: string): Record<string, string> {
  try {
    return dotenv.parse(content)
  } catch {
    return {}
  }
}

function formatEnvValue(value: string): string {
  if (/[\s#]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

function parseEnvLineKey(line: string): string | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  return match?.[1] ?? null
}

export function mergeEnvContent(baseContent: string, updates: Record<string, string>): string {
  const normalizedBase = baseContent.replace(/\r\n/g, "\n")
  const lines = normalizedBase.split("\n")
  const out: string[] = []
  const presentKeys = new Set<string>()

  for (const line of lines) {
    const key = parseEnvLineKey(line)
    if (!key || !(key in updates)) {
      out.push(line)
      continue
    }

    out.push(`${key}=${formatEnvValue(updates[key] ?? "")}`)
    presentKeys.add(key)
  }

  const missingEntries = Object.entries(updates).filter(([key]) => !presentKeys.has(key))
  if (missingEntries.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== "") {
      out.push("")
    }
    out.push("# Added by `pnpm onboard` quickstart wizard")
    for (const [key, value] of missingEntries) {
      out.push(`${key}=${formatEnvValue(value)}`)
    }
  }

  return `${out.join("\n").replace(/\n+$/g, "")}\n`
}

async function loadEnvTemplate(cwd: string): Promise<EnvTemplate> {
  const paths = resolveOnboardEnvPaths(cwd)
  const envPath = paths.envPath
  const envExamplePath = paths.envExamplePath

  try {
    return {
      content: await fs.readFile(envPath, "utf-8"),
      source: ".env",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  try {
    return {
      content: await fs.readFile(envExamplePath, "utf-8"),
      source: ".env.example",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  return { content: "", source: "empty" }
}

function resolveOnboardEnvPaths(cwd: string): OnboardEnvPaths {
  const explicitEnvPath = typeof process.env.EDITH_ENV_FILE === "string" && process.env.EDITH_ENV_FILE.trim().length > 0
    ? path.resolve(process.env.EDITH_ENV_FILE.trim())
    : null

  return {
    envPath: explicitEnvPath ?? path.join(cwd, ".env"),
    // Keep using the repo template as the canonical base when writing a profile env.
    envExamplePath: path.join(cwd, ".env.example"),
  }
}

function resolveOnboardConfigPath(cwd: string): string {
  return path.join(cwd, "edith.json")
}

async function writeComputerUseConfig(cwd: string, enabled: boolean): Promise<string> {
  const configPath = resolveOnboardConfigPath(cwd)
  let parsed: Record<string, unknown> = {}

  try {
    parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  const currentComputerUse =
    parsed.computerUse && typeof parsed.computerUse === "object"
      ? parsed.computerUse as Record<string, unknown>
      : {}

  parsed.computerUse = {
    ...DEFAULT_ONBOARD_COMPUTER_USE_CONFIG,
    ...currentComputerUse,
    enabled,
  }

  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8")
  return configPath
}

function redactSecretValue(key: string, value: string): string {
  if (!/_KEY$|TOKEN|PASSWORD|SECRET/.test(key)) {
    return value
  }
  if (!value) {
    return value
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`
}

function defaultNextStepCommands(env: NodeJS.ProcessEnv = process.env): NextStepCommands {
  const usingGlobalWrapper = [env.EDITH_ENV_FILE, env.EDITH_WORKSPACE, env.EDITH_STATE_DIR]
    .some((value) => typeof value === "string" && value.trim().length > 0)

  if (usingGlobalWrapper) {
    return {
      doctor: "edith doctor",
      all: "edith all",
      onboard: "edith onboard",
    }
  }

  return {
    doctor: "pnpm doctor",
    all: "pnpm all",
    onboard: "pnpm onboard",
  }
}

function buildNextSteps(plan: QuickstartPlan, commands: NextStepCommands = defaultNextStepCommands()): string[] {
  const lines: string[] = []

  lines.push(colors.accent("✅ Setup complete!"))
  lines.push("")
  lines.push("Start EDITH:")
  lines.push(`  \`${commands.all}\`              # start all channels`)
  lines.push("")
  lines.push("Check status:")
  lines.push(`  \`${commands.doctor}\`           # health check`)
  lines.push(`  \`pnpm typecheck\`        # TypeScript check`)
  lines.push("")
  lines.push("Useful commands:")
  lines.push(`  \`${commands.onboard}\`         # re-run wizard anytime`)
  lines.push(`  \`pnpm dev -- --mode text\`    # text-only CLI mode`)
  lines.push(`  \`pnpm dev -- --mode gateway\` # HTTP gateway only`)

  if (plan.channel === "telegram") {
    lines.push("")
    lines.push("Telegram setup:")
    lines.push("  1. DM your bot and run /start, /id, /ping")
    if (!plan.updates.TELEGRAM_CHAT_ID) {
      lines.push(`  2. Copy /id result into TELEGRAM_CHAT_ID and rerun \`${commands.onboard}\``)
    }
    lines.push("  → docs/channels/telegram.md")
  } else if (plan.channel === "discord") {
    lines.push("")
    lines.push("Discord setup:")
    lines.push("  1. Enable Message Content Intent in Discord Developer Portal")
    lines.push("  2. DM the bot and run !help, !id, !ping")
    if (!plan.updates.DISCORD_CHANNEL_ID) {
      lines.push(`  3. Add !id result to DISCORD_CHANNEL_ID and rerun \`${commands.onboard}\``)
    }
    lines.push("  → docs/channels/discord.md")
  } else if (plan.channel === "whatsapp") {
    const isCloudMode = (plan.updates.WHATSAPP_MODE ?? "").trim().toLowerCase() === "cloud"
    lines.push("")
    lines.push("WhatsApp setup:")
    if (isCloudMode) {
      lines.push("  1. Expose gateway publicly (Cloudflare Tunnel / ngrok)")
      lines.push("  2. Point Meta webhook to /webhooks/whatsapp")
      lines.push("  3. Set verify token = WHATSAPP_CLOUD_VERIFY_TOKEN")
    } else {
      lines.push(`  1. Scan the QR code when it appears in terminal (WHATSAPP_MODE=baileys)`)
      lines.push("  2. WhatsApp → Linked Devices → Link a Device")
    }
    lines.push("  → docs/channels/whatsapp.md")
  } else {
    lines.push("")
    lines.push("WebChat: open http://127.0.0.1:8080 after starting EDITH")
    lines.push(`  Add more channels later with \`${commands.onboard}\``)
  }

  lines.push("")
  lines.push("Docs: docs/platform/onboarding.md")

  return lines
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  prompt: string,
  choices: ReadonlyArray<{ key: T; label: string; description: string }>,
): Promise<T> {
  console.log("")
  console.log(colors.label(prompt))
  choices.forEach((choice, index) => {
    console.log(`  ${colors.accent(String(index + 1))}. ${colors.label(choice.label)}`)
    console.log(`     ${colors.dim(choice.description)}`)
  })

  while (true) {
    const raw = (await rl.question(`Select [1-${choices.length}] (default 1): `)).trim()
    if (!raw) {
      return choices[0].key
    }
    const index = Number.parseInt(raw, 10)
    if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1].key
    }
    const byKey = choices.find((choice) => choice.key === raw.toLowerCase())
    if (byKey) {
      return byKey.key
    }
    console.log("Invalid selection, try again.")
  }
}

async function askInput(
  rl: readline.Interface,
  label: string,
  opts: {
    current?: string | null
    placeholder?: string
    optional?: boolean
    defaultValue?: string
  } = {},
): Promise<string | null> {
  const suffixParts: string[] = []
  if (opts.current) {
    suffixParts.push(`current=${redactSecretValue(label, opts.current)}`)
  }
  if (opts.optional) {
    suffixParts.push("optional")
  }
  if (opts.placeholder) {
    suffixParts.push(opts.placeholder)
  }
  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : ""

  const prompt = `${colors.label(label)}${colors.dim(suffix)}: `
  const raw = (await rl.question(prompt)).trim()

  if (!raw) {
    if (opts.defaultValue !== undefined) {
      return opts.defaultValue
    }
    return opts.optional ? null : null
  }

  return raw
}

async function askYesNo(
  rl: readline.Interface,
  prompt: string,
  defaultYes = true,
): Promise<boolean> {
  const raw = (await rl.question(`${prompt} (${defaultYes ? "Y/n" : "y/N"}): `)).trim().toLowerCase()
  if (!raw) {
    return defaultYes
  }
  if (["y", "yes"].includes(raw)) {
    return true
  }
  if (["n", "no"].includes(raw)) {
    return false
  }
  return defaultYes
}

function buildQuickstartBanner(): void {
  printBanner({ subtitle: "Setup Wizard" })
  console.log("This wizard helps you:")
  console.log(`- choose a test channel (${colors.accent("Telegram")} / ${colors.accent("Discord")} / ${colors.accent("WhatsApp")} / ${colors.accent("WebChat")})`)
  console.log(`- for WhatsApp: choose ${colors.accent("Scan QR")} (quick test) or ${colors.accent("Cloud API")} (official)`)
  console.log("- choose a model provider")
  console.log("- write the minimum .env config for a phone-first quick test")
}

async function collectQuickstartPlan(
  args: OnboardArgs,
  envValues: Record<string, string>,
): Promise<QuickstartPlan> {
  const nonInteractive = args.yes
  const rl = nonInteractive ? null : readline.createInterface({ input, output })
  try {
    buildQuickstartBanner()
    if (nonInteractive) {
      console.log("")
      console.log("Non-interactive mode enabled (`--yes` / `--non-interactive`): using defaults and skipping optional prompts.")
    }

    const choose = async <T extends string>(
      selected: T | null,
      prompt: string,
      choices: ReadonlyArray<{ key: T; label: string; description: string }>,
    ): Promise<T> => {
      if (selected) {
        return selected
      }
      if (nonInteractive) {
        return choices[0].key
      }
      return askChoice(rl!, prompt, choices)
    }

    const askInputMaybe = async (
      label: string,
      opts: {
        current?: string | null
        placeholder?: string
        optional?: boolean
        defaultValue?: string
      } = {},
    ): Promise<string | null> => {
      if (nonInteractive) {
        return opts.defaultValue ?? null
      }
      return askInput(rl!, label, opts)
    }

    const askYesNoMaybe = async (prompt: string, defaultYes = true): Promise<boolean> => {
      if (nonInteractive) {
        return defaultYes
      }
      return askYesNo(rl!, prompt, defaultYes)
    }

    const channel = await choose(args.channel, "Choose your first test channel", CHANNEL_CHOICES)
    const provider = await choose(args.provider, "Choose your primary model provider", PROVIDER_CHOICES)

    const updates: Record<string, string> = {}

    const providerKey = providerEnvKey(provider)
    if (provider === "ollama") {
      const baseUrl = await askInputMaybe("OLLAMA_BASE_URL", {
        current: envValues.OLLAMA_BASE_URL ?? null,
        placeholder: "default=http://localhost:11434",
        defaultValue: envValues.OLLAMA_BASE_URL || "http://localhost:11434",
      })
      if (baseUrl) {
        updates[providerKey] = baseUrl
      }
    } else {
      const apiKey = await askInputMaybe(providerKey, {
        current: envValues[providerKey] ?? null,
        optional: true,
        placeholder: "leave blank to keep current / set later",
      })
      if (apiKey) {
        updates[providerKey] = apiKey
      }
    }

    if (channel === "telegram") {
      const botToken = await askInputMaybe("TELEGRAM_BOT_TOKEN", {
        current: envValues.TELEGRAM_BOT_TOKEN ?? null,
        optional: true,
        placeholder: "from @BotFather (leave blank to set later)",
      })
      const chatId = await askInputMaybe("TELEGRAM_CHAT_ID", {
        current: envValues.TELEGRAM_CHAT_ID ?? null,
        optional: true,
        placeholder: "allowlist chat id (optional now, use /id later)",
      })
      if (botToken) {
        updates.TELEGRAM_BOT_TOKEN = botToken
      }
      if (chatId) {
        updates.TELEGRAM_CHAT_ID = chatId
      }
    } else if (channel === "discord") {
      const botToken = await askInputMaybe("DISCORD_BOT_TOKEN", {
        current: envValues.DISCORD_BOT_TOKEN ?? null,
        optional: true,
        placeholder: "Discord Developer Portal token (leave blank to set later)",
      })
      const channelId = await askInputMaybe("DISCORD_CHANNEL_ID", {
        current: envValues.DISCORD_CHANNEL_ID ?? null,
        optional: true,
        placeholder: "allowlist channel id (optional; DMs work without it)",
      })
      if (botToken) {
        updates.DISCORD_BOT_TOKEN = botToken
      }
      if (channelId) {
        updates.DISCORD_CHANNEL_ID = channelId
      }
    } else if (channel === "whatsapp") {
      updates.WHATSAPP_ENABLED = "true"
      const whatsAppMode = await choose(args.whatsappMode, "Choose WhatsApp setup mode", WHATSAPP_MODE_CHOICES)

      if (whatsAppMode === "scan") {
        updates.WHATSAPP_MODE = "baileys"
      } else {
        const accessToken = await askInputMaybe("WHATSAPP_CLOUD_ACCESS_TOKEN", {
          current: envValues.WHATSAPP_CLOUD_ACCESS_TOKEN ?? null,
          optional: true,
          placeholder: "Meta permanent/long-lived access token (leave blank to set later)",
        })
        const phoneNumberId = await askInputMaybe("WHATSAPP_CLOUD_PHONE_NUMBER_ID", {
          current: envValues.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? null,
          optional: true,
          placeholder: "from Meta WhatsApp Cloud API dashboard",
        })
        const verifyTokenDefault =
          envValues.WHATSAPP_CLOUD_VERIFY_TOKEN
          || crypto.randomUUID().replaceAll("-", "")
        const verifyToken = await askInputMaybe("WHATSAPP_CLOUD_VERIFY_TOKEN", {
          current: envValues.WHATSAPP_CLOUD_VERIFY_TOKEN ?? null,
          placeholder: "used by Meta webhook verification (auto-generated if blank)",
          defaultValue: verifyTokenDefault,
        })
        const allowlist = await askInputMaybe("WHATSAPP_CLOUD_ALLOWED_WA_IDS", {
          current: envValues.WHATSAPP_CLOUD_ALLOWED_WA_IDS ?? null,
          optional: true,
          placeholder: "optional allowlist (comma/newline wa_id), use /id later",
        })
        const apiVersion = await askInputMaybe("WHATSAPP_CLOUD_API_VERSION", {
          current: envValues.WHATSAPP_CLOUD_API_VERSION ?? null,
          optional: true,
          placeholder: "default=v20.0",
          defaultValue: envValues.WHATSAPP_CLOUD_API_VERSION || "v20.0",
        })

        updates.WHATSAPP_MODE = "cloud"
        if (accessToken) {
          updates.WHATSAPP_CLOUD_ACCESS_TOKEN = accessToken
        }
        if (phoneNumberId) {
          updates.WHATSAPP_CLOUD_PHONE_NUMBER_ID = phoneNumberId
        }
        if (verifyToken) {
          updates.WHATSAPP_CLOUD_VERIFY_TOKEN = verifyToken
        }
        if (allowlist) {
          updates.WHATSAPP_CLOUD_ALLOWED_WA_IDS = allowlist
        }
        if (apiVersion) {
          updates.WHATSAPP_CLOUD_API_VERSION = apiVersion
        }
      }
    }

    const setAutoStartGateway = await askYesNoMaybe(
      "Set AUTO_START_GATEWAY=true for `pnpm dev`",
      channel === "whatsapp" && updates.WHATSAPP_MODE === "cloud",
    )
    if (setAutoStartGateway) {
      updates.AUTO_START_GATEWAY = "true"
    }

    const enableComputerUse = await askYesNoMaybe(
      "Enable computer use defaults in edith.json",
      true,
    )

    return { channel, provider, updates, computerUseEnabled: enableComputerUse }
  } finally {
    rl?.close()
  }
}

function printPlannedChanges(plan: QuickstartPlan, envPath: string, templateSource: EnvTemplate["source"]): void {
  console.log("")
  console.log(colors.label("Quickstart plan"))
  console.log(colors.dim("═".repeat(40)))
  console.log(`Channel:  ${colors.accent(plan.channel)}`)
  console.log(`Provider: ${colors.accent(plan.provider)}`)
  console.log(`Computer use: ${plan.computerUseEnabled ? colors.success("enabled") : colors.dim("disabled")}`)
  console.log(`Target env: ${colors.dim(envPath)} ${colors.dim(`(base: ${templateSource})`)}`)
  console.log("")
  if (Object.keys(plan.updates).length === 0) {
    console.log(colors.dim("No env changes collected (you can still run the next steps and set values later)."))
    return
  }
  console.log("Env updates:")
  for (const [key, value] of Object.entries(plan.updates)) {
    console.log(`  ${colors.label(key)}=${colors.dim(redactSecretValue(key, value))}`)
  }
}

async function writeEnvFile(cwd: string, template: EnvTemplate, updates: Record<string, string>): Promise<string> {
  const { envPath } = resolveOnboardEnvPaths(cwd)
  const merged = mergeEnvContent(template.content, updates)
  await fs.mkdir(path.dirname(envPath), { recursive: true })
  await fs.writeFile(envPath, merged, "utf-8")
  return envPath
}

async function runOnboarding(argv: string[]): Promise<void> {
  const args = parseOnboardArgs(argv)
  if (args.flow !== "quickstart") {
    throw new Error(`Unsupported flow: ${args.flow}`)
  }

  const cwd = process.cwd()
  const template = await loadEnvTemplate(cwd)
  const { envPath } = resolveOnboardEnvPaths(cwd)
  const currentEnv = readEnvValueMap(template.content)
  const plan = await collectQuickstartPlan(args, currentEnv)

  printPlannedChanges(plan, envPath, template.source)

  if (args.writeMode === "print") {
    console.log("")
    console.log("Print-only mode: .env was not modified.")
  } else {
    let shouldWrite = args.yes
    if (!shouldWrite) {
      const rl = readline.createInterface({ input, output })
      try {
        shouldWrite = await askYesNo(rl, "Write these changes to .env now?", true)
      } finally {
        rl.close()
      }
    }

    if (shouldWrite) {
      spinner.start("Writing configuration...")
      await writeEnvFile(cwd, template, plan.updates)
      const configPath = await writeComputerUseConfig(cwd, plan.computerUseEnabled)
      spinner.stop("Configuration saved", "ok")
      console.log(`  ${colors.dim(envPath)}`)
      console.log(`  ${colors.dim(configPath)}`)

      // ── Database setup ─────────────────────────────────────
      console.log("")
      spinner.start("Setting up database...")
      try {
        await execa("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], {
          stdio: "pipe",
          cwd,
        })
        spinner.stop("Database ready", "ok")
      } catch {
        spinner.stop("Database setup failed — run `pnpm db:push` manually", "error")
      }

      // ── Auto health check ──────────────────────────────────
      console.log("")
      console.log(colors.label("Running health check..."))
      try {
        await execa("pnpm", ["doctor"], { stdio: "inherit", cwd })
      } catch {
        console.log(colors.dim("  Some checks failed — see above. Re-run `pnpm doctor` anytime."))
      }
    } else {
      console.log("")
      console.log(colors.dim("Skipped writing .env"))
    }
  }

  console.log("")
  for (const line of buildNextSteps(plan)) {
    console.log(line)
  }
}

export const __onboardTestUtils = {
  parseOnboardArgs,
  mergeEnvContent,
  providerEnvKey,
  buildNextSteps,
  defaultNextStepCommands,
  parseEnvLineKey,
  writeComputerUseConfig,
}

async function main(): Promise<void> {
  try {
    await runOnboarding(process.argv.slice(2))
  } catch (error) {
    console.error(`Onboarding failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === invokedPath) {
  void main()
}
