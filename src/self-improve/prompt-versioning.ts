/**
 * @file prompt-versioning.ts
 * @description Version history for per-zone system prompt mutations.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - prompt-optimizer.ts calls save() when an optimization is applied.
 *   - rollback() restores previous content if quality degrades.
 *   - Keeps max 30 versions per zone to bound memory usage.
 */

import { createLogger } from "../logger.js"
import type { PromptVersion } from "./types.js"

const log = createLogger("self-improve.prompt-versioning")

/** Maximum number of versions retained per zone. */
const MAX_VERSIONS_PER_ZONE = 30

/**
 * Maintains a versioned history of prompt zone content.
 * Supports rollback to any prior version.
 */
export class PromptVersioning {
  /** Map of zone → ordered list of versions (oldest first). */
  private readonly store = new Map<string, PromptVersion[]>()

  /**
   * Save a new prompt version for a zone.
   * Evicts the oldest version when the per-zone limit is exceeded.
   *
   * @param version - PromptVersion to persist.
   */
  save(version: PromptVersion): void {
    if (!this.store.has(version.zone)) {
      this.store.set(version.zone, [])
    }
    const versions = this.store.get(version.zone)!
    versions.push(version)
    if (versions.length > MAX_VERSIONS_PER_ZONE) {
      versions.shift()
    }
    log.info("prompt version saved", { zone: version.zone, id: version.id })
  }

  /**
   * Get the most recently saved version for a zone.
   *
   * @param zone - Prompt zone name.
   * @returns Latest PromptVersion or undefined if no versions exist.
   */
  getLatest(zone: string): PromptVersion | undefined {
    const versions = this.store.get(zone)
    return versions?.[versions.length - 1]
  }

  /**
   * Roll back a zone to a previous version.
   * If versionId is provided, restores that exact version.
   * If omitted, restores the second-to-last version (one step back).
   *
   * @param zone      - Prompt zone to roll back.
   * @param versionId - Optional specific version ID to restore.
   * @returns The restored PromptVersion, or undefined if no suitable version found.
   */
  rollback(zone: string, versionId?: string): PromptVersion | undefined {
    const versions = this.store.get(zone)
    if (!versions || versions.length < 2) {
      log.warn("rollback: insufficient version history", { zone })
      return undefined
    }

    let target: PromptVersion | undefined
    if (versionId) {
      target = versions.find((v) => v.id === versionId)
    } else {
      target = versions[versions.length - 2]
    }

    if (!target) {
      log.warn("rollback: version not found", { zone, versionId })
      return undefined
    }

    log.info("prompt rolled back", { zone, targetId: target.id })
    return target
  }

  /**
   * List all stored versions, optionally filtered to a single zone.
   *
   * @param zone - Optional zone to filter by.
   * @returns Array of versions (oldest first within each zone).
   */
  list(zone?: string): PromptVersion[] {
    if (zone) {
      return [...(this.store.get(zone) ?? [])]
    }
    const all: PromptVersion[] = []
    for (const versions of this.store.values()) {
      all.push(...versions)
    }
    return all
  }
}

/** Singleton prompt versioning system. */
export const promptVersioning = new PromptVersioning()
