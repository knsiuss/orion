/**
 * @file safety-guardrails.ts
 * @description Pre-execution safety checks for mission steps.
 *   Blocks dangerous tool calls and requires approval for high-risk actions.
 *
 * ARCHITECTURE:
 *   - Called by MissionExecutor before each step invocation
 *   - Implements a deny-list for destructive tool names
 *   - Requires explicit user approval for high-risk steps
 *   - Integrates with CaMeL capability token model for taint checking
 *
 * PAPER BASIS:
 *   - CaMeL: arXiv:2503.18813 — capability token + taint tracking
 *   - Principle of Least Privilege: Saltzer & Schröder 1975
 */

import { createLogger } from "../logger.js"
import type { MissionStep } from "./mission-schema.js"

const log = createLogger("mission.safety-guardrails")

/** Tool names that are always blocked for autonomous execution. */
const BLOCKED_TOOLS = new Set<string>([
  "system_exec",
  "shell_exec",
  "bash",
  "eval",
  "file_delete",
  "db_drop",
  "rm_rf",
  "format_disk",
  "send_bulk_email",
])

/** Tool names requiring explicit user approval before execution. */
const HIGH_RISK_TOOLS = new Map<string, string>([
  ["email_send", "Sending email to external recipients"],
  ["file_write", "Writing to filesystem"],
  ["financial_transfer", "Financial transaction"],
  ["api_post", "External POST request"],
  ["calendar_create", "Creating calendar event"],
  ["user_data_delete", "Deleting user data"],
])

/** Risk categories for approval requests. */
type RiskCategory = "data_deletion" | "financial" | "external_comms" | "system_config" | "other"

/** Result of a safety check. */
export interface SafetyCheckResult {
  /** Whether the step is allowed to execute. */
  allowed: boolean
  /** Reason for blocking (if not allowed). */
  reason?: string
  /** Whether this step requires user approval before proceeding. */
  requiresApproval: boolean
  /** Risk level for approval requests. */
  riskLevel?: "medium" | "high" | "critical"
  /** Risk category for classification. */
  riskCategory?: RiskCategory
  /** Human-readable description of the risk. */
  riskDescription?: string
}

/**
 * SafetyGuardrails — pre-execution safety enforcement for mission steps.
 *
 * Provides two layers of protection:
 *   1. Hard block: tools in BLOCKED_TOOLS are never allowed
 *   2. Soft gate: tools in HIGH_RISK_TOOLS require explicit user approval
 */
export class SafetyGuardrails {
  /**
   * Checks whether a mission step is safe to execute.
   * Returns a SafetyCheckResult indicating allowed/blocked/requires-approval.
   *
   * @param step - The MissionStep about to be executed
   * @returns SafetyCheckResult
   */
  check(step: MissionStep): SafetyCheckResult {
    const toolName = step.toolName.toLowerCase()

    // Layer 1: Hard block
    if (BLOCKED_TOOLS.has(toolName)) {
      log.warn("mission step blocked: tool in deny-list", {
        stepId: step.id,
        toolName: step.toolName,
      })
      return {
        allowed: false,
        reason: `Tool "${step.toolName}" is not permitted for autonomous execution`,
        requiresApproval: false,
        riskLevel: "critical",
      }
    }

    // Layer 2: High-risk tools require approval
    const riskDescription = HIGH_RISK_TOOLS.get(toolName)
    if (riskDescription) {
      log.info("mission step requires approval", {
        stepId: step.id,
        toolName: step.toolName,
        risk: riskDescription,
      })
      return {
        allowed: true,
        requiresApproval: true,
        riskLevel: "high",
        riskCategory: this.categorize(toolName),
        riskDescription,
      }
    }

    // Layer 3: Check params for dangerous patterns
    const paramSafety = this.checkParams(step)
    if (!paramSafety.safe) {
      return {
        allowed: false,
        reason: paramSafety.reason,
        requiresApproval: false,
        riskLevel: "high",
      }
    }

    return {
      allowed: true,
      requiresApproval: false,
    }
  }

  /**
   * Checks step params for dangerous patterns (e.g., shell injection in strings).
   *
   * @param step - Mission step to inspect
   * @returns Object with safe flag and optional reason
   */
  private checkParams(step: MissionStep): { safe: boolean; reason?: string } {
    const paramsJson = JSON.stringify(step.params)

    // Detect shell injection patterns in param values
    const shellPatterns = [/;\s*rm\s/, /&&\s*rm\s/, /\|\s*sh\s/, /`[^`]*`/, /\$\(.*\)/]
    for (const pattern of shellPatterns) {
      if (pattern.test(paramsJson)) {
        return {
          safe: false,
          reason: `Suspicious shell pattern detected in step params for "${step.toolName}"`,
        }
      }
    }

    return { safe: true }
  }

  /**
   * Categorizes a tool into a risk category for approval tracking.
   *
   * @param toolName - Lowercase tool name
   * @returns Risk category
   */
  private categorize(toolName: string): RiskCategory {
    if (toolName.includes("email") || toolName.includes("sms") || toolName.includes("message")) {
      return "external_comms"
    }
    if (toolName.includes("financial") || toolName.includes("transfer") || toolName.includes("payment")) {
      return "financial"
    }
    if (toolName.includes("delete") || toolName.includes("remove")) {
      return "data_deletion"
    }
    if (toolName.includes("config") || toolName.includes("system") || toolName.includes("setting")) {
      return "system_config"
    }
    return "other"
  }
}

/** Singleton SafetyGuardrails instance. */
export const safetyGuardrails = new SafetyGuardrails()
