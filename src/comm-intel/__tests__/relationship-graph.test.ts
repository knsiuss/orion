/**
 * @file relationship-graph.test.ts
 * @description Unit/integration tests for comm-intel\.__tests__\.relationship-graph.test.ts.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { relationshipGraph } from "../relationship-graph.js"

describe("RelationshipGraph", () => {
  it("records and retrieves a relationship", async () => {
    await relationshipGraph.record("owner", "alice", "Alice", "work")
    const rels = relationshipGraph.getRelationships("owner")
    expect(rels.length).toBe(1)
    expect(rels[0].name).toBe("Alice")
    expect(rels[0].strength).toBe(0.5)
  })

  it("strengthens existing relationships", async () => {
    await relationshipGraph.record("owner2", "bob", "Bob", "work")
    await relationshipGraph.record("owner2", "bob", "Bob", "personal")
    const rel = relationshipGraph.getRelationship("owner2", "bob")
    expect(rel).toBeDefined()
    expect(rel!.strength).toBeGreaterThan(0.5)
    expect(rel!.context).toContain("personal")
  })
})
