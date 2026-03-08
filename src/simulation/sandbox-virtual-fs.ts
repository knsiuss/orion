/**
 * @file sandbox-virtual-fs.ts
 * @description In-memory virtual filesystem for safe simulation of file operations.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - sandbox-engine.ts uses clone() + apply() to simulate file changes.
 *   - preview-engine.ts uses diff() to generate human-readable change descriptions.
 *   - Never touches the real filesystem — purely in-memory.
 */

import fs from "node:fs/promises"
import { createLogger } from "../logger.js"

const log = createLogger("simulation.virtual-fs")

/** A pending filesystem operation. */
export interface FSOperation {
  /** Absolute path to the file. */
  path: string
  /** New content (null means delete). */
  content: string | null
}

/**
 * Virtual in-memory filesystem for sandboxed file operations.
 */
export class VirtualFS {
  /**
   * Clone a set of real files into an in-memory map.
   * Files that don't exist are silently skipped.
   *
   * @param paths - Absolute file paths to clone.
   * @returns Map of path → file content.
   */
  async clone(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    await Promise.all(
      paths.map(async (p) => {
        try {
          const content = await fs.readFile(p, "utf-8")
          result.set(p, content)
        } catch {
          // File doesn't exist — skip silently
        }
      }),
    )
    log.debug("virtual FS cloned", { paths: paths.length, loaded: result.size })
    return result
  }

  /**
   * Apply a list of operations to a cloned virtual FS snapshot.
   * Does NOT touch the real filesystem.
   *
   * @param ops - Operations to apply (null content = delete).
   * @returns New map with operations applied.
   */
  apply(ops: FSOperation[]): Map<string, string> {
    const result = new Map<string, string>()
    for (const [path, content] of result) {
      result.set(path, content)
    }
    for (const op of ops) {
      if (op.content === null) {
        result.delete(op.path)
      } else {
        result.set(op.path, op.content)
      }
    }
    return result
  }

  /**
   * Generate a unified-diff-style comparison between two virtual FS snapshots.
   *
   * @param original - Original file map (before).
   * @param modified - Modified file map (after).
   * @returns Human-readable diff string.
   */
  diff(original: Map<string, string>, modified: Map<string, string>): string {
    const lines: string[] = []
    const allPaths = new Set([...original.keys(), ...modified.keys()])

    for (const path of allPaths) {
      const before = original.get(path)
      const after = modified.get(path)

      if (before === undefined && after !== undefined) {
        lines.push(`+++ ${path} (NEW FILE)`)
        for (const line of after.split("\n").slice(0, 20)) {
          lines.push(`+ ${line}`)
        }
      } else if (before !== undefined && after === undefined) {
        lines.push(`--- ${path} (DELETED)`)
      } else if (before !== after) {
        lines.push(`--- ${path}`)
        lines.push(`+++ ${path}`)
        const beforeLines = (before ?? "").split("\n")
        const afterLines = (after ?? "").split("\n")
        const maxLen = Math.max(beforeLines.length, afterLines.length)
        for (let i = 0; i < Math.min(maxLen, 30); i++) {
          const b = beforeLines[i]
          const a = afterLines[i]
          if (b !== a) {
            if (b !== undefined) lines.push(`- ${b}`)
            if (a !== undefined) lines.push(`+ ${a}`)
          }
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : "(no changes)"
  }
}

/** Singleton virtual filesystem. */
export const virtualFS = new VirtualFS()
