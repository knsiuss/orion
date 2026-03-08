/**
 * @file rollback-engine.ts
 * @description Restores system state from snapshots captured before actions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Reads snapshots from snapshot-manager.ts.
 *   - Restores file content for file-based snapshots.
 *   - Warns (but cannot undo) external snapshots (email sent, git pushed).
 */

import fs from "node:fs/promises"
import path from "node:path"
import { createLogger } from "../logger.js"
import { snapshotManager } from "./snapshot-manager.js"
import type { RollbackResult } from "./types.js"

const log = createLogger("simulation.rollback-engine")

/** Action types that cannot be reversed on external systems. */
const IRREVERSIBLE_TYPES = new Set(["send_email", "git_push", "git_force", "publish", "deploy"])

/**
 * Restores system state from snapshots to undo executed actions.
 */
export class RollbackEngine {
  /**
   * Roll back to a specific snapshot (or the most recent if no ID given).
   *
   * @param snapshotId - Optional snapshot ID to restore; defaults to most recent.
   * @returns RollbackResult indicating success and warnings.
   */
  async rollback(snapshotId?: string): Promise<RollbackResult> {
    const snapshot = snapshotId
      ? snapshotManager.getSnapshot(snapshotId)
      : snapshotManager.listRecent(1)[0]

    if (!snapshot) {
      return { success: false, restoredCount: 0, warnings: ["No snapshot found to roll back to."] }
    }

    return this.restoreSnapshot(snapshot)
  }

  /**
   * Roll back the last N actions.
   *
   * @param n - Number of actions to undo (default 1).
   * @returns Combined rollback result.
   */
  async rollbackLast(n = 1): Promise<RollbackResult> {
    const recent = snapshotManager.listRecent(n)
    let restoredCount = 0
    const warnings: string[] = []

    for (const snapshot of recent) {
      const result = await this.restoreSnapshot(snapshot)
      restoredCount += result.restoredCount
      warnings.push(...result.warnings)
    }

    return { success: restoredCount > 0, restoredCount, warnings }
  }

  /**
   * Check whether a snapshot supports rollback.
   *
   * @param snapshotId - Snapshot to check.
   * @returns True if the snapshot is reversible.
   */
  canRollback(snapshotId: string): boolean {
    const snapshot = snapshotManager.getSnapshot(snapshotId)
    return snapshot?.reversible ?? false
  }

  /**
   * Restore a single snapshot.
   */
  private async restoreSnapshot(snapshot: { id: string; type: string; target: string; preState: string; reversible: boolean }): Promise<RollbackResult> {
    const warnings: string[] = []

    if (!snapshot.reversible) {
      return {
        success: false,
        restoredCount: 0,
        warnings: [`Snapshot ${snapshot.id} is marked as irreversible.`],
      }
    }

    if (IRREVERSIBLE_TYPES.has(snapshot.type)) {
      warnings.push(
        `Warning: ${snapshot.type} cannot be undone on external systems (email sent, git pushed).`,
      )
      return { success: false, restoredCount: 0, warnings }
    }

    try {
      // Restore file content
      if (snapshot.preState && !snapshot.preState.startsWith("[non-file")) {
        await fs.mkdir(path.dirname(snapshot.target), { recursive: true })
        await fs.writeFile(snapshot.target, snapshot.preState, "utf-8")
        log.info("file restored from snapshot", { snapshotId: snapshot.id, target: snapshot.target })
        return { success: true, restoredCount: 1, warnings }
      }

      log.debug("no file state to restore", { snapshotId: snapshot.id })
      return { success: true, restoredCount: 0, warnings }
    } catch (err) {
      const msg = `Failed to restore ${snapshot.target}: ${String(err)}`
      log.warn(msg)
      return { success: false, restoredCount: 0, warnings: [...warnings, msg] }
    }
  }
}

/** Singleton rollback engine. */
export const rollbackEngine = new RollbackEngine()
