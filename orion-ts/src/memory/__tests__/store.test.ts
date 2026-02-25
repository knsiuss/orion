import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import config from "../../config.js"
import { MemoryStore } from "../store.js"

describe("MemoryStore", () => {
  let originalFetch: typeof globalThis.fetch
  let originalOpenAiKey: string

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalOpenAiKey = config.OPENAI_API_KEY
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    config.OPENAI_API_KEY = originalOpenAiKey
    vi.restoreAllMocks()
  })

  it("embed falls back to OpenAI when Ollama embedding is unavailable", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = "test-key"

    const openAiVector = new Array(768).fill(0.123)
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/embeddings")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: openAiVector }] }),
      } as Response
    }) as typeof globalThis.fetch

    const vector = await store.embed("hello")

    expect(vector).toHaveLength(768)
    expect(vector[0]).toBe(0.123)
  })

  it("drops stale pending feedback on consume", () => {
    const store = new MemoryStore()
    const nowSpy = vi.spyOn(Date, "now")

    nowSpy.mockReturnValue(1_000)
    store.registerPendingFeedback("u1", ["m1"], 0.5)

    nowSpy.mockReturnValue(31 * 60 * 1000 + 1_000)
    const consumed = store.consumePendingFeedback("u1")

    expect(consumed).toBeNull()
  })
})
