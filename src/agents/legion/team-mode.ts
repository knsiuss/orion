/**
 * @file team-mode.ts
 * @description Team collaboration mode with role-based access to shared knowledge.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - shared-knowledge.ts calls canAccess() to enforce team member permissions.
 *   - access-control.ts provides lower-level resource ACLs.
 *   - isEnabled() guards all team features behind configuration.
 */

import { createLogger } from "../../logger.js"
import type { SharedKnowledgeEntry, TeamMember } from "./types.js"

const log = createLogger("legion.team-mode")

/**
 * Manages team member roles and access control for shared knowledge.
 */
export class TeamMode {
  /** Registered team members keyed by user ID. */
  private readonly members = new Map<string, TeamMember>()

  /**
   * Add or update a team member.
   *
   * @param member - TeamMember to register.
   */
  addMember(member: TeamMember): void {
    this.members.set(member.userId, member)
    log.info("team member added", { userId: member.userId, role: member.role })
  }

  /**
   * Remove a team member.
   *
   * @param userId - User ID to remove.
   */
  removeMember(userId: string): void {
    this.members.delete(userId)
    log.info("team member removed", { userId })
  }

  /**
   * Retrieve a team member by user ID.
   *
   * @param userId - User ID to look up.
   * @returns TeamMember or undefined if not registered.
   */
  getMember(userId: string): TeamMember | undefined {
    return this.members.get(userId)
  }

  /**
   * Check if a user can access a shared knowledge entry.
   *
   * Rules:
   * - admin: can access everything
   * - member: can access public entries (empty access list) and entries they're in
   * - guest: can access public entries (read-only)
   *
   * @param userId - User requesting access.
   * @param entry  - Knowledge entry to check access for.
   * @returns True if the user can access the entry.
   */
  canAccess(userId: string, entry: SharedKnowledgeEntry): boolean {
    const member = this.members.get(userId)
    if (!member) return false

    // Admins can access everything
    if (member.role === "admin") return true

    // Public entries (empty access list) are accessible to all members and guests
    if (entry.access.length === 0) return true

    // Specific access list — user must be included
    return entry.access.includes(userId)
  }

  /**
   * Check if team mode is active (at least one non-self member registered).
   *
   * @returns True if team mode is configured with members.
   */
  isEnabled(): boolean {
    return this.members.size > 0
  }

  /**
   * Get all registered team members.
   *
   * @returns Array of all TeamMember entries.
   */
  listMembers(): TeamMember[] {
    return [...this.members.values()]
  }
}

/** Singleton team mode manager. */
export const teamMode = new TeamMode()
