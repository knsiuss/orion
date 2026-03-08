/**
 * @file memory-sync.ts
 * @description Tiered memory synchronization across gateway instances (Phase 27).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - gateway-sync.ts calls generateBatch() / applyBatch() for peer sync.
 *   - Hot tier: real-time, small deltas pushed immediately.
 *   - Warm/cold tier: periodic batch sync for larger memory sets.
 */

import { createLogger } from "../logger.js"

const log = createLogger("memory.sync")

/** Memory tier based on age. */
export type MemoryTier = "hot" | "warm" | "cold"

/** Thresholds for tier classification (milliseconds). */
const HOT_THRESHOLD_MS = 60 * 60 * 1000       // < 1 hour = hot
const WARM_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // < 7 days = warm

/** A pending sync entry (hot tier). */
interface HotEntry {
  /** User ID. */
  userId: string
  /** Memory data to sync. */
  entry: unknown
  /** Timestamp added to hot tier. */
  addedAt: number
}

/**
 * Manages tiered memory synchronization across gateway instances.
 */
export class MemorySync {
  /** Hot tier: real-time memory entries pending push. */
  private readonly hot: HotEntry[] = []
  /** Users scheduled for next batch sync. */
  private readonly pendingBatch = new Set<string>()
  /** Warm memory store: userId → entries[]. */
  private readonly warmStore = new Map<string, unknown[]>()

  /**
   * Push a memory entry to the hot sync tier (real-time).
   *
   * @param userId - User who owns this memory.
   * @param entry  - Memory entry to sync.
   */
  pushHot(userId: string, entry: unknown): void {
    this.hot.push({ userId, entry, addedAt: Date.now() })
    log.debug("memory pushed to hot tier", { userId })
  }

  /**
   * Schedule a user's memories for the next batch sync.
   *
   * @param userId - User to include in the next batch.
   */
  scheduleBatch(userId: string): void {
    this.pendingBatch.add(userId)
    log.debug("user scheduled for batch sync", { userId })
  }

  /**
   * Generate a serializable batch payload for a user's warm memories.
   *
   * @param userId - User to export.
   * @returns Serializable batch payload.
   */
  generateBatch(userId: string): unknown {
    const warm = this.warmStore.get(userId) ?? []
    return { userId, entries: warm, generatedAt: Date.now() }
  }

  /**
   * Apply a received batch payload from a peer gateway.
   *
   * @param userId - User who owns these memories.
   * @param batch  - Batch payload from generateBatch().
   */
  async applyBatch(userId: string, batch: unknown): Promise<void> {
    const typedBatch = batch as { entries?: unknown[] }
    if (!typedBatch?.entries || !Array.isArray(typedBatch.entries)) {
      log.warn("invalid batch payload", { userId })
      return
    }

    const existing = this.warmStore.get(userId) ?? []
    const merged = [...existing, ...typedBatch.entries]
    this.warmStore.set(userId, merged)
    log.info("memory batch applied", { userId, added: typedBatch.entries.length })
  }

  /**
   * Classify a memory by its age into a sync tier.
   *
   * @param age - Age of the memory in milliseconds.
   * @returns Appropriate sync tier.
   */
  getPolicy(age: number): MemoryTier {
    if (age < HOT_THRESHOLD_MS) return "hot"
    if (age < WARM_THRESHOLD_MS) return "warm"
    return "cold"
  }

  /**
   * Drain the hot tier entries for a specific user (for sync push).
   *
   * @param userId - User whose hot entries to drain.
   * @returns Drained entries.
   */
  drainHot(userId: string): unknown[] {
    const drained: unknown[] = []
    let i = this.hot.length - 1
    while (i >= 0) {
      if (this.hot[i]?.userId === userId) {
        drained.push(this.hot[i]!.entry)
        this.hot.splice(i, 1)
      }
      i--
    }
    return drained
  }
}

/** Singleton memory sync manager. */
export const memorySync = new MemorySync()
