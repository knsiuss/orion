import { describe, it, expect, beforeEach } from "vitest"
import { ExtensionRegistry } from "../registry.js"

describe("ExtensionRegistry", () => {
  let registry: ExtensionRegistry

  beforeEach(() => {
    registry = new ExtensionRegistry()
  })

  it("registers and lists extensions", () => {
    registry.register({
      name: "test",
      version: "1.0.0",
      description: "test",
      type: "tool",
    })
    expect(registry.list()).toHaveLength(1)
  })

  it("gets extension by name", () => {
    registry.register({
      name: "my-ext",
      version: "1.0.0",
      description: "x",
      type: "hook",
    })
    expect(registry.get("my-ext")?.name).toBe("my-ext")
  })

  it("returns undefined for missing extension", () => {
    expect(registry.get("nonexistent")).toBeUndefined()
  })

  it("overrides on duplicate name", () => {
    registry.register({
      name: "dup",
      version: "1.0.0",
      description: "v1",
      type: "tool",
    })
    registry.register({
      name: "dup",
      version: "2.0.0",
      description: "v2",
      type: "tool",
    })
    expect(registry.list()).toHaveLength(1)
    expect(registry.get("dup")?.version).toBe("2.0.0")
  })
})
