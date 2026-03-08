/**
 * @file task-router.ts
 * @description Classifies messages to determine the best Legion instance role for delegation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - legion-orchestrator.ts calls classify() to select the target instance.
 *   - Classification is keyword-based — fast, no LLM call needed.
 *   - shouldDelegate() guards against unnecessary delegation overhead.
 */

import { createLogger } from "../../logger.js"
import type { InstanceRole } from "./types.js"

const log = createLogger("legion.task-router")

/** Keywords that indicate a research-type task. */
const RESEARCH_KEYWORDS = new Set([
  "research",
  "find",
  "compare",
  "summarize",
  "search",
  "investigate",
  "analyze",
  "what is",
  "who is",
  "explain",
])

/** Keywords that indicate a code-type task. */
const CODE_KEYWORDS = new Set([
  "code",
  "bug",
  "implement",
  "fix",
  "debug",
  "test",
  "git",
  "refactor",
  "function",
  "class",
  "script",
  "compile",
  "lint",
])

/** Keywords that indicate a communication-type task. */
const COMMUNICATION_KEYWORDS = new Set([
  "email",
  "send",
  "calendar",
  "meeting",
  "schedule",
  "invite",
  "draft",
  "reply",
  "message",
  "notify",
])

/** Minimum word count to consider a message complex enough for delegation. */
const DELEGATION_WORD_THRESHOLD = 20

/**
 * Classifies incoming messages to determine the optimal Legion instance role.
 */
export class TaskRouter {
  /**
   * Classify a message to the most appropriate instance role.
   *
   * @param message - Raw user message.
   * @returns InstanceRole best suited to handle this task.
   */
  classify(message: string): InstanceRole {
    const lower = message.toLowerCase()
    const words = new Set(lower.split(/\W+/).filter((w) => w.length > 2))

    let researchScore = 0
    let codeScore = 0
    let commScore = 0

    for (const word of words) {
      if (RESEARCH_KEYWORDS.has(word)) researchScore++
      if (CODE_KEYWORDS.has(word)) codeScore++
      if (COMMUNICATION_KEYWORDS.has(word)) commScore++
    }

    const max = Math.max(researchScore, codeScore, commScore)
    if (max === 0) {
      log.debug("task classified: general (no keyword match)")
      return "general"
    }

    if (codeScore === max) {
      log.debug("task classified: code", { score: codeScore })
      return "code"
    }
    if (commScore === max) {
      log.debug("task classified: communication", { score: commScore })
      return "communication"
    }

    log.debug("task classified: research", { score: researchScore })
    return "research"
  }

  /**
   * Determine whether a message is complex enough to warrant delegation.
   * Simple/short tasks are handled locally to avoid delegation overhead.
   *
   * @param message - Raw user message.
   * @returns True if delegation is recommended.
   */
  shouldDelegate(message: string): boolean {
    const wordCount = message.trim().split(/\s+/).length
    const role = this.classify(message)

    // Always delegate domain-specific tasks to specialized instances
    if (role !== "general" && wordCount > 5) return true
    // Delegate very long/complex messages regardless
    if (wordCount > DELEGATION_WORD_THRESHOLD) return true

    return false
  }
}

/** Singleton task router. */
export const taskRouter = new TaskRouter()
