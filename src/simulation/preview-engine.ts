/**
 * @file preview-engine.ts
 * @description Generates human-readable previews of tool actions before execution.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - message-pipeline.ts calls preview() for destructive/write/external tools.
 *   - Uses virtual-fs.ts for file diffs.
 *   - ActionPreview is returned to the user before asking for confirmation.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { createLogger } from "../logger.js"
import { actionClassifier } from "./action-classifier.js"
import type { ActionCategory, ActionImpact, ActionPreview } from "./types.js"

const log = createLogger("simulation.preview-engine")

/** Map of category to default impact level. */
const CATEGORY_IMPACT: Record<ActionCategory, ActionImpact> = {
  read: "low",
  write: "medium",
  destructive: "high",
  external: "critical",
}

/**
 * Generates human-readable action previews for user confirmation.
 */
export class PreviewEngine {
  /**
   * Generate a preview for a tool call.
   *
   * @param toolName - Name of the tool to preview.
   * @param params   - Tool parameters.
   * @returns ActionPreview with description, diff, and impact.
   */
  async preview(toolName: string, params: Record<string, unknown>): Promise<ActionPreview> {
    const category = actionClassifier.classify(toolName, params)
    const impact = CATEGORY_IMPACT[category]
    const actionId = randomUUID()

    const description = await this.buildDescription(toolName, params, category)
    const affectedResources = this.extractResources(params)
    const diff = await this.buildDiff(toolName, params)

    const preview: ActionPreview = {
      actionId,
      type: toolName,
      description,
      impact,
      affectedResources,
      diff,
      reversible: category !== "external",
      estimatedDurationMs: this.estimateDuration(category),
    }

    log.debug("action preview generated", { toolName, category, impact })
    return preview
  }

  /**
   * Determine whether a given action category should trigger a preview.
   *
   * @param category - Classification result.
   * @returns True if preview is warranted.
   */
  shouldPreview(category: ActionCategory): boolean {
    return actionClassifier.shouldPreview(category)
  }

  /**
   * Build a natural-language description of the action.
   */
  private async buildDescription(
    toolName: string,
    params: Record<string, unknown>,
    category: ActionCategory,
  ): Promise<string> {
    const path = (params.path ?? params.filePath ?? params.file ?? "") as string

    switch (category) {
      case "destructive":
        if (toolName.includes("delete") || toolName === "rm") {
          return `Delete file: ${path || "(unknown path)"}`
        }
        if (toolName.includes("email")) {
          const to = params.to ?? params.recipient ?? "(unknown)"
          return `Send email to ${to}`
        }
        if (toolName.includes("git_push")) {
          return `Push commits to remote repository (irreversible on remote)`
        }
        return `Execute destructive operation: ${toolName}`

      case "external":
        const url = (params.url ?? params.endpoint ?? "") as string
        return `Call external API: ${url || toolName}`

      case "write": {
        const content = params.content as string | undefined
        const preview = content ? content.slice(0, 60) + (content.length > 60 ? "..." : "") : ""
        return `Write to file: ${path}${preview ? `\nContent preview: ${preview}` : ""}`
      }

      default:
        return `Execute: ${toolName}`
    }
  }

  /**
   * Extract affected resource paths from params.
   */
  private extractResources(params: Record<string, unknown>): string[] {
    const candidates = [
      params.path,
      params.filePath,
      params.file,
      params.target,
      params.url,
      params.endpoint,
    ]
    return candidates
      .filter((v): v is string => typeof v === "string" && v.length > 0)
  }

  /**
   * Generate a file diff for write operations.
   */
  private async buildDiff(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<string | undefined> {
    const path = params.path as string | undefined
    if (!path || toolName === "delete_file" || toolName === "rm") return undefined

    const newContent = params.content as string | undefined
    if (!newContent) return undefined

    try {
      const existing = await fs.readFile(path, "utf-8").catch(() => "")
      if (!existing) return undefined
      const oldLines = existing.split("\n")
      const newLines = newContent.split("\n")
      const lines: string[] = [`--- ${path}`, `+++ ${path}`]
      const maxLen = Math.max(oldLines.length, newLines.length)
      let changes = 0
      for (let i = 0; i < Math.min(maxLen, 20) && changes < 10; i++) {
        if (oldLines[i] !== newLines[i]) {
          if (oldLines[i] !== undefined) lines.push(`- ${oldLines[i]}`)
          if (newLines[i] !== undefined) lines.push(`+ ${newLines[i]}`)
          changes++
        }
      }
      return lines.length > 2 ? lines.join("\n") : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Estimate execution duration based on category.
   */
  private estimateDuration(category: ActionCategory): number {
    switch (category) {
      case "read":       return 100
      case "write":      return 500
      case "destructive": return 200
      case "external":   return 2000
    }
  }
}

/** Singleton preview engine. */
export const previewEngine = new PreviewEngine()
