/**
 * @file mission-skill.ts
 * @description Skill that parses mission assignment intents and delegates to MissionManager.
 *
 * ARCHITECTURE:
 *   - Parses "mission: X" or "run mission: X" patterns from user messages
 *   - Delegates to MissionManager.startMission()
 *   - Returns a confirmation string for delivery to the user
 *   - Called from message-pipeline.ts or skill dispatcher
 *
 * INTEGRATION:
 *   - Import missionManager from mission-manager.ts
 *   - Register in skill dispatcher or call directly from pipeline
 */

import { createLogger } from "../logger.js"
import { missionManager } from "../mission/mission-manager.js"

const log = createLogger("skills.mission-skill")

/**
 * Patterns for detecting mission intent in user messages.
 * Supports "mission:", "run mission:", "start mission:", "execute mission:" prefixes.
 */
const MISSION_PATTERNS: readonly RegExp[] = [
  /^mission:\s*(.+)/is,
  /^run\s+mission:\s*(.+)/is,
  /^start\s+mission:\s*(.+)/is,
  /^execute\s+mission:\s*(.+)/is,
  /^launch\s+mission:\s*(.+)/is,
]

/** Maximum length for a mission goal extracted from a message. */
const MAX_GOAL_LENGTH = 1000

/** Maximum length for a generated mission title. */
const MAX_TITLE_LENGTH = 80

/**
 * Extracts a mission goal from a user message if the message matches a mission intent pattern.
 *
 * @param message - Raw user message
 * @returns Extracted goal string or null if no match
 */
function extractMissionGoal(message: string): string | null {
  for (const pattern of MISSION_PATTERNS) {
    const match = message.match(pattern)
    if (match?.[1]) {
      return match[1].trim().slice(0, MAX_GOAL_LENGTH)
    }
  }
  return null
}

/**
 * Generates a short mission title from the goal text.
 * Takes the first sentence or first 80 characters, whichever is shorter.
 *
 * @param goal - Mission goal text
 * @returns Short title string
 */
function generateTitle(goal: string): string {
  const firstSentence = goal.split(/[.!?]\s/)[0] ?? goal
  return firstSentence.slice(0, MAX_TITLE_LENGTH).trim()
}

/**
 * MissionSkill — handles mission assignment intent and delegates to MissionManager.
 *
 * Exposes a single process() method that checks if a message is a mission request
 * and starts the mission if so.
 */
export class MissionSkill {
  /**
   * Processes a user message and starts a mission if a mission intent is detected.
   *
   * @param userId - User requesting the mission
   * @param message - Raw user message text
   * @returns Confirmation message string, or null if no mission intent was detected
   */
  async process(userId: string, message: string): Promise<string | null> {
    const goal = extractMissionGoal(message)
    if (!goal) {
      return null
    }

    const title = generateTitle(goal)

    log.info("mission intent detected", { userId, title, goalLength: goal.length })

    try {
      const result = await missionManager.startMission(userId, goal, title)

      return [
        `Mission started: "${result.missionId}"`,
        result.message,
        "I'll work on this in the background and report when done.",
        `Use "mission status ${result.missionId}" to check progress.`,
      ].join("\n")
    } catch (err) {
      log.error("mission start failed", { userId, err })
      return `Sorry, I couldn't start the mission: ${String(err)}`
    }
  }

  /**
   * Checks whether a message contains a mission intent without starting anything.
   *
   * @param message - Raw user message text
   * @returns True if the message is a mission assignment
   */
  isMissionIntent(message: string): boolean {
    return extractMissionGoal(message) !== null
  }
}

/** Singleton MissionSkill instance. */
export const missionSkill = new MissionSkill()
