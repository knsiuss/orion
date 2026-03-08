/**
 * @file simulation.test.ts
 * @description Tests for Phase 25 Digital Twin & Simulation modules.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { ActionClassifier } from "../action-classifier.js"
import { VirtualFS } from "../sandbox-virtual-fs.js"
import { SnapshotManager } from "../snapshot-manager.js"

// ---------------------------------------------------------------------------
// ActionClassifier
// ---------------------------------------------------------------------------
describe("ActionClassifier", () => {
  let classifier: ActionClassifier

  beforeEach(() => {
    classifier = new ActionClassifier()
  })

  it("classifies read tools correctly", () => {
    expect(classifier.classify("read_file")).toBe("read")
    expect(classifier.classify("search")).toBe("read")
    expect(classifier.classify("ls")).toBe("read")
  })

  it("classifies write tools correctly", () => {
    expect(classifier.classify("write_file")).toBe("write")
    expect(classifier.classify("edit_file")).toBe("write")
    expect(classifier.classify("create_file")).toBe("write")
  })

  it("classifies destructive tools correctly", () => {
    expect(classifier.classify("delete_file")).toBe("destructive")
    expect(classifier.classify("send_email")).toBe("destructive")
    expect(classifier.classify("git_push")).toBe("destructive")
  })

  it("classifies external tools correctly", () => {
    expect(classifier.classify("api_call")).toBe("external")
    expect(classifier.classify("webhook")).toBe("external")
    expect(classifier.classify("deploy")).toBe("external")
  })

  it("defaults unknown tools to write", () => {
    expect(classifier.classify("unknown_custom_tool")).toBe("write")
  })

  it("shouldPreview returns true for write, destructive, external", () => {
    expect(classifier.shouldPreview("write")).toBe(true)
    expect(classifier.shouldPreview("destructive")).toBe(true)
    expect(classifier.shouldPreview("external")).toBe(true)
    expect(classifier.shouldPreview("read")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// VirtualFS
// ---------------------------------------------------------------------------
describe("VirtualFS", () => {
  let vfs: VirtualFS

  beforeEach(() => {
    vfs = new VirtualFS()
  })

  it("apply adds new files", () => {
    const modified = vfs.apply([{ path: "/tmp/test.ts", content: "console.log('hi')" }])
    expect(modified.has("/tmp/test.ts")).toBe(true)
  })

  it("apply deletes files when content is null", () => {
    // apply with null = delete
    const modified = vfs.apply([{ path: "a.txt", content: null }])
    expect(modified.has("a.txt")).toBe(false)
  })

  it("diff detects new file", () => {
    const original = new Map<string, string>()
    const modified = new Map([["new.ts", "const x = 1"]])
    const result = vfs.diff(original, modified)
    expect(result).toContain("new.ts")
    expect(result).toContain("NEW FILE")
  })

  it("diff detects deleted file", () => {
    const original = new Map([["old.ts", "const x = 1"]])
    const modified = new Map<string, string>()
    const result = vfs.diff(original, modified)
    expect(result).toContain("DELETED")
  })

  it("diff returns (no changes) for identical maps", () => {
    const map = new Map([["same.ts", "same content"]])
    expect(vfs.diff(map, map)).toBe("(no changes)")
  })

  it("clone returns empty map for non-existent files", async () => {
    const result = await vfs.clone(["/nonexistent/path/file.ts"])
    expect(result.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SnapshotManager
// ---------------------------------------------------------------------------
describe("SnapshotManager", () => {
  let manager: SnapshotManager

  beforeEach(() => {
    manager = new SnapshotManager()
  })

  it("before returns a snapshotId and getSnapshot retrieves it", async () => {
    const id = await manager.before("action-1", "write_file", "/nonexistent/path")
    expect(typeof id).toBe("string")
    const snapshot = manager.getSnapshot(id)
    expect(snapshot).toBeDefined()
    expect(snapshot?.actionId).toBe("action-1")
  })

  it("listRecent returns newest first", async () => {
    await manager.before("a1", "write_file", "/p1")
    await manager.before("a2", "write_file", "/p2")
    const recent = manager.listRecent(2)
    expect(recent[0]?.actionId).toBe("a2")
    expect(recent[1]?.actionId).toBe("a1")
  })

  it("prune keeps max 50 snapshots", async () => {
    const promises: Promise<string>[] = []
    for (let i = 0; i < 55; i++) {
      promises.push(manager.before(`action-${i}`, "write_file", "/path"))
    }
    await Promise.all(promises)
    manager.prune()
    expect(manager.listRecent().length).toBeLessThanOrEqual(50)
  })

  it("getSnapshot returns undefined for unknown id", () => {
    expect(manager.getSnapshot("nonexistent-id")).toBeUndefined()
  })
})
