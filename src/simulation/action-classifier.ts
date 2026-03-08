/**
 * @file action-classifier.ts
 * @description Classifies tool calls into risk categories for simulation gating.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - preview-engine.ts calls classify() before generating previews.
 *   - message-pipeline.ts uses shouldPreview() to gate destructive tool calls.
 *   - Classification is purely keyword-based — no LLM needed.
 */

import { createLogger } from "../logger.js"
import type { ActionCategory } from "./types.js"

const log = createLogger("simulation.classifier")

/** Tool names that only read state without modifying anything. */
const READ_TOOLS = new Set([
  "read_file",
  "list_files",
  "search",
  "get_status",
  "query",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
])

/** Tool names that write or modify existing state. */
const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_file",
  "save",
  "update",
  "append_file",
  "mkdir",
  "touch",
])

/** Tool names that destroy data or send irreversible communications. */
const DESTRUCTIVE_TOOLS = new Set([
  "delete_file",
  "rm",
  "drop",
  "git_push",
  "git_force",
  "send_email",
  "send_message",
  "truncate",
  "format",
  "wipe",
])

/** Tool names that contact external services or infrastructure. */
const EXTERNAL_TOOLS = new Set([
  "api_call",
  "webhook",
  "publish",
  "deploy",
  "curl",
  "http_request",
  "post_to",
])

/**
 * Classifies tool names into action categories for simulation gating.
 * More specific categories take priority (destructive > write > read).
 */
export class ActionClassifier {
  /**
   * Classify a tool call into an action category.
   *
   * @param toolName - Name of the tool being called.
   * @param _params  - Optional tool parameters (reserved for future param-based classification).
   * @returns ActionCategory for this tool call.
   */
  classify(toolName: string, _params?: Record<string, unknown>): ActionCategory {
    const name = toolName.toLowerCase()

    if (DESTRUCTIVE_TOOLS.has(name)) {
      log.debug("action classified: destructive", { toolName })
      return "destructive"
    }
    if (EXTERNAL_TOOLS.has(name)) {
      log.debug("action classified: external", { toolName })
      return "external"
    }
    if (WRITE_TOOLS.has(name)) {
      log.debug("action classified: write", { toolName })
      return "write"
    }
    if (READ_TOOLS.has(name)) {
      log.debug("action classified: read", { toolName })
      return "read"
    }

    // Default: treat unknown tools as writes (safer than read)
    log.debug("action classified: write (default)", { toolName })
    return "write"
  }

  /**
   * Determine whether a category should trigger a preview before execution.
   *
   * @param category - Classification result.
   * @returns True if a preview should be shown to the user.
   */
  shouldPreview(category: ActionCategory): boolean {
    return category === "write" || category === "destructive" || category === "external"
  }
}

/** Singleton action classifier. */
export const actionClassifier = new ActionClassifier()
