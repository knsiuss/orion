import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import config from "../../config.js"
import * as keywordMemory from "../memory-node-fts.js"
import { MemoryStore, EmbeddingUnavailableError } from "../store.js"
import { temporalIndex } from "../temporal-index.js"

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
      if (url.includes("/api/embed")) {
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

  it("throws EmbeddingUnavailableError when every embedding provider fails", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof globalThis.fetch

    await expect(store.embed("embedding failure")).rejects.toBeInstanceOf(EmbeddingUnavailableError)
  })

  it("embed caches repeated text to avoid duplicate provider calls", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    const ollamaVector = new Array(768).fill(0.42)
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: ollamaVector }),
    }) as Response) as typeof globalThis.fetch

    const first = await store.embed("cache me")
    const second = await store.embed("cache me")

    expect(first).toEqual(second)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it("stores to the keyword path without writing vectors when embeddings are unavailable", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    const add = vi.fn()
    ;(store as unknown as { table: { add: typeof add } }).table = { add } as unknown as { add: typeof add }

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof globalThis.fetch

    const temporalSpy = vi.spyOn(temporalIndex, "store").mockResolvedValue({
      id: "memory-id",
      userId: "u1",
      content: "remember this",
      level: 0,
      validFrom: new Date(),
      validUntil: null,
      category: "fact",
    })

    const id = await store.save("u1", "remember this", {
      category: "fact",
      temporal: false,
    })

    expect(id).toBeTypeOf("string")
    expect(add).not.toHaveBeenCalled()
    expect(temporalSpy).toHaveBeenCalledOnce()
    expect(temporalSpy.mock.calls[0]?.[4]).toBe(id)
    expect(temporalSpy.mock.calls[0]?.[5]).toMatchObject({
      category: "fact",
      temporal: false,
      embeddingStatus: "unavailable",
    })
  })

  it("degrades search to keyword-only retrieval when embeddings are unavailable", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof globalThis.fetch

    const keywordSpy = vi.spyOn(keywordMemory, "searchMemoryNodeFTS").mockResolvedValue([
      {
        id: "fts-1",
        content: "keyword memory",
        metadata: { source: "fts" },
        score: 0.9,
      },
    ])

    const results = await store.search("u1", "keyword memory", 3)

    expect(keywordSpy).toHaveBeenCalledWith("u1", "keyword memory", 3)
    expect(results).toEqual([
      {
        id: "fts-1",
        content: "keyword memory",
        metadata: { source: "fts" },
        score: 0.9,
      },
    ])
  })
})
