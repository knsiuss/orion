/**
 * store.ts — Primary memory store and context builder.
 *
 * Manages the LanceDB vector store for semantic memory retrieval and
 * coordinates with the following subsystems:
 *   - MemRL (memrl.ts)         — utility-aware two-phase retrieval
 *   - HiMeS (himes.ts)         — hierarchical memory session builder
 *   - ProMem (promem.ts)       — memory compression via LLM extraction
 *   - TemporalIndex            — time-based memory decay
 *
 * Embedding priority (auto-selected):
 *   Ollama (nomic-embed-text) → OpenAI (text-embedding-3-small) → hash-based fallback
 *
 * Vector dimension: 768 (nomic-embed-text / text-embedding-3-small compatible)
 *
 * @module memory/store
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import * as lancedb from "@lancedb/lancedb"

import config from "../config.js"
import { getHistory, saveMessage } from "../database/index.js"
import { validateMemoryEntries, type MemoryEntry } from "../security/memory-validator.js"
import { createLogger } from "../logger.js"
import { sanitizeUserId, parseJsonSafe } from "../utils/index.js"
import { hiMeS } from "./himes.js"
import { memrlUpdater, type TaskFeedback } from "./memrl.js"
import * as keywordMemory from "./memory-node-fts.js"
import { proMem } from "./promem.js"
import { temporalIndex } from "./temporal-index.js"

const log = createLogger("memory.store")

const VECTOR_DIMENSION = 768
const LEGACY_VECTOR_DIMENSION = 1536
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"
const EMBEDDING_REQUEST_TIMEOUT_MS = 8_000
const PENDING_FEEDBACK_MAX_AGE_MS = 30 * 60 * 1000
const EMBEDDING_CACHE_MAX_ENTRIES = 512

interface MemoryRow extends Record<string, unknown> {
  id: string
  userId: string
  content: string
  vector: number[]
  metadata: string
  createdAt: number
  utilityScore: number
}

async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      return { ok: false, status: response.status, data: null }
    }

    const data = (await response.json()) as T
    return { ok: true, status: response.status, data }
  } finally {
    clearTimeout(timeout)
  }
}

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export interface BuildContextResult {
  systemContext: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  retrievedMemoryIds: string[]
}

/**
 * Signals that semantic embeddings are unavailable and callers must fall back
 * to the keyword-only memory path.
 */
export class EmbeddingUnavailableError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(`Embedding unavailable: ${reason}`)
    this.name = "EmbeddingUnavailableError"
    this.reason = reason
  }
}

async function openAIEmbed(text: string): Promise<number[] | null> {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.trim().length === 0) {
    return null
  }

  try {
    const result = await fetchJsonWithTimeout<{ data?: Array<{ embedding?: number[] }> }>(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_EMBEDDING_MODEL,
          input: text,
          dimensions: VECTOR_DIMENSION,
        }),
      },
      EMBEDDING_REQUEST_TIMEOUT_MS,
    )

    if (!result.ok) {
      log.warn("OpenAI embedding API failed", { status: result.status })
      return null
    }

    const embedding = result.data?.data?.[0]?.embedding

    if (!embedding || embedding.length !== VECTOR_DIMENSION) {
      log.warn("Unexpected embedding dimension", { expected: VECTOR_DIMENSION, got: embedding?.length })
      return null
    }

    return embedding
  } catch (error) {
    log.warn("OpenAI embedding request failed", error)
    return null
  }
}

async function ollamaEmbed(text: string): Promise<number[] | null> {
  const baseUrl = config.OLLAMA_BASE_URL.trim().length > 0
    ? config.OLLAMA_BASE_URL
    : "http://localhost:11434"

  try {
    const result = await fetchJsonWithTimeout<{ embedding?: number[]; embeddings?: number[][] }>(
      `${baseUrl.replace(/\/+$/, "")}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_EMBEDDING_MODEL,
          input: text,
        }),
      },
      EMBEDDING_REQUEST_TIMEOUT_MS,
    )

    if (!result.ok) {
      log.warn("Ollama embedding API failed", { status: result.status })
      return null
    }

    const embedding = result.data?.embeddings?.[0] ?? result.data?.embedding

    if (!embedding || embedding.length !== VECTOR_DIMENSION) {
      log.warn("Unexpected embedding dimension", { expected: VECTOR_DIMENSION, got: embedding?.length })
      return null
    }

    return embedding
  } catch (error) {
    log.warn("Ollama embedding request failed", error)
    return null
  }
}

export class MemoryStore {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private initialized = false
  private embeddingCache = new Map<string, number[]>()

  private getCachedEmbedding(text: string): number[] | null {
    const cached = this.embeddingCache.get(text)
    return cached ? [...cached] : null
  }

  private setCachedEmbedding(text: string, vector: number[]): void {
    this.embeddingCache.set(text, [...vector])
    if (this.embeddingCache.size <= EMBEDDING_CACHE_MAX_ENTRIES) {
      return
    }

    const oldestKey = this.embeddingCache.keys().next().value
    if (typeof oldestKey === "string") {
      this.embeddingCache.delete(oldestKey)
    }
  }

  private async persistKeywordMemory(
    userId: string,
    content: string,
    metadata: Record<string, unknown>,
    id: string,
  ): Promise<string> {
    const levelValue = Number(metadata.level)
    const level = levelValue === 1 || levelValue === 2 ? levelValue : 0
    const category = typeof metadata.category === "string" ? metadata.category : "fact"

    await temporalIndex.store(userId, content, level, category, id, metadata)
    return id
  }

  private async createMemoryTable(): Promise<lancedb.Table> {
    if (!this.db) {
      throw new Error("memory database not initialized")
    }

    const dummyVector = new Array(VECTOR_DIMENSION).fill(0)
    const initialRow: MemoryRow = {
      id: randomUUID(),
      userId: "__init__",
      content: "__init__",
      vector: dummyVector,
      metadata: "{}",
      createdAt: Date.now(),
      utilityScore: 0.5,
    }

    const table = await this.db.createTable("memories", [initialRow])
    await table.delete("userId = '__init__'")
    return table
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      const dbPath = path.resolve(process.cwd(), ".edith", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })

      this.db = await lancedb.connect(dbPath)

      const existing = await this.db.tableNames()
      if (existing.includes("memories")) {
        const existingTable = await this.db.openTable("memories")
        const sampleRows = (await existingTable.query().select(["vector"]).limit(1).toArray()) as Array<{
          vector?: unknown
        }>
        const firstVector = sampleRows[0]?.vector
        const firstVectorLength =
          Array.isArray(firstVector)
            || (typeof firstVector === "object" && firstVector !== null && "length" in firstVector)
            ? Number((firstVector as { length: number }).length)
            : null

        if (firstVectorLength === LEGACY_VECTOR_DIMENSION) {
          log.info("legacy memory table detected, recreating", {
            fromDimension: firstVectorLength,
            toDimension: VECTOR_DIMENSION,
          })
          await this.db.dropTable("memories")
          this.table = await this.createMemoryTable()
        } else {
          this.table = existingTable
        }
      } else {
        this.table = await this.createMemoryTable()
      }

      this.initialized = true
      log.info("memory store initialized", { vectorDimension: VECTOR_DIMENSION })
    } catch (error) {
      log.error("failed to init memory store", error)
    }
  }

  async embed(text: string): Promise<number[]> {
    const cacheKey = text.trim()
    if (cacheKey) {
      const cached = this.getCachedEmbedding(cacheKey)
      if (cached) {
        return cached
      }
    }

    const providerFailures: string[] = []
    const ollamaResult = await ollamaEmbed(text)

    if (ollamaResult) {
      if (cacheKey) {
        this.setCachedEmbedding(cacheKey, ollamaResult)
      }
      return ollamaResult
    }
    providerFailures.push("ollama unavailable")

    const openAiConfigured = config.OPENAI_API_KEY.trim().length > 0
    const openAIResult = await openAIEmbed(text)
    if (openAIResult) {
      if (cacheKey) {
        this.setCachedEmbedding(cacheKey, openAIResult)
      }
      return openAIResult
    }
    providerFailures.push(openAiConfigured ? "openai unavailable" : "openai not configured")

    throw new EmbeddingUnavailableError(providerFailures.join("; "))
  }

  async save(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<string | null> {
    const id = randomUUID()
    const sanitizedUserId = sanitizeUserId(userId)

    try {
      if (!this.table) {
        throw new EmbeddingUnavailableError("vector store unavailable")
      }

      const vector = await this.embed(content)
      const row: MemoryRow = {
        id,
        userId: sanitizedUserId,
        content,
        vector,
        metadata: JSON.stringify(metadata),
        createdAt: Date.now(),
        utilityScore: 0.5,
      }

      await this.table.add([row])

      if (metadata.temporal !== false) {
        await this.persistKeywordMemory(userId, content, metadata, id)
      }

      log.debug("saved memory", { id, userId, contentLength: content.length })
      return id
    } catch (error) {
      const shouldPersistKeywordOnly =
        error instanceof EmbeddingUnavailableError
        || !this.table
        || metadata.temporal !== false

      if (!shouldPersistKeywordOnly) {
        log.error("failed to save memory", error)
        return null
      }

      try {
        await this.persistKeywordMemory(userId, content, {
          ...metadata,
          embeddingStatus: error instanceof EmbeddingUnavailableError ? "unavailable" : "skipped",
        }, id)
        log.warn("stored memory without vector embedding", {
          id,
          userId,
          reason: error instanceof EmbeddingUnavailableError ? error.reason : String(error),
        })
        return id
      } catch (keywordError) {
        log.error("failed to save memory to keyword path", { error, keywordError })
        return null
      }
    }
  }

  private async legacySearch(
    userId: string,
    queryVector: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.table || limit <= 0) {
      return []
    }

    const sanitizedUserId = sanitizeUserId(userId)

    const results = await this.table
      .vectorSearch(queryVector)
      .where(`userId = '${sanitizedUserId}'`)
      .limit(limit * 2)
      .toArray()

    const filtered = (results as MemoryRow[])
      .filter((row) => row.userId === sanitizedUserId && row.content !== "__init__")
      .slice(0, limit)

    return filtered.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: parseJsonSafe(row.metadata),
      score: 1,
    }))
  }

  async search(
    userId: string,
    query: string,
    limit = 5,
  ): Promise<SearchResult[]> {
    if (limit <= 0) {
      return []
    }

    let queryVector: number[] | null = null

    try {
      queryVector = await this.embed(query)
      if (!this.table) {
        throw new EmbeddingUnavailableError("vector store unavailable")
      }

      const memrlResults = await memrlUpdater.twoPhaseRetrieve(
        sanitizeUserId(userId),
        queryVector,
        limit,
        config.MEMRL_SIMILARITY_THRESHOLD,
      )

      if (memrlResults.length > 0) {
        return memrlResults
      }

      return await this.legacySearch(userId, queryVector, limit)
    } catch (error) {
      if (error instanceof EmbeddingUnavailableError) {
        log.warn("semantic memory search unavailable, degrading to keyword-only search", {
          userId,
          reason: error.reason,
        })
        return keywordMemory.searchMemoryNodeFTS(userId, query, limit)
      }

      try {
        if (queryVector && this.table) {
          return await this.legacySearch(userId, queryVector, limit)
        }
      } catch (fallbackError) {
        log.error("legacy search fallback failed", fallbackError)
      }

      log.error("search failed, degrading to keyword-only search", error)
      return keywordMemory.searchMemoryNodeFTS(userId, query, limit)
    }
  }

  async provideFeedback(feedback: TaskFeedback): Promise<void> {
    await memrlUpdater.updateFromFeedback(feedback)
  }

  async buildContext(
    userId: string,
    query: string,
    limit = 10
  ): Promise<BuildContextResult> {
    try {
      const retrievalLimit = Math.max(3, Math.min(8, Math.floor(limit / 2)))
      const [fused, adaptiveMemories] = await Promise.all([
        hiMeS.buildFusedContext(userId, query),
        this.search(userId, query, retrievalLimit),
      ])

      const systemBlocks: string[] = []
      const contextMessages: Array<{ role: "user" | "assistant"; content: string }> = []

      for (const item of fused) {
        if (item.role === "user" && item.content.startsWith("[")) {
          systemBlocks.push(item.content)
          continue
        }
        contextMessages.push(item)
      }

      if (adaptiveMemories.length > 0) {
        const memoryBlock = [
          "[Adaptive Memories]",
          ...adaptiveMemories.map((item, index) => `${index + 1}. ${item.content}`),
        ].join("\n")
        systemBlocks.push(memoryBlock)
      }

      if (contextMessages.length > limit) {
        contextMessages.splice(0, contextMessages.length - limit)
      }

      const validationInput: MemoryEntry[] = systemBlocks.map((content) => ({
        content,
        metadata: { source: "himes" },
      }))
      const validated = validateMemoryEntries(validationInput)
      const systemContext = validated.clean.map((item) => item.content).join("\n\n")
      const retrievedMemoryIds = Array.from(new Set(adaptiveMemories.map((item) => item.id)))

      // Register pending MemRL feedback (Fix 0.3)
      // Gateway will consume this on next user turn
      if (retrievedMemoryIds.length > 0) {
        this.registerPendingFeedback(userId, retrievedMemoryIds, 0.5) // provisional reward
      }

      return { systemContext, messages: contextMessages, retrievedMemoryIds }
    } catch (error) {
      log.error("buildContext failed", error)
      return { systemContext: "", messages: [], retrievedMemoryIds: [] }
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.table) {
      return false
    }

    try {
      const sanitizedId = id.replace(/'/g, "")
      await this.table.delete(`id = '${sanitizedId}'`)
      log.debug("memory entry deleted", { id })
      return true
    } catch (error) {
      log.error("failed to delete memory entry", error)
      return false
    }
  }

  async clear(userId: string): Promise<void> {
    if (!this.table) {
      return
    }

    try {
      const sanitizedUserId = sanitizeUserId(userId)
      await this.table.delete(`userId = '${sanitizedUserId}'`)
      log.info("memory cleared for user", { userId })
    } catch (error) {
      log.error("failed to clear memory", error)
    }
  }

  async compress(userId: string): Promise<void> {
    try {
      const messages = await getHistory(userId, 100)
      if (messages.length < 50) {
        return
      }

      const facts = await proMem.extract(userId, messages.slice(0, 50).reverse())
      if (facts.length === 0) {
        return
      }

      for (const fact of facts) {
        const metadata = {
          role: "system",
          compressed: true,
          source: "promem",
          category: "fact",
          level: 1,
          compressedAt: Date.now(),
        }
        await this.save(userId, fact, metadata)
        await saveMessage(userId, "system", fact, "memory", metadata)
      }

      log.info("compressed history with promem", { userId, count: messages.length, facts: facts.length })
    } catch (error) {
      log.error("compress failed", error)
    }
  }

  // ============== MemRL Feedback Side-Channel (Fix 0.3) ==============

  /** Pending feedback data per userId, set after each retrieval. */
  private readonly pendingFeedback = new Map<string, {
    retrievedIds: string[]
    provisionalReward: number
    timestamp: number
  }>()

  private pruneStalePendingFeedback(now = Date.now()): void {
    for (const [userId, entry] of this.pendingFeedback) {
      if (now - entry.timestamp > PENDING_FEEDBACK_MAX_AGE_MS) {
        this.pendingFeedback.delete(userId)
      }
    }
  }

  /**
   * Called internally after each retrieve() to register pending feedback.
   * Gateway/pipeline calls consumePendingFeedback() on next turn.
   */
  registerPendingFeedback(userId: string, retrievedIds: string[], provisionalReward: number): void {
    this.pruneStalePendingFeedback()
    this.pendingFeedback.set(userId, {
      retrievedIds,
      provisionalReward,
      timestamp: Date.now(),
    })
  }

  /**
   * Consume and clear pending feedback for a user.
   * Returns null if no pending feedback exists.
   */
  consumePendingFeedback(userId: string): { retrievedIds: string[]; provisionalReward: number; timestamp: number } | null {
    this.pruneStalePendingFeedback()
    const data = this.pendingFeedback.get(userId) ?? null
    this.pendingFeedback.delete(userId)

    if (data && Date.now() - data.timestamp > PENDING_FEEDBACK_MAX_AGE_MS) {
      return null
    }

    return data
  }

  /**
   * Clear feedback for a user (call on disconnect/cleanup).
   */
  clearFeedback(userId: string): void {
    this.pendingFeedback.delete(userId)
  }

  clearAllFeedback(): void {
    this.pendingFeedback.clear()
  }
}

export const memory = new MemoryStore()

export const __memoryStoreTestUtils = {
  EmbeddingUnavailableError,
}
