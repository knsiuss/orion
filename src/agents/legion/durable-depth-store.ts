/**
 * @file durable-depth-store.ts
 * @description Prisma-backed persistence layer for delegation chain state.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Bridges DepthGuard's in-memory chains to the DelegationDepth Prisma model.
 *   Enables cross-process depth resolution — if Instance A spawned a chain,
 *   Instance B can query the DB to resolve the inherited depth.
 *
 *   Write-through pattern:
 *     DepthGuard.startChain() → in-memory + DurableDepthStore.save()
 *     DepthGuard.recordDelegation() → in-memory + DurableDepthStore.update()
 *     DepthGuard.endChain() → in-memory + DurableDepthStore.complete()
 *
 *   Read pattern (cross-process):
 *     DepthGuard.resolveInheritedDepth() misses in-memory →
 *       DurableDepthStore.resolveDepthFromStore() walks spawnedBy chain in DB
 *
 *   Cleanup:
 *     DurableDepthStore.cleanup() purges expired/completed entries older than maxAge
 *     Called by daemon.ts on a periodic schedule.
 *
 * PAPER BASIS:
 *   - OpenClaw's file-based session store pattern, adapted for Prisma/SQLite
 */

import { createLogger } from "../../logger.js"
import { prisma } from "../../database/index.js"
import { normalizeKey, normalizeDepth, buildKeyCandidates, inferDepthFromSegments } from "./key-normalizer.js"

const log = createLogger("legion.durable-depth-store")

/** Default max age for completed/expired chains: 1 hour. */
const DEFAULT_CLEANUP_MAX_AGE_MS = 60 * 60 * 1_000

/** Maximum walk depth for spawnedBy chain resolution (prevents unbounded DB queries). */
const MAX_RESOLVE_WALK = 10

/** Shape of a chain record as stored in the DB. */
export interface ChainRecord {
  taskId: string
  instanceId: string
  depth: number
  spawnedBy: string | undefined
  visited: string[]
  rootTaskId: string
  status: "active" | "completed" | "expired"
}

/**
 * Prisma-backed persistence for delegation chain state.
 * Enables depth resolution across process boundaries and restart survival.
 */
export class DurableDepthStore {
  /**
   * Persist a new chain to the database (upsert).
   *
   * @param record - Chain state to persist
   */
  async save(record: ChainRecord): Promise<void> {
    try {
      await prisma.delegationDepth.upsert({
        where: { taskId: record.taskId },
        create: {
          taskId: record.taskId,
          instanceId: record.instanceId,
          depth: record.depth,
          spawnedBy: record.spawnedBy ?? null,
          visited: record.visited,
          rootTaskId: record.rootTaskId,
          status: record.status,
        },
        update: {
          depth: record.depth,
          visited: record.visited,
          status: record.status,
        },
      })
      log.debug("chain persisted", { taskId: record.taskId, depth: record.depth })
    } catch (err) {
      log.warn("failed to persist chain", { taskId: record.taskId, err })
    }
  }

  /**
   * Update depth and visited set for an existing chain (after recordDelegation).
   *
   * @param taskId  - Task to update
   * @param depth   - New depth value
   * @param visited - Updated visited instance set
   */
  async updateDepth(taskId: string, depth: number, visited: string[]): Promise<void> {
    try {
      await prisma.delegationDepth.update({
        where: { taskId },
        data: { depth, visited },
      })
      log.debug("chain depth updated", { taskId, depth })
    } catch (err) {
      log.warn("failed to update chain depth", { taskId, err })
    }
  }

  /**
   * Mark a chain as completed — retains record for cross-process resolution.
   *
   * @param taskId - Task that completed
   */
  async complete(taskId: string): Promise<void> {
    try {
      await prisma.delegationDepth.update({
        where: { taskId },
        data: { status: "completed" },
      })
      log.debug("chain marked completed", { taskId })
    } catch (err) {
      // Not a big deal if the record doesn't exist (already cleaned up)
      log.debug("failed to mark chain completed", { taskId, err })
    }
  }

  /**
   * Mark a chain as expired (timeout auto-cleanup).
   *
   * @param taskId - Task that expired
   */
  async expire(taskId: string): Promise<void> {
    try {
      await prisma.delegationDepth.update({
        where: { taskId },
        data: { status: "expired" },
      })
    } catch {
      // Silent — record may already be gone
    }
  }

  /**
   * Load a single chain record by task ID.
   * Tries exact match first, then key candidates.
   *
   * @param taskId     - Task to look up
   * @param instanceId - Optional instance for scoped candidate building
   * @returns Chain record or null
   */
  async load(taskId: string, instanceId?: string): Promise<ChainRecord | null> {
    try {
      // Exact match first
      const exact = await prisma.delegationDepth.findUnique({ where: { taskId } })
      if (exact) return this.toRecord(exact)

      // Try key candidates (multi-format resolution)
      const candidates = buildKeyCandidates(taskId, instanceId)
      for (const candidate of candidates) {
        if (candidate === taskId) continue // Already tried
        const entry = await prisma.delegationDepth.findUnique({ where: { taskId: candidate } })
        if (entry) {
          log.debug("chain found via candidate key", { taskId, resolvedKey: candidate })
          return this.toRecord(entry)
        }
      }

      return null
    } catch (err) {
      log.warn("failed to load chain", { taskId, err })
      return null
    }
  }

  /**
   * Resolve depth for a task by walking the spawnedBy chain in the database.
   * This is the cross-process depth resolution — the key feature OpenClaw has.
   *
   * Walk algorithm:
   *   1. Load record for taskId
   *   2. If spawnDepth is stored, return it
   *   3. If spawnedBy exists, recursively resolve parent depth + 1
   *   4. Fallback: infer depth from key segments (OpenClaw's getSubagentDepth)
   *
   * @param taskId - Task to resolve depth for
   * @returns Resolved depth (0 if nothing found)
   */
  async resolveDepthFromStore(taskId: string): Promise<number> {
    const visited = new Set<string>()

    const walk = async (key: string): Promise<number | undefined> => {
      const normalized = normalizeKey(key)
      if (!normalized || visited.has(normalized)) return undefined
      visited.add(normalized)

      if (visited.size > MAX_RESOLVE_WALK) {
        log.warn("depth resolution walk exceeded max steps", { taskId, steps: visited.size })
        return undefined
      }

      const record = await this.load(normalized)
      if (!record) return undefined

      // Direct depth stored — use it
      const storedDepth = normalizeDepth(record.depth)
      if (storedDepth !== undefined) return storedDepth

      // Walk spawnedBy chain
      if (record.spawnedBy) {
        const parentDepth = await walk(record.spawnedBy)
        if (parentDepth !== undefined) return parentDepth + 1
      }

      return undefined
    }

    const resolved = await walk(taskId)
    if (resolved !== undefined) return resolved

    // Fallback: segment-based inference
    return inferDepthFromSegments(taskId)
  }

  /**
   * Restore all active chains from DB (for startup recovery).
   *
   * @returns Array of active chain records
   */
  async restoreActiveChains(): Promise<ChainRecord[]> {
    try {
      const rows = await prisma.delegationDepth.findMany({
        where: { status: "active" },
      })
      log.info("restored active chains from DB", { count: rows.length })
      return rows.map((r) => this.toRecord(r))
    } catch (err) {
      log.warn("failed to restore active chains", { err })
      return []
    }
  }

  /**
   * Purge completed and expired entries older than maxAge.
   * Called periodically by the daemon to keep the DB clean.
   *
   * @param maxAgeMs - Max age in ms for completed/expired records (default: 1 hour)
   * @returns Number of records deleted
   */
  async cleanup(maxAgeMs = DEFAULT_CLEANUP_MAX_AGE_MS): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - maxAgeMs)
      const result = await prisma.delegationDepth.deleteMany({
        where: {
          status: { in: ["completed", "expired"] },
          updatedAt: { lt: cutoff },
        },
      })
      if (result.count > 0) {
        log.info("cleaned up delegation depth records", { deleted: result.count })
      }
      return result.count
    } catch (err) {
      log.warn("delegation depth cleanup failed", { err })
      return 0
    }
  }

  /**
   * Expire stale active chains that have been running longer than maxAge.
   * Safety net for chains where endChain was never called and the timeout didn't fire.
   *
   * @param maxAgeMs - Max age for active chains (default: 1 hour)
   * @returns Number of records expired
   */
  async expireStaleChains(maxAgeMs = DEFAULT_CLEANUP_MAX_AGE_MS): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - maxAgeMs)
      const result = await prisma.delegationDepth.updateMany({
        where: {
          status: "active",
          updatedAt: { lt: cutoff },
        },
        data: { status: "expired" },
      })
      if (result.count > 0) {
        log.info("expired stale active chains", { expired: result.count })
      }
      return result.count
    } catch (err) {
      log.warn("stale chain expiration failed", { err })
      return 0
    }
  }

  /** Convert a Prisma row to a ChainRecord. */
  private toRecord(row: {
    taskId: string
    instanceId: string
    depth: number
    spawnedBy: string | null
    visited: unknown
    rootTaskId: string
    status: string
  }): ChainRecord {
    return {
      taskId: row.taskId,
      instanceId: row.instanceId,
      depth: row.depth,
      spawnedBy: row.spawnedBy ?? undefined,
      visited: Array.isArray(row.visited) ? (row.visited as string[]) : [],
      rootTaskId: row.rootTaskId,
      status: row.status as ChainRecord["status"],
    }
  }
}

/** Singleton durable depth store. */
export const durableDepthStore = new DurableDepthStore()
