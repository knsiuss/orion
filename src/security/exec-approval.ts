/**
 * @file exec-approval.ts
 * @description 3-tier execution approval gate for agent shell commands and dangerous tool invocations.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Provides deny/allowlist/full security levels per agent. Consumed by
 *   tool-guard.ts and agents/runner.ts before executing shell commands.
 *   Pattern inspired by OpenClaw's exec-approvals.ts with per-agent allowlists,
 *   configurable ask policy, and approval decision tracking.
 *
 * SECURITY TIERS:
 *   - deny:      Block all exec tool calls (safest)
 *   - allowlist:  Allow only commands matching known-safe patterns
 *   - full:       Allow all (development only, logged)
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.exec-approval")

/** Security tier controlling what commands an agent can execute. */
export type ExecSecurity = "deny" | "allowlist" | "full"

/** Ask policy — whether to prompt user for approval on unrecognized commands. */
export type ExecAskPolicy = "off" | "on-miss" | "always"

/** Decision result from an approval check. */
export type ApprovalDecision = "allow" | "deny" | "needs-approval"

/** A single allowlist entry: a glob/prefix pattern for safe commands. */
export interface AllowlistEntry {
  /** Glob-like pattern matched against the command (lowercase). */
  pattern: string
  /** ISO timestamp of last successful use. */
  lastUsedAt?: number
  /** The full command string that last matched this pattern. */
  lastUsedCommand?: string
}

/** Per-agent exec approval configuration. */
export interface AgentExecPolicy {
  security: ExecSecurity
  ask: ExecAskPolicy
  allowlist: AllowlistEntry[]
}

/** Result from an exec approval check. */
export interface ExecApprovalResult {
  decision: ApprovalDecision
  reason: string
  matchedPattern?: string
  agentId: string
}

/** Default policy for agents without explicit configuration. */
const DEFAULT_POLICY: AgentExecPolicy = {
  security: "allowlist",
  ask: "on-miss",
  allowlist: [
    // Common safe read-only commands
    { pattern: "ls *" },
    { pattern: "dir *" },
    { pattern: "cat *" },
    { pattern: "type *" },
    { pattern: "echo *" },
    { pattern: "pwd" },
    { pattern: "whoami" },
    { pattern: "date" },
    { pattern: "head *" },
    { pattern: "tail *" },
    { pattern: "wc *" },
    { pattern: "find *" },
    { pattern: "grep *" },
    { pattern: "which *" },
    { pattern: "where *" },
    { pattern: "node --version" },
    { pattern: "npm --version" },
    { pattern: "pnpm --version" },
    { pattern: "git status" },
    { pattern: "git log *" },
    { pattern: "git diff *" },
    { pattern: "git branch *" },
  ],
}

/**
 * ExecApprovalGate — manages per-agent execution security policies.
 *
 * Agents default to "allowlist" mode where only pre-approved command
 * patterns are permitted. Unmatched commands trigger "needs-approval"
 * or "deny" depending on the ask policy.
 */
export class ExecApprovalGate {
  /** Per-agent policy overrides. Agents not in this map use DEFAULT_POLICY. */
  private readonly policies = new Map<string, AgentExecPolicy>()

  /** Audit log of recent decisions (ring buffer). */
  private readonly auditLog: Array<{
    agentId: string
    command: string
    decision: ApprovalDecision
    timestamp: number
  }> = []

  private static readonly MAX_AUDIT_LOG = 200

  /**
   * Check whether a command is approved for execution by a given agent.
   * @param agentId - Agent identifier
   * @param command - Shell command string to evaluate
   * @returns Approval result with decision and reason
   */
  check(agentId: string, command: string): ExecApprovalResult {
    const policy = this.policies.get(agentId) ?? DEFAULT_POLICY
    const normalizedCmd = command.trim().toLowerCase()

    // Tier 1: Deny all
    if (policy.security === "deny") {
      this.recordDecision(agentId, command, "deny")
      return {
        decision: "deny",
        reason: "Agent exec security is set to deny",
        agentId,
      }
    }

    // Tier 3: Full access (logged)
    if (policy.security === "full") {
      log.warn("Full exec access used", { agentId, command: command.slice(0, 80) })
      this.recordDecision(agentId, command, "allow")
      return {
        decision: "allow",
        reason: "Agent has full exec access",
        agentId,
      }
    }

    // Tier 2: Allowlist
    const match = this.matchAllowlist(normalizedCmd, policy.allowlist)
    if (match) {
      // Update last-used timestamp
      match.lastUsedAt = Date.now()
      match.lastUsedCommand = command
      this.recordDecision(agentId, command, "allow")
      return {
        decision: "allow",
        reason: "Command matches allowlist pattern",
        matchedPattern: match.pattern,
        agentId,
      }
    }

    // No allowlist match — decision based on ask policy
    if (policy.ask === "off") {
      this.recordDecision(agentId, command, "deny")
      return {
        decision: "deny",
        reason: "Command not in allowlist and ask policy is off",
        agentId,
      }
    }

    // ask=on-miss or ask=always → needs human approval
    this.recordDecision(agentId, command, "needs-approval")
    return {
      decision: "needs-approval",
      reason: "Command not in allowlist; requires user approval",
      agentId,
    }
  }

  /**
   * Set the exec policy for a specific agent.
   */
  setPolicy(agentId: string, policy: Partial<AgentExecPolicy>): void {
    const base = this.policies.get(agentId) ?? { ...DEFAULT_POLICY }
    this.policies.set(agentId, {
      security: policy.security ?? base.security,
      ask: policy.ask ?? base.ask,
      allowlist: policy.allowlist ?? [...base.allowlist],
    })
    log.info("Agent exec policy updated", { agentId, security: policy.security })
  }

  /**
   * Add an allowlist entry for an agent after user approval.
   */
  addAllowlistEntry(agentId: string, pattern: string): void {
    const policy = this.policies.get(agentId) ?? { ...DEFAULT_POLICY, allowlist: [...DEFAULT_POLICY.allowlist] }
    const trimmed = pattern.trim().toLowerCase()
    if (!trimmed) return
    if (policy.allowlist.some((e) => e.pattern === trimmed)) return

    policy.allowlist.push({ pattern: trimmed, lastUsedAt: Date.now() })
    this.policies.set(agentId, policy)
    log.info("Allowlist entry added", { agentId, pattern: trimmed })
  }

  /**
   * Remove an allowlist entry for an agent.
   */
  removeAllowlistEntry(agentId: string, pattern: string): boolean {
    const policy = this.policies.get(agentId)
    if (!policy) return false

    const trimmed = pattern.trim().toLowerCase()
    const idx = policy.allowlist.findIndex((e) => e.pattern === trimmed)
    if (idx === -1) return false

    policy.allowlist.splice(idx, 1)
    return true
  }

  /**
   * Get the effective policy for an agent.
   */
  getPolicy(agentId: string): AgentExecPolicy {
    return this.policies.get(agentId) ?? { ...DEFAULT_POLICY }
  }

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit = 50): ReadonlyArray<{
    agentId: string
    command: string
    decision: ApprovalDecision
    timestamp: number
  }> {
    return this.auditLog.slice(-limit)
  }

  /**
   * Match a command against allowlist patterns using glob-like matching.
   * Supports trailing wildcards: "git status" matches exactly,
   * "git *" matches any command starting with "git ".
   */
  private matchAllowlist(normalizedCmd: string, allowlist: AllowlistEntry[]): AllowlistEntry | null {
    for (const entry of allowlist) {
      const pattern = entry.pattern

      if (pattern.endsWith(" *")) {
        // Prefix match: "git *" matches "git status", "git log --oneline", etc.
        const prefix = pattern.slice(0, -1) // "git "
        if (normalizedCmd.startsWith(prefix) || normalizedCmd === prefix.trimEnd()) {
          return entry
        }
      } else if (normalizedCmd === pattern) {
        // Exact match
        return entry
      }
    }
    return null
  }

  /** Record a decision in the audit ring buffer. */
  private recordDecision(agentId: string, command: string, decision: ApprovalDecision): void {
    this.auditLog.push({
      agentId,
      command: command.slice(0, 200),
      decision,
      timestamp: Date.now(),
    })
    if (this.auditLog.length > ExecApprovalGate.MAX_AUDIT_LOG) {
      this.auditLog.splice(0, this.auditLog.length - ExecApprovalGate.MAX_AUDIT_LOG)
    }
  }
}

export const execApprovalGate = new ExecApprovalGate()
