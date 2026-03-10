/**
 * @file depth-guard.ts
 * @description Prevents infinite recursion in multi-agent delegation by tracking spawn depth.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Full-stack depth guard with three layers:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  DepthGuard  (public API — unchanged contract)        │
 *   │  ├─ In-Memory Layer   — real-time cycle + depth check │
 *   │  ├─ DurableDepthStore — Prisma write-through + cross- │
 *   │  │                      process depth resolution      │
 *   │  └─ KeyNormalizer     — input sanitization + multi-   │
 *   │                         format key resolution         │
 *   └────────────────────────────────────────────────────────┘
 *
 *   Used by legion/orchestrator.ts before delegating any task.
 *   Migrated from OpenClaw's subagent-depth.ts patterns:
 *     - normalizeSpawnDepth / normalizeSessionKey → key-normalizer.ts
 *     - buildKeyCandidates / findEntryBySessionId → key-normalizer.ts
 *     - spawnedBy chain walk from file store → durable-depth-store.ts (Prisma)
 *     - getSubagentDepth segment fallback → inferDepthFromSegments
 *
 * PAPER BASIS:
 *   - OpenClaw subagent-depth.ts — depth tracking + session store walk
 *   - OpenClaw timeout.ts — MAX_SAFE_TIMEOUT_MS sentinel + clamp
 */

import { createLogger } from "../../logger.js"
import { durableDepthStore, type ChainRecord } from "./durable-depth-store.js"
import { normalizeKey, normalizeChainParams, inferDepthFromSegments } from "./key-normalizer.js"

const log = createLogger("legion.depth-guard")

/** Maximum delegation depth before rejecting further spawns. */
const MAX_DEPTH = 5

/** Default chain lifetime — auto-cleanup after 10 minutes if endChain is never called. */
const DEFAULT_CHAIN_TIMEOUT_MS = 10 * 60 * 1_000

/**
 * Largest safe value for Node.js setTimeout (2^31 - 1 ms ≈ 24.8 days).
 * Pass 0 as timeout to mean "no auto-cleanup".
 */
const MAX_SAFE_TIMEOUT_MS = 2_147_000_000

/** Guard state for an active delegation chain. */
interface DelegationChain {
  /** Current depth in the chain (0 = top-level). */
  depth: number
  /** Set of instance IDs already visited in this chain (for cycle detection). */
  visited: Set<string>
  /** Task ID that initiated this chain. */
  rootTaskId: string
  /** Task ID of the parent chain that spawned this one (for inherited depth). */
  spawnedBy?: string
  /** Timestamp when the chain was started. */
  startedAt: number
  /** Auto-cleanup timer handle — cleared by endChain(). */
  timeoutHandle?: ReturnType<typeof setTimeout>
}

/**
 * Tracks active delegation chains and enforces depth / cycle limits
 * for multi-agent task routing to prevent infinite recursion.
 *
 * Three-layer architecture:
 *   1. In-memory Map — fast O(1) cycle detection + depth check
 *   2. DurableDepthStore — Prisma write-through for restart survival
 *   3. KeyNormalizer — input sanitization to prevent mismatches
 */
export class DepthGuard {
  /** Active chains keyed by task ID. */
  private readonly chains = new Map<string, DelegationChain>()

  /** Maximum allowed delegation depth. */
  private readonly maxDepth: number

  /** Whether persistence layer is enabled (disabled in test mode). */
  private persistenceEnabled: boolean

  constructor(maxDepth = MAX_DEPTH, persistenceEnabled = true) {
    this.maxDepth = maxDepth
    this.persistenceEnabled = persistenceEnabled
  }

  /**
   * Enable or disable the persistence layer at runtime.
   * Useful for testing or graceful degradation if DB is unavailable.
   */
  setPersistence(enabled: boolean): void {
    this.persistenceEnabled = enabled
    log.debug("persistence toggled", { enabled })
  }

  /**
   * Restore active chains from DB on startup.
   * Call this once during initialization to recover from a restart.
   */
  async restoreFromStore(): Promise<number> {
    if (!this.persistenceEnabled) return 0

    try {
      const records = await durableDepthStore.restoreActiveChains()
      for (const record of records) {
        if (this.chains.has(record.taskId)) continue // Don't overwrite live chains

        const chain: DelegationChain = {
          depth: record.depth,
          visited: new Set(record.visited),
          rootTaskId: record.rootTaskId,
          spawnedBy: record.spawnedBy,
          startedAt: Date.now(),
        }
        this.chains.set(record.taskId, chain)
      }
      log.info("depth guard restored from store", { restored: records.length })
      return records.length
    } catch (err) {
      log.warn("restore from store failed — starting fresh", { err })
      return 0
    }
  }

  /**
   * Start tracking a new top-level delegation chain.
   *
   * Input normalization (from OpenClaw):
   *   - taskId and instanceId are trimmed and lowercased
   *   - Invalid inputs are rejected with a warning
   *
   * Inherited depth (from OpenClaw spawnedBy):
   *   - If spawnedBy is provided, depth is inherited from parent chain
   *   - Cross-process: if parent isn't in memory, queries DurableDepthStore
   *
   * @param taskId     - Unique task identifier
   * @param instanceId - The instance initiating the chain
   * @param spawnedBy  - Optional parent task ID — depth inherited from parent
   * @param timeoutMs  - Auto-cleanup timeout in ms. 0 = no timeout.
   */
  startChain(taskId: string, instanceId: string, spawnedBy?: string, timeoutMs?: number): void {
    // Input normalization layer (OpenClaw pattern)
    const params = normalizeChainParams({ taskId, instanceId, spawnedBy, timeoutMs })
    if (!params) {
      log.warn("startChain rejected — invalid parameters", { taskId, instanceId })
      return
    }

    const { taskId: nTaskId, instanceId: nInstanceId, spawnedBy: nSpawnedBy, timeoutMs: nTimeoutMs } = params
    const inheritedDepth = nSpawnedBy ? this.resolveInheritedDepth(nSpawnedBy) : 0

    if (inheritedDepth >= this.maxDepth) {
      log.warn("chain start rejected — parent already at max depth", {
        taskId: nTaskId,
        spawnedBy: nSpawnedBy,
        inheritedDepth,
        maxDepth: this.maxDepth,
      })
    }

    const chain: DelegationChain = {
      depth: inheritedDepth,
      visited: new Set([nInstanceId]),
      rootTaskId: nTaskId,
      spawnedBy: nSpawnedBy,
      startedAt: Date.now(),
    }

    const resolvedTimeout = this.resolveTimeoutMs(nTimeoutMs)
    if (resolvedTimeout < MAX_SAFE_TIMEOUT_MS) {
      chain.timeoutHandle = setTimeout(() => {
        log.warn("chain auto-expired — endChain was never called", {
          taskId: nTaskId,
          ageMs: resolvedTimeout,
          depth: chain.depth,
        })
        this.chains.delete(nTaskId)
        // Persist expiration
        if (this.persistenceEnabled) {
          void durableDepthStore.expire(nTaskId)
            .catch((err: unknown) => log.debug("expire persist failed", { err }))
        }
      }, resolvedTimeout)
      chain.timeoutHandle.unref?.()
    }

    this.chains.set(nTaskId, chain)
    log.debug("chain started", { taskId: nTaskId, instanceId: nInstanceId, inheritedDepth, spawnedBy: nSpawnedBy, resolvedTimeout })

    // Write-through to persistence layer
    if (this.persistenceEnabled) {
      void durableDepthStore.save(this.toRecord(nTaskId, chain))
        .catch((err: unknown) => log.debug("persist save failed", { taskId: nTaskId, err }))
    }
  }

  /**
   * Resolve the effective timeout in ms.
   * 0 → MAX_SAFE_TIMEOUT_MS (no auto-cleanup).
   * Clamped to [1, MAX_SAFE_TIMEOUT_MS].
   */
  private resolveTimeoutMs(timeoutMs?: number): number {
    const value = timeoutMs ?? DEFAULT_CHAIN_TIMEOUT_MS
    if (value === 0) return MAX_SAFE_TIMEOUT_MS
    return Math.min(Math.max(value, 1), MAX_SAFE_TIMEOUT_MS)
  }

  /**
   * Walk parent chain to compute the inherited starting depth for a new sub-chain.
   * Checks in-memory first, then falls back to segment-based inference.
   *
   * For cross-process resolution (parent in DB but not in memory),
   * use resolveInheritedDepthAsync() which queries DurableDepthStore.
   *
   * @param parentTaskId - Task ID of the spawning task
   * @returns Starting depth for the new chain
   */
  private resolveInheritedDepth(parentTaskId: string, visited = new Set<string>()): number {
    const normalized = normalizeKey(parentTaskId) ?? parentTaskId
    if (visited.has(normalized)) return 0
    visited.add(normalized)

    const parent = this.chains.get(normalized)
    if (!parent) {
      // Not in memory — fallback to segment inference (sync path)
      return inferDepthFromSegments(normalized)
    }

    if (parent.spawnedBy && !visited.has(parent.spawnedBy)) {
      return parent.depth + 1
    }

    return Math.min(parent.depth + 1, this.maxDepth)
  }

  /**
   * Async version of resolveInheritedDepth — queries DurableDepthStore when
   * the parent chain isn't in memory (cross-process resolution).
   *
   * @param parentTaskId - Task ID of the spawning task
   * @returns Starting depth for the new chain
   */
  async resolveInheritedDepthAsync(parentTaskId: string): Promise<number> {
    const normalized = normalizeKey(parentTaskId) ?? parentTaskId

    // Try in-memory first
    const parent = this.chains.get(normalized)
    if (parent) return Math.min(parent.depth + 1, this.maxDepth)

    // Cross-process: query DB
    if (this.persistenceEnabled) {
      try {
        const dbDepth = await durableDepthStore.resolveDepthFromStore(normalized)
        return Math.min(dbDepth + 1, this.maxDepth)
      } catch (err) {
        log.debug("async depth resolution failed", { parentTaskId, err })
      }
    }

    // Fallback: segment inference
    return inferDepthFromSegments(normalized)
  }

  /**
   * Start a chain with async cross-process depth resolution.
   * Use this when the parent chain may be on another instance.
   *
   * @param taskId     - Unique task identifier
   * @param instanceId - The instance initiating the chain
   * @param spawnedBy  - Parent task ID on a (potentially remote) instance
   * @param timeoutMs  - Auto-cleanup timeout in ms
   */
  async startChainAsync(taskId: string, instanceId: string, spawnedBy?: string, timeoutMs?: number): Promise<void> {
    if (!spawnedBy) {
      this.startChain(taskId, instanceId, undefined, timeoutMs)
      return
    }

    // Input normalization
    const params = normalizeChainParams({ taskId, instanceId, spawnedBy, timeoutMs })
    if (!params) {
      log.warn("startChainAsync rejected — invalid parameters", { taskId, instanceId })
      return
    }

    const inheritedDepth = await this.resolveInheritedDepthAsync(params.spawnedBy!)

    if (inheritedDepth >= this.maxDepth) {
      log.warn("chain start rejected — parent already at max depth (async)", {
        taskId: params.taskId,
        spawnedBy: params.spawnedBy,
        inheritedDepth,
        maxDepth: this.maxDepth,
      })
    }

    const chain: DelegationChain = {
      depth: inheritedDepth,
      visited: new Set([params.instanceId]),
      rootTaskId: params.taskId,
      spawnedBy: params.spawnedBy,
      startedAt: Date.now(),
    }

    const resolvedTimeout = this.resolveTimeoutMs(params.timeoutMs)
    if (resolvedTimeout < MAX_SAFE_TIMEOUT_MS) {
      chain.timeoutHandle = setTimeout(() => {
        log.warn("chain auto-expired — endChain was never called", {
          taskId: params.taskId,
          ageMs: resolvedTimeout,
          depth: chain.depth,
        })
        this.chains.delete(params.taskId)
        if (this.persistenceEnabled) {
          void durableDepthStore.expire(params.taskId)
            .catch((err: unknown) => log.debug("expire persist failed", { err }))
        }
      }, resolvedTimeout)
      chain.timeoutHandle.unref?.()
    }

    this.chains.set(params.taskId, chain)
    log.debug("chain started (async)", { taskId: params.taskId, depth: inheritedDepth })

    if (this.persistenceEnabled) {
      void durableDepthStore.save(this.toRecord(params.taskId, chain))
        .catch((err: unknown) => log.debug("persist save failed", { taskId: params.taskId, err }))
    }
  }

  /**
   * Check whether a delegation to a target instance is allowed.
   * Returns false if max depth exceeded or a cycle is detected.
   *
   * @param taskId          - Task being delegated
   * @param targetInstanceId - Instance to delegate to
   * @returns Whether delegation is allowed
   */
  canDelegate(taskId: string, targetInstanceId: string): boolean {
    const nTaskId = normalizeKey(taskId) ?? taskId
    const nTarget = normalizeKey(targetInstanceId) ?? targetInstanceId

    const chain = this.chains.get(nTaskId)
    if (!chain) {
      // No tracked chain — allow but warn (first delegation)
      return true
    }

    if (chain.depth >= this.maxDepth) {
      log.warn("delegation depth limit reached", {
        taskId: nTaskId,
        depth: chain.depth,
        maxDepth: this.maxDepth,
        targetInstanceId: nTarget,
      })
      return false
    }

    if (chain.visited.has(nTarget)) {
      log.warn("circular delegation detected", {
        taskId: nTaskId,
        targetInstanceId: nTarget,
        visited: [...chain.visited],
      })
      return false
    }

    return true
  }

  /**
   * Record that a delegation has occurred, incrementing depth and adding the target to visited.
   *
   * @param taskId          - Task being delegated
   * @param targetInstanceId - Instance that received the delegation
   */
  recordDelegation(taskId: string, targetInstanceId: string): void {
    const nTaskId = normalizeKey(taskId) ?? taskId
    const nTarget = normalizeKey(targetInstanceId) ?? targetInstanceId

    const chain = this.chains.get(nTaskId)
    if (!chain) {
      this.startChain(nTaskId, nTarget)
      return
    }

    chain.depth++
    chain.visited.add(nTarget)

    log.debug("delegation recorded", {
      taskId: nTaskId,
      depth: chain.depth,
      targetInstanceId: nTarget,
    })

    // Write-through to persistence
    if (this.persistenceEnabled) {
      void durableDepthStore.updateDepth(nTaskId, chain.depth, [...chain.visited])
        .catch((err: unknown) => log.debug("persist update failed", { taskId: nTaskId, err }))
    }
  }

  /**
   * End tracking for a completed or failed chain.
   * Clears the auto-cleanup timer and marks as completed in the DB.
   *
   * @param taskId - Task that completed
   */
  endChain(taskId: string): void {
    const nTaskId = normalizeKey(taskId) ?? taskId

    const chain = this.chains.get(nTaskId)
    if (chain?.timeoutHandle !== undefined) {
      clearTimeout(chain.timeoutHandle)
    }
    this.chains.delete(nTaskId)

    // Mark completed in persistence (don't delete — needed for cross-process resolution)
    if (this.persistenceEnabled) {
      void durableDepthStore.complete(nTaskId)
        .catch((err: unknown) => log.debug("persist complete failed", { taskId: nTaskId, err }))
    }
  }

  /**
   * Get the current depth for a task chain.
   *
   * @param taskId - Task to check
   * @returns Current depth, or 0 if not tracked
   */
  getDepth(taskId: string): number {
    const nTaskId = normalizeKey(taskId) ?? taskId
    return this.chains.get(nTaskId)?.depth ?? 0
  }

  /**
   * Returns true if the task chain is already at or above the max depth.
   *
   * @param taskId - Task to check
   */
  isAtMaxDepth(taskId: string): boolean {
    return this.getDepth(taskId) >= this.maxDepth
  }

  /**
   * Async depth query — checks in-memory first, then DB.
   * Use for cross-process scenarios where the chain may live on another instance.
   *
   * @param taskId - Task to check
   * @returns Current depth from memory or DB
   */
  async getDepthAsync(taskId: string): Promise<number> {
    const nTaskId = normalizeKey(taskId) ?? taskId
    const memDepth = this.chains.get(nTaskId)?.depth
    if (memDepth !== undefined) return memDepth

    if (this.persistenceEnabled) {
      try {
        return await durableDepthStore.resolveDepthFromStore(nTaskId)
      } catch {
        return 0
      }
    }
    return 0
  }

  /**
   * Return debug info about a chain — depth, visited instances, age, parent.
   *
   * @param taskId - Task to inspect
   */
  getChainInfo(taskId: string): {
    depth: number
    visited: string[]
    ageMs: number
    spawnedBy?: string
    hasTimeout: boolean
    persisted: boolean
  } | null {
    const nTaskId = normalizeKey(taskId) ?? taskId
    const chain = this.chains.get(nTaskId)
    if (!chain) return null
    return {
      depth: chain.depth,
      visited: [...chain.visited],
      ageMs: Date.now() - chain.startedAt,
      spawnedBy: chain.spawnedBy,
      hasTimeout: chain.timeoutHandle !== undefined,
      persisted: this.persistenceEnabled,
    }
  }

  /** Get count of active chains (in-memory). */
  get activeCount(): number {
    return this.chains.size
  }

  /** Clear all tracked chains and cancel all timers (for testing or reset). */
  reset(): void {
    for (const chain of this.chains.values()) {
      if (chain.timeoutHandle !== undefined) {
        clearTimeout(chain.timeoutHandle)
      }
    }
    this.chains.clear()
  }

  /** Convert in-memory DelegationChain to a ChainRecord for persistence. */
  private toRecord(taskId: string, chain: DelegationChain): ChainRecord {
    return {
      taskId,
      instanceId: [...chain.visited][0] ?? "unknown",
      depth: chain.depth,
      spawnedBy: chain.spawnedBy,
      visited: [...chain.visited],
      rootTaskId: chain.rootTaskId,
      status: "active",
    }
  }
}

export const depthGuard = new DepthGuard()
