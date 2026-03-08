/**
 * @file workbench.ts
 * @description Shared workbench provisioning helpers for EDITH workspaces.
 *
 * The template workspace under `./workspace` remains the canonical seed source.
 * Runtime-selected workbenches such as `./workbenches/testing` or
 * `./workbenches/edith` are provisioned from that template on first use.
 *
 * @module core/workbench
 */

import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_CHECKSUMS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from "./bootstrap.js"

const log = createLogger("core.workbench")

const TEMPLATE_WORKSPACE_DIR = path.resolve(process.cwd(), "workspace")
const REQUIRED_DIRECTORY_NAMES = ["skills", "memory"] as const
const REQUIRED_FILE_NAMES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_CHECKSUMS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
] as const

export interface EnsureWorkbenchReadyOptions {
  templateDir?: string
}

export function resolveWorkspaceFile(workspaceDir: string, filename: string): string {
  return path.join(path.resolve(workspaceDir), filename)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function copyTemplateDirectory(sourceDir: string, targetDir: string): Promise<void> {
  if (!(await pathExists(sourceDir)) || (await pathExists(targetDir))) {
    return
  }

  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    errorOnExist: false,
    force: false,
  })
}

async function copyTemplateFile(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath)) || (await pathExists(targetPath))) {
    return
  }

  await fs.copyFile(sourcePath, targetPath)
}

/**
 * Ensure a selected workbench has the minimum EDITH bootstrap files and
 * workspace subdirectories required by the runtime.
 *
 * @param workspaceDir Absolute or relative workbench directory.
 * @param options Optional template override used by tests.
 * @returns Absolute workbench path once the structure is ready.
 */
export async function ensureWorkbenchReady(
  workspaceDir: string,
  options: EnsureWorkbenchReadyOptions = {},
): Promise<string> {
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  const templateDir = path.resolve(options.templateDir ?? TEMPLATE_WORKSPACE_DIR)

  await fs.mkdir(resolvedWorkspaceDir, { recursive: true })

  for (const dirname of REQUIRED_DIRECTORY_NAMES) {
    const sourceDir = path.join(templateDir, dirname)
    const targetDir = path.join(resolvedWorkspaceDir, dirname)

    await copyTemplateDirectory(sourceDir, targetDir)
    await fs.mkdir(targetDir, { recursive: true })
  }

  for (const filename of REQUIRED_FILE_NAMES) {
    const sourcePath = path.join(templateDir, filename)
    const targetPath = path.join(resolvedWorkspaceDir, filename)
    await copyTemplateFile(sourcePath, targetPath)
  }

  log.debug("workbench ready", { workspaceDir: resolvedWorkspaceDir })
  return resolvedWorkspaceDir
}
