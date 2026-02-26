#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const CLI_CONFIG_DIR_NAME = ".orion"
const CLI_CONFIG_FILE_NAME = "cli.json"
const LOCAL_PACKAGE_NAME = "orion"

function printHelp() {
  console.log("Orion CLI (OpenClaw-style wrapper)")
  console.log("==================================")
  console.log("")
  console.log("Usage:")
  console.log("  orion link <path-to-orion-ts>     Link your Orion repo once")
  console.log("  orion repo                        Show linked repo path")
  console.log("  orion quickstart                  Run onboarding wizard")
  console.log("  orion wa scan                     WhatsApp QR setup (OpenClaw-style)")
  console.log("  orion wa cloud                    WhatsApp Cloud API setup")
  console.log("  orion all                         Start Orion (gateway + channels + CLI)")
  console.log("  orion gateway                     Start gateway mode")
  console.log("  orion doctor                      Run doctor checks")
  console.log("  orion onboard -- <args>           Pass raw args to onboard CLI")
  console.log("")
  console.log("Options:")
  console.log("  --repo <path>                     Override linked repo for this command")
  console.log("  --help, -h                        Show help")
  console.log("")
  console.log("Examples:")
  console.log("  orion link C:\\Users\\you\\orion\\orion-ts")
  console.log("  orion wa scan")
  console.log("  orion all")
}

function normalizePathInput(value) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().replace(/^"(.*)"$/, "$1")
  return trimmed || null
}

export function getCliConfigDir() {
  return path.join(os.homedir(), CLI_CONFIG_DIR_NAME)
}

export function getCliConfigPath() {
  return path.join(getCliConfigDir(), CLI_CONFIG_FILE_NAME)
}

export function parseOrionCliArgs(argv) {
  const args = [...argv]
  let repoOverride = null
  const positionals = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      return { repoOverride: null, positionals: [], help: true }
    }
    if (arg === "--repo" && args[i + 1]) {
      repoOverride = normalizePathInput(args[i + 1])
      i += 1
      continue
    }
    if (arg.startsWith("--repo=")) {
      repoOverride = normalizePathInput(arg.slice("--repo=".length))
      continue
    }
    positionals.push(arg)
  }

  return { repoOverride, positionals, help: false }
}

export async function loadCliConfig(fsModule = fs) {
  try {
    const raw = await fsModule.readFile(getCliConfigPath(), "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

export async function saveCliConfig(config, fsModule = fs) {
  await fsModule.mkdir(getCliConfigDir(), { recursive: true })
  const content = `${JSON.stringify(config, null, 2)}\n`
  await fsModule.writeFile(getCliConfigPath(), content, "utf-8")
}

export async function isOrionRepoDir(repoDir, fsModule = fs) {
  const packageJsonPath = path.join(repoDir, "package.json")
  try {
    const raw = await fsModule.readFile(packageJsonPath, "utf-8")
    const parsed = JSON.parse(raw)
    return parsed?.name === LOCAL_PACKAGE_NAME
  } catch {
    return false
  }
}

export async function findOrionRepoUpwards(startDir, fsModule = fs) {
  let current = path.resolve(startDir)

  while (true) {
    if (await isOrionRepoDir(current, fsModule)) {
      return current
    }

    const nestedCandidate = path.join(current, "orion-ts")
    if (await isOrionRepoDir(nestedCandidate, fsModule)) {
      return nestedCandidate
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

async function resolveRepoDir(repoOverride) {
  if (repoOverride) {
    const resolved = path.resolve(process.cwd(), repoOverride)
    if (!(await isOrionRepoDir(resolved))) {
      throw new Error(`Invalid Orion repo path: ${resolved}`)
    }
    return resolved
  }

  const envRepo = normalizePathInput(process.env.ORION_REPO_DIR ?? "")
  if (envRepo) {
    const resolved = path.resolve(envRepo)
    if (await isOrionRepoDir(resolved)) {
      return resolved
    }
  }

  const autoDetected = await findOrionRepoUpwards(process.cwd())
  if (autoDetected) {
    return autoDetected
  }

  const cfg = await loadCliConfig()
  const linkedRepo = normalizePathInput(typeof cfg.repoDir === "string" ? cfg.repoDir : "")
  if (linkedRepo) {
    const resolved = path.resolve(linkedRepo)
    if (await isOrionRepoDir(resolved)) {
      return resolved
    }
    throw new Error(`Linked repo not found or invalid: ${resolved}. Run \`orion link <path>\` again.`)
  }

  throw new Error("No Orion repo linked. Run `orion link <path-to-orion-ts>` first.")
}

async function runChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  })

  return await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`))
        return
      }
      resolve(code ?? 0)
    })
  })
}

async function runPnpmScript(repoDir, script, extraArgs = []) {
  const args = ["--dir", repoDir, script, ...extraArgs]
  const code = await runChild("pnpm", args)
  process.exit(code)
}

async function runPnpmRaw(repoDir, args) {
  const code = await runChild("pnpm", ["--dir", repoDir, ...args])
  process.exit(code)
}

async function handleLink(targetPathArg) {
  const candidate = targetPathArg
    ? path.resolve(process.cwd(), targetPathArg)
    : await findOrionRepoUpwards(process.cwd())

  if (!candidate) {
    throw new Error("Could not auto-detect Orion repo here. Pass a path: `orion link <path-to-orion-ts>`")
  }

  if (!(await isOrionRepoDir(candidate))) {
    throw new Error(`Not an Orion repo: ${candidate}`)
  }

  await saveCliConfig({ repoDir: candidate })
  console.log(`Linked Orion repo: ${candidate}`)
  console.log("You can now run `orion wa scan` or `orion quickstart` from any directory.")
}

async function handleRepo(repoOverride) {
  const repoDir = await resolveRepoDir(repoOverride)
  console.log(repoDir)
}

async function handleCommand(repoOverride, positionals) {
  const [command, ...rest] = positionals

  if (!command || command === "help") {
    printHelp()
    return
  }

  if (command === "link") {
    await handleLink(rest[0] ?? null)
    return
  }

  if (command === "unlink") {
    await saveCliConfig({})
    console.log("Unlinked Orion repo.")
    return
  }

  if (command === "repo") {
    await handleRepo(repoOverride)
    return
  }

  const repoDir = await resolveRepoDir(repoOverride)

  if (command === "quickstart" || command === "setup" || command === "init") {
    await runPnpmScript(repoDir, "quickstart")
    return
  }

  if (command === "wa") {
    const sub = (rest[0] ?? "").toLowerCase()
    if (sub === "scan") {
      await runPnpmScript(repoDir, "wa:scan")
      return
    }
    if (sub === "cloud") {
      await runPnpmScript(repoDir, "wa:cloud")
      return
    }
    throw new Error("Unknown `orion wa` subcommand. Use `orion wa scan` or `orion wa cloud`.")
  }

  if (command === "all" || command === "doctor" || command === "gateway") {
    await runPnpmScript(repoDir, command)
    return
  }

  if (command === "onboard") {
    const delimiterIndex = rest.indexOf("--")
    const forwardArgs = delimiterIndex >= 0 ? rest.slice(delimiterIndex + 1) : rest
    await runPnpmRaw(repoDir, ["onboard", "--", ...forwardArgs])
    return
  }

  if (command === "run" && rest[0]) {
    const [script, ...scriptArgs] = rest
    await runPnpmScript(repoDir, script, scriptArgs)
    return
  }

  throw new Error(`Unknown command: ${command}. Run \`orion help\`.`)
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseOrionCliArgs(argv)
  if (parsed.help) {
    printHelp()
    return
  }

  try {
    await handleCommand(parsed.repoOverride, parsed.positionals)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Orion CLI error: ${message}`)
    if (/No Orion repo linked/i.test(message)) {
      console.error("Hint: run `orion link C:\\path\\to\\orion-ts` once, then retry.")
    }
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === invokedPath) {
  void main()
}

