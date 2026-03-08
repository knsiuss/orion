/**
 * @file crdt-store.ts
 * @description Simple Last-Write-Wins CRDT register store for multi-instance state sync.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - shared-knowledge.ts uses this for CRDT-based knowledge sync.
 *   - No external CRDT library — pure TypeScript LWW register.
 *   - merge() resolves conflicts deterministically using timestamp + nodeId as tiebreaker.
 */

import { createLogger } from "../../logger.js"

const log = createLogger("legion.crdt-store")

/** A single CRDT register entry with LWW semantics. */
export interface CRDTEntry {
  /** Stored value. */
  value: unknown
  /** Unix timestamp (milliseconds) of last write. */
  ts: number
  /** Node ID that performed the last write (used as tiebreaker). */
  nodeId: string
}

/** Exported CRDT state for synchronization. */
export type CRDTExport = Record<string, CRDTEntry>

/**
 * Last-Write-Wins CRDT register store.
 * Concurrent updates are resolved by timestamp, then nodeId lexicographic order.
 */
export class CRDTStore {
  /** Internal state map. */
  private readonly store = new Map<string, CRDTEntry>()

  /** This node's identifier. */
  private readonly nodeId: string

  constructor(nodeId?: string) {
    this.nodeId = nodeId ?? process.env.LEGION_INSTANCE_ID ?? "primary"
  }

  /**
   * Set a key to a value with the current timestamp.
   *
   * @param key    - Register key.
   * @param value  - New value.
   * @param nodeId - Writing node ID (defaults to this instance's ID).
   */
  set(key: string, value: unknown, nodeId?: string): void {
    const writer = nodeId ?? this.nodeId
    const existing = this.store.get(key)
    const ts = Date.now()

    // Only write if newer than existing (LWW)
    if (!existing || ts > existing.ts || (ts === existing.ts && writer > existing.nodeId)) {
      this.store.set(key, { value, ts, nodeId: writer })
      log.debug("crdt set", { key, nodeId: writer })
    }
  }

  /**
   * Get the current value for a key.
   *
   * @param key - Register key.
   * @returns Current value or undefined.
   */
  get(key: string): unknown {
    return this.store.get(key)?.value
  }

  /**
   * Merge remote state into local state using LWW conflict resolution.
   *
   * @param remote - Remote CRDT export to merge.
   */
  merge(remote: CRDTExport): void {
    for (const [key, remoteEntry] of Object.entries(remote)) {
      const local = this.store.get(key)
      if (
        !local ||
        remoteEntry.ts > local.ts ||
        (remoteEntry.ts === local.ts && remoteEntry.nodeId > local.nodeId)
      ) {
        this.store.set(key, remoteEntry)
        log.debug("crdt merge: remote wins", { key, nodeId: remoteEntry.nodeId })
      }
    }
  }

  /**
   * Export the full CRDT state for transmission to peers.
   *
   * @returns Serializable CRDT export.
   */
  export(): CRDTExport {
    const result: CRDTExport = {}
    for (const [key, entry] of this.store) {
      result[key] = { ...entry }
    }
    return result
  }
}

/** Singleton CRDT store. */
export const crdtStore = new CRDTStore()
