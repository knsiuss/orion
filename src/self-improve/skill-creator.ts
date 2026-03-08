/**
 * @file skill-creator.ts
 * @description Auto-generates skill definitions from detected patterns using LLM.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses orchestrator.generate('code', ...) to draft SKILL.md-style definitions.
 *   - Writes output to workspace/skills/auto-{id}/SKILL.md.
 *   - patternDetector.markApproved() should be called after save().
 */

import fs from "node:fs/promises"
import path from "node:path"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { SkillPattern } from "./types.js"

const log = createLogger("self-improve.skill-creator")

/** Workspace skills directory path. */
const SKILLS_DIR = path.resolve("workspace", "skills")

/**
 * Generates, saves, and proposes new skills from observed patterns.
 */
export class SkillCreator {
  /**
   * Generate a SKILL.md-style description for a detected pattern.
   *
   * @param pattern - SkillPattern to draft from.
   * @returns Markdown skill definition string.
   */
  async draft(pattern: SkillPattern): Promise<string> {
    const examples = pattern.examples.map((e, i) => `  ${i + 1}. "${e}"`).join("\n")
    const prompt = [
      `Create a skill definition in Markdown for an AI assistant.`,
      `Pattern: "${pattern.description}" (observed ${pattern.occurrenceCount} times in 14 days).`,
      `\nExample user messages:\n${examples}`,
      "\nFormat: # Skill Name\n## Description\n## Trigger\n## Steps\n## Output",
      "Output ONLY the skill Markdown. No explanation.",
    ].join("\n")

    const content = await orchestrator.generate("code", { prompt })
    log.info("skill draft generated", { patternId: pattern.id, description: pattern.description })
    return content.trim()
  }

  /**
   * Save a drafted skill to disk in the workspace/skills directory.
   *
   * @param pattern - Source pattern.
   * @param content - Markdown skill content to write.
   * @returns Absolute path to the created SKILL.md file.
   */
  async save(pattern: SkillPattern, content: string): Promise<string> {
    const dir = path.join(SKILLS_DIR, `auto-${pattern.id.slice(0, 8)}`)
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, "SKILL.md")
    await fs.writeFile(filePath, content, "utf-8")
    log.info("skill saved", { patternId: pattern.id, path: filePath })
    return filePath
  }

  /**
   * Generate a user-facing message proposing a new skill.
   *
   * @param pattern - Pattern to propose as a skill.
   * @returns Formatted message string to send to the user.
   */
  suggestToUser(pattern: SkillPattern): string {
    return (
      `I've noticed you frequently ask about "${pattern.description}" ` +
      `(${pattern.occurrenceCount} times recently). ` +
      `Would you like me to create a dedicated skill for this to give you faster, ` +
      `more accurate responses? Reply "yes, create skill" to approve.`
    )
  }
}

/** Singleton skill creator. */
export const skillCreator = new SkillCreator()
