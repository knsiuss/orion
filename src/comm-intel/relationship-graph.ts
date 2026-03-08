/**
 * @file relationship-graph.ts
 * @description Tracks interpersonal relationships — who knows who, strength, context.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Fed by comm-intel modules (screener, meeting-prep). Provides context to the
 *   system-prompt-builder for relationship-aware responses.
 */
import { createLogger } from "../logger.js"

const log = createLogger("comm-intel.relationship-graph")

export interface Relationship {
  fromUserId: string
  toContactId: string
  name: string
  strength: number
  context: string[]
  lastInteraction: Date
}

class RelationshipGraph {
  private relationships = new Map<string, Relationship[]>()

  async record(userId: string, contactId: string, name: string, context: string): Promise<void> {
    const userRels = this.relationships.get(userId) ?? []
    const existing = userRels.find(r => r.toContactId === contactId)

    if (existing) {
      existing.strength = Math.min(1, existing.strength + 0.05)
      existing.lastInteraction = new Date()
      if (!existing.context.includes(context)) {
        existing.context.push(context)
      }
    } else {
      userRels.push({
        fromUserId: userId,
        toContactId: contactId,
        name,
        strength: 0.5,
        context: [context],
        lastInteraction: new Date(),
      })
    }

    this.relationships.set(userId, userRels)
    log.debug("relationship recorded", { userId, contactId })
  }

  getRelationships(userId: string): Relationship[] {
    return this.relationships.get(userId) ?? []
  }

  getRelationship(userId: string, contactId: string): Relationship | undefined {
    return this.getRelationships(userId).find(r => r.toContactId === contactId)
  }
}

export const relationshipGraph = new RelationshipGraph()
