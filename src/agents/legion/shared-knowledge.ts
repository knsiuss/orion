/**
 * @file shared-knowledge.ts
 * @description CRDT-backed shared knowledge store for multi-instance synchronization.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses crdtStore for conflict-free distributed state.
 *   - team-mode.ts access control is enforced in query().
 *   - Accessible to all instances with valid authentication.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../../logger.js"
import { crdtStore, type CRDTExport } from "./crdt-store.js"
import type { SharedKnowledgeEntry } from "./types.js"

const log = createLogger("legion.shared-knowledge")

/**
 * Distributed shared knowledge store backed by CRDT for multi-instance sync.
 */
export class SharedKnowledge {
  /**
   * Publish a knowledge entry to the shared store.
   *
   * @param entry - Knowledge entry to publish.
   */
  publish(entry: SharedKnowledgeEntry): void {
    crdtStore.set(`knowledge:${entry.id}`, entry)
    log.info("knowledge entry published", { id: entry.id, topic: entry.topic })
  }

  /**
   * Query shared knowledge entries by topic.
   * Access control is enforced — only entries the user can access are returned.
   *
   * @param topic          - Topic to filter by.
   * @param accessorUserId - User ID querying the knowledge.
   * @returns Matching knowledge entries the user can access.
   */
  query(topic: string, accessorUserId: string): SharedKnowledgeEntry[] {
    const exported = crdtStore.export()
    const results: SharedKnowledgeEntry[] = []

    for (const [key, entry] of Object.entries(exported)) {
      if (!key.startsWith("knowledge:")) continue
      const knowledge = entry.value as SharedKnowledgeEntry
      if (!knowledge.topic.toLowerCase().includes(topic.toLowerCase())) continue

      // Access check: empty access list = public to all team members
      const accessible =
        knowledge.access.length === 0 || knowledge.access.includes(accessorUserId)
      if (accessible) {
        results.push(knowledge)
      }
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Sync remote CRDT state into the local store.
   *
   * @param remote - Exported CRDT state from a remote instance.
   */
  sync(remote: CRDTExport): void {
    crdtStore.merge(remote)
    log.debug("shared knowledge synced")
  }

  /**
   * Create a new knowledge entry with auto-generated ID and timestamp.
   *
   * @param topic       - Knowledge topic.
   * @param content     - Knowledge content.
   * @param publishedBy - Author user or instance ID.
   * @param access      - Allowed user IDs (empty = all team members).
   * @returns The created SharedKnowledgeEntry.
   */
  create(
    topic: string,
    content: string,
    publishedBy: string,
    access: string[] = [],
  ): SharedKnowledgeEntry {
    const entry: SharedKnowledgeEntry = {
      id: randomUUID(),
      topic,
      content,
      publishedBy,
      access,
      createdAt: new Date().toISOString(),
    }
    this.publish(entry)
    return entry
  }
}

/** Singleton shared knowledge store. */
export const sharedKnowledge = new SharedKnowledge()
