/**
 * @file file-agent.ts
 * @description FileAgent — CaMeL-guarded file operations for EDITH computer use.
 * Tony Stark mode: keep the interface sharp. Elon mode: remove every hidden assumption about paths.
 */

import fs from "node:fs/promises"
import path from "node:path"

import { tool } from "ai"
import { z } from "zod"

import { loadEDITHConfig } from "../../config/edith-config.js"
import { createLogger } from "../../logger.js"
import { camelGuard, type TaintSource } from "../../security/camel-guard.js"

const log = createLogger("tools.file-agent")

const MAX_DEFAULT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const BLOCKED_FILE_PATTERNS = [/\.env$/i, /\.key$/i, /\.pem$/i, /credentials?/i, /secret/i]

export interface FileAgentOptions {
  allowedRoots?: string[]
  maxFileSizeBytes?: number
}

function clipContent(value: string, maxChars = 8_000): string {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, maxChars - 3)}...`
}

async function resolveAllowedRoots(explicitRoots?: string[]): Promise<string[]> {
  if (explicitRoots && explicitRoots.length > 0) {
    return explicitRoots.map((root) => path.resolve(process.cwd(), root))
  }

  const config = await loadEDITHConfig()
  const roots = config.computerUse?.fileAgent?.allowedPaths ?? ["./workspace", "./workbenches"]
  return roots.map((root) => path.resolve(process.cwd(), root))
}

function isBlockedSensitivePath(targetPath: string): boolean {
  return BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(targetPath))
}

async function ensurePathAllowed(targetPath: string, allowedRoots: string[]): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), targetPath)

  if (isBlockedSensitivePath(resolvedPath)) {
    throw new Error(`Sensitive file access blocked: ${resolvedPath}`)
  }

  // Path traversal prevention: resolve and verify against allowedPaths.
  const allowed = allowedRoots.some((root) => {
    const relativePath = path.relative(root, resolvedPath)
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  })

  if (!allowed) {
    throw new Error(`Path outside allowed roots: ${resolvedPath}`)
  }

  return resolvedPath
}

async function createBackupIfExists(targetPath: string): Promise<string | null> {
  try {
    await fs.stat(targetPath)
  } catch {
    return null
  }

  const backupPath = `${targetPath}.bak`
  await fs.copyFile(targetPath, backupPath)
  return backupPath
}

export class FileAgent {
  private readonly options: FileAgentOptions

  constructor(options: FileAgentOptions = {}) {
    this.options = options
  }

  /**
   * Execute a file operation inside the configured safe roots.
   */
  async execute(input: {
    action: "read" | "write" | "append" | "list" | "delete" | "info" | "move"
    path: string
    content?: string
    destination?: string
    capabilityToken?: string
    actorId?: string
    taintedSources?: TaintSource[]
  }): Promise<string> {
    const allowedRoots = await resolveAllowedRoots(this.options.allowedRoots)
    const targetPath = await ensurePathAllowed(input.path, allowedRoots)
    const actorId = input.actorId ?? "file-agent"
    const taintedSources = input.taintedSources ?? []

    const camelResult = camelGuard.check({
      actorId,
      toolName: "fileAgent",
      action: input.action,
      taintedSources,
      capabilityToken: input.capabilityToken,
    })

    if (!camelResult.allowed) {
      throw new Error(camelResult.reason ?? "CaMeL guard blocked file action")
    }

    if (input.action === "read") {
      const stat = await fs.stat(targetPath)
      const maxFileSize = this.options.maxFileSizeBytes ?? MAX_DEFAULT_FILE_SIZE_BYTES
      if (stat.size > maxFileSize) {
        throw new Error(`File exceeds size limit: ${targetPath}`)
      }

      const content = await fs.readFile(targetPath, "utf-8")
      return JSON.stringify({
        path: targetPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content: clipContent(content),
      })
    }

    if (input.action === "info") {
      const stat = await fs.stat(targetPath)
      return JSON.stringify({
        path: targetPath,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        type: stat.isDirectory() ? "directory" : "file",
      })
    }

    if (input.action === "list") {
      const entries = await fs.readdir(targetPath, { withFileTypes: true })
      return JSON.stringify(
        entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          extension: path.extname(entry.name),
        })),
      )
    }

    if (input.action === "write") {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      const backupPath = await createBackupIfExists(targetPath)
      await fs.writeFile(targetPath, input.content ?? "", "utf-8")
      return JSON.stringify({ path: targetPath, backupPath, bytesWritten: Buffer.byteLength(input.content ?? "") })
    }

    if (input.action === "append") {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.appendFile(targetPath, input.content ?? "", "utf-8")
      return JSON.stringify({ path: targetPath, appendedBytes: Buffer.byteLength(input.content ?? "") })
    }

    if (input.action === "delete") {
      // CaMeL: delete/move are irreversible -> require capability token.
      if (!input.capabilityToken) {
        throw new Error("Capability token required for delete")
      }
      await fs.rm(targetPath, { recursive: true, force: false })
      return JSON.stringify({ path: targetPath, deleted: true })
    }

    if (input.action === "move") {
      if (!input.capabilityToken) {
        throw new Error("Capability token required for move")
      }
      if (!input.destination) {
        throw new Error("Destination required for move")
      }

      const destinationPath = await ensurePathAllowed(input.destination, allowedRoots)
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      const backupPath = await createBackupIfExists(targetPath)
      await fs.rename(targetPath, destinationPath)
      return JSON.stringify({ path: targetPath, destinationPath, backupPath, moved: true })
    }

    throw new Error(`Unsupported file action: ${input.action}`)
  }
}

const fileAgent = new FileAgent()

export const fileAgentTool = tool({
  description: `Dedicated file operations for EDITH.
Actions: read, write, append, list, delete, info, move.
Delete and move require a capability token.`,
  inputSchema: z.object({
    action: z.enum(["read", "write", "append", "list", "delete", "info", "move"]),
    path: z.string(),
    content: z.string().optional(),
    destination: z.string().optional(),
    capabilityToken: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      return await fileAgent.execute(input)
    } catch (error) {
      log.warn("file-agent failed", { action: input.action, path: input.path, error: String(error) })
      return `FileAgent failed: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

export const __fileAgentTestUtils = {
  isBlockedSensitivePath,
  ensurePathAllowed,
}