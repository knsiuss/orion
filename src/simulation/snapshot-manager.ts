/**
 * @file snapshot-manager.ts
 * @description Captures point-in-time snapshots of system state before actions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - rollback-engine.ts reads snapshots to restore previous state.
 *   - message-pipeline.ts calls before() before executing destructive tool calls.
 *   - Max 50 snapshots retained; older ones pruned by prune().
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { createLogger } from "../logger.js"
import type { ActionSnapshot } from "./types.js"

const log = createLogger("simulation.snapshot-manager")

/** Maximum number of snapshots to retain in memory. */
const MAX_SNAPSHOTS = 50
/** Maximum snapshot age in milliseconds (7 days). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Captures and manages pre-action system state snapshots for rollback.
 */
export class SnapshotManager {
  /** Ordered snapshot storage (oldest first). */
  private readonly snapshots: ActionSnapshot[] = []

  /**
   * Take a snapshot of the current state of a target resource before an action.
   *
   * @param actionId - Identifier for the action being prepared.
   * @param type     - Action type (tool name).
   * @param target   - Resource path or identifier to snapshot.
   * @returns Snapshot ID for use by rollback-engine.
   */
  async before(actionId: string, type: string, target: string): Promise<string> {
    const snapshotId = randomUUID()
    const preState = await this.captureState(target)

    const snapshot: ActionSnapshot = {
      id: snapshotId,
      actionId,
      timestamp: Date.now(),
      type,
      target,
      preState,
      childSnapshots: [],
      reversible: true,
    }

    this.snapshots.push(snapshot)
    this.prune()

    log.debug("snapshot created", { snapshotId, actionId, target })
    return snapshotId
  }

  /**
   * Retrieve a snapshot by ID.
   *
   * @param snapshotId - Snapshot to retrieve.
   * @returns The snapshot or undefined if not found.
   */
  getSnapshot(snapshotId: string): ActionSnapshot | undefined {
    return this.snapshots.find((s) => s.id === snapshotId)
  }

  /**
   * List the most recent snapshots.
   *
   * @param n - Maximum number of snapshots to return (default all).
   * @returns Snapshots, newest first.
   */
  listRecent(n?: number): ActionSnapshot[] {
    const sorted = [...this.snapshots].reverse()
    return n !== undefined ? sorted.slice(0, n) : sorted
  }

  /**
   * Prune snapshots to enforce the max count and age limits.
   */
  prune(): void {
    const cutoff = Date.now() - MAX_AGE_MS
    // Remove expired
    while (this.snapshots.length > 0 && this.snapshots[0]!.timestamp < cutoff) {
      this.snapshots.shift()
    }
    // Enforce max count
    while (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.shift()
    }
  }

  /**
   * Capture the current state of a resource (file content or description).
   *
   * @param target - Resource path or identifier.
   * @returns Serialized state string.
   */
  private async captureState(target: string): Promise<string> {
    if (!target) return ""
    try {
      // Attempt to read as file
      return await fs.readFile(target, "utf-8")
    } catch {
      // Not a file — return empty (e.g., for URLs, DB records)
      return `[non-file target: ${target}]`
    }
  }
}

/** Singleton snapshot manager. */
export const snapshotManager = new SnapshotManager()
