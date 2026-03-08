/**
 * @file access-control.ts
 * @description Fine-grained resource access control for Legion multi-instance operations.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - team-mode.ts uses this for lower-level resource ACLs.
 *   - check() is called before any shared resource operation.
 *   - grant/revoke are admin-only operations in practice.
 */

import { createLogger } from "../../logger.js"

const log = createLogger("legion.access-control")

/** Possible actions on a resource. */
type Action = "read" | "write" | "admin"

/** A permission grant entry. */
interface PermissionEntry {
  /** User who holds this permission. */
  userId: string
  /** Resource being accessed. */
  resource: string
  /** Allowed actions (most permissive wins). */
  actions: Set<Action>
}

/**
 * Resource-level access control list for Legion shared operations.
 */
export class AccessControl {
  /** Permission entries keyed by `${userId}:${resource}`. */
  private readonly acl = new Map<string, PermissionEntry>()

  /**
   * Check if a user has permission for an action on a resource.
   *
   * @param userId   - User requesting access.
   * @param resource - Resource identifier.
   * @param action   - Action being requested.
   * @returns True if the user has permission.
   */
  check(userId: string, resource: string, action: Action): boolean {
    const key = `${userId}:${resource}`
    const entry = this.acl.get(key)
    if (!entry) return false

    // Admin grants everything
    if (entry.actions.has("admin")) return true
    // Write implies read
    if (action === "read" && entry.actions.has("write")) return true

    return entry.actions.has(action)
  }

  /**
   * Grant a user permission to perform an action on a resource.
   *
   * @param userId   - User to grant permission to.
   * @param resource - Resource identifier.
   * @param action   - Action to grant.
   */
  grant(userId: string, resource: string, action: Action): void {
    const key = `${userId}:${resource}`
    const existing = this.acl.get(key)
    if (existing) {
      existing.actions.add(action)
    } else {
      this.acl.set(key, { userId, resource, actions: new Set([action]) })
    }
    log.info("access granted", { userId, resource, action })
  }

  /**
   * Revoke all permissions for a user on a resource.
   *
   * @param userId   - User whose permissions to revoke.
   * @param resource - Resource to revoke access to.
   */
  revoke(userId: string, resource: string): void {
    const key = `${userId}:${resource}`
    this.acl.delete(key)
    log.info("access revoked", { userId, resource })
  }

  /**
   * List all permissions for a user.
   *
   * @param userId - User to query.
   * @returns Array of {resource, actions} the user has.
   */
  listUserPermissions(userId: string): Array<{ resource: string; actions: Action[] }> {
    const results: Array<{ resource: string; actions: Action[] }> = []
    for (const [_key, entry] of this.acl) {
      if (entry.userId === userId) {
        results.push({ resource: entry.resource, actions: [...entry.actions] })
      }
    }
    return results
  }
}

/** Singleton access control manager. */
export const accessControl = new AccessControl()
