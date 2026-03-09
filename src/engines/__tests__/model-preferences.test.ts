/**
 * @file model-preferences.test.ts
 * @description Unit tests for ModelPreferencesStore and ENGINE_MODEL_CATALOG.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { modelPreferences, ENGINE_MODEL_CATALOG } from "../model-preferences.js"

describe("ModelPreferencesStore", () => {
  beforeEach(() => {
    // Reset known test users
    modelPreferences.reset("user1")
    modelPreferences.reset("user2")
  })

  it("returns null for a user with no preference set", () => {
    expect(modelPreferences.get("unknown-user")).toBeNull()
  })

  it("setEngine() stores engine preference", () => {
    modelPreferences.setEngine("user1", "groq")
    const pref = modelPreferences.get("user1")
    expect(pref?.engine).toBe("groq")
    expect(pref?.model).toBeUndefined()
  })

  it("setModel() stores both engine and model preference", () => {
    modelPreferences.setModel("user1", "anthropic", "claude-sonnet-4-20250514")
    const pref = modelPreferences.get("user1")
    expect(pref?.engine).toBe("anthropic")
    expect(pref?.model).toBe("claude-sonnet-4-20250514")
  })

  it("reset() removes user preferences", () => {
    modelPreferences.setEngine("user1", "openai")
    modelPreferences.reset("user1")
    expect(modelPreferences.get("user1")).toBeNull()
  })

  it("reset() on non-existent user does nothing", () => {
    expect(() => modelPreferences.reset("ghost-user")).not.toThrow()
  })

  it("preferences are independent per user", () => {
    modelPreferences.setEngine("user1", "groq")
    modelPreferences.setEngine("user2", "openai")
    expect(modelPreferences.get("user1")?.engine).toBe("groq")
    expect(modelPreferences.get("user2")?.engine).toBe("openai")
  })

  it("setModel() overrides previous setEngine()", () => {
    modelPreferences.setEngine("user1", "groq")
    modelPreferences.setModel("user1", "anthropic", "claude-haiku-3-5-20241022")
    const pref = modelPreferences.get("user1")
    expect(pref?.engine).toBe("anthropic")
    expect(pref?.model).toBe("claude-haiku-3-5-20241022")
  })

  it("setEngine() returns the preference object", () => {
    const result = modelPreferences.setEngine("user1", "gemini")
    expect(result).toEqual({ engine: "gemini" })
  })

  it("setModel() returns the preference object", () => {
    const result = modelPreferences.setModel("user1", "openai", "gpt-4o")
    expect(result).toEqual({ engine: "openai", model: "gpt-4o" })
  })
})

describe("ENGINE_MODEL_CATALOG", () => {
  it("includes all expected engine providers", () => {
    const providers = Object.keys(ENGINE_MODEL_CATALOG)
    expect(providers).toContain("anthropic")
    expect(providers).toContain("openai")
    expect(providers).toContain("gemini")
    expect(providers).toContain("groq")
    expect(providers).toContain("ollama")
  })

  it("every catalog entry has displayName and models array", () => {
    for (const [key, entry] of Object.entries(ENGINE_MODEL_CATALOG)) {
      expect(typeof entry.displayName).toBe("string")
      expect(entry.displayName.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.models)).toBe(true)
      expect(entry.models.length).toBeGreaterThan(0)
    }
  })

  it("anthropic entry has claude models", () => {
    const anthropicModels = ENGINE_MODEL_CATALOG.anthropic?.models ?? []
    expect(anthropicModels.some((m) => m.includes("claude"))).toBe(true)
  })

  it("openai entry has gpt models", () => {
    const openaiModels = ENGINE_MODEL_CATALOG.openai?.models ?? []
    expect(openaiModels.some((m) => m.startsWith("gpt") || m.startsWith("o"))).toBe(true)
  })

  it("modelInfo entries have required fields when present", () => {
    for (const [_, entry] of Object.entries(ENGINE_MODEL_CATALOG)) {
      if (entry.modelInfo) {
        for (const [modelId, info] of Object.entries(entry.modelInfo)) {
          expect(typeof info.id).toBe("string")
          expect(typeof info.displayName).toBe("string")
          expect(typeof info.contextWindow).toBe("number")
          expect(info.contextWindow).toBeGreaterThan(0)
          expect(Array.isArray(info.capabilities)).toBe(true)
        }
      }
    }
  })
})
