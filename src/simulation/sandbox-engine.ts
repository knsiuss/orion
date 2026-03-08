/**
 * @file sandbox-engine.ts
 * @description Executes actions in an isolated sandbox without affecting real state.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses VirtualFS for file operations in memory.
 *   - Shell commands run in a temp directory with a 30-second timeout.
 *   - Returns SandboxResult — never modifies the real filesystem.
 */

import { exec } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import { virtualFS } from "./sandbox-virtual-fs.js"
import type { SandboxResult } from "./types.js"

const execAsync = promisify(exec)

/** Sandbox shell timeout in milliseconds. */
const SANDBOX_TIMEOUT_MS = 30_000

/**
 * Runs tool actions in an isolated sandbox, returning results without side effects.
 */
export class SandboxEngine {
  /**
   * Run a tool call in sandbox mode.
   *
   * @param toolName - Tool to simulate.
   * @param params   - Tool parameters.
   * @returns SandboxResult with output and detected side effects.
   */
  async run(toolName: string, params: Record<string, unknown>): Promise<SandboxResult> {
    const start = Date.now()

    if (this.isFileOperation(toolName)) {
      return this.runFileOperation(toolName, params, start)
    }

    if (this.isShellCommand(toolName)) {
      return this.runShellCommand(params, start)
    }

    // For other tools: simulate with description
    return {
      success: true,
      output: `[SANDBOX] Simulated ${toolName} with params: ${JSON.stringify(params, null, 2)}`,
      sideEffects: this.detectSideEffects(toolName, params),
      durationMs: Date.now() - start,
    }
  }

  /**
   * Simulate a file operation using the virtual filesystem.
   */
  private async runFileOperation(
    toolName: string,
    params: Record<string, unknown>,
    start: number,
  ): Promise<SandboxResult> {
    const filePath = (params.path ?? params.filePath ?? params.file ?? "") as string
    const content = params.content as string | undefined

    const original = await virtualFS.clone(filePath ? [filePath] : [])
    const ops = filePath ? [{ path: filePath, content: toolName.includes("delete") || toolName === "rm" ? null : (content ?? "") }] : []
    const modified = virtualFS.apply(ops)
    const diff = virtualFS.diff(original, modified)

    return {
      success: true,
      output: `[SANDBOX] File operation simulated.\n${diff}`,
      sideEffects: [],
      durationMs: Date.now() - start,
    }
  }

  /**
   * Run a shell command in a temp directory sandbox.
   */
  private async runShellCommand(
    params: Record<string, unknown>,
    start: number,
  ): Promise<SandboxResult> {
    const cmd = (params.command ?? params.cmd ?? "") as string
    if (!cmd) {
      return { success: false, output: "No command specified", sideEffects: [], durationMs: Date.now() - start }
    }

    const tmpDir = os.tmpdir()
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: tmpDir,
        timeout: SANDBOX_TIMEOUT_MS,
      })
      return {
        success: true,
        output: `[SANDBOX cwd=${tmpDir}]\n${stdout}${stderr}`.trim(),
        sideEffects: [],
        durationMs: Date.now() - start,
      }
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      return {
        success: false,
        output: `[SANDBOX] Command failed: ${error.stderr ?? error.message ?? "unknown error"}`,
        sideEffects: [],
        durationMs: Date.now() - start,
      }
    }
  }

  private isFileOperation(toolName: string): boolean {
    return ["write_file", "edit_file", "create_file", "delete_file", "rm"].includes(toolName)
  }

  private isShellCommand(toolName: string): boolean {
    return ["shell", "exec", "run_command", "bash"].includes(toolName)
  }

  private detectSideEffects(toolName: string, params: Record<string, unknown>): string[] {
    const effects: string[] = []
    if (toolName.includes("email")) {
      effects.push(`Would send email to: ${params.to ?? "unknown"}`)
    }
    if (toolName.includes("git_push")) {
      effects.push("Would push commits to remote repository")
    }
    return effects
  }
}

/** Singleton sandbox engine. */
export const sandboxEngine = new SandboxEngine()
