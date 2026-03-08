/**
 * memory-node-fts.ts - Managed SQLite FTS5 support for MemoryNode.
 *
 * Owns the keyword-search path for MemoryNode-backed memories:
 * - ensures the FTS5 virtual table exists and is wired to MemoryNode,
 * - rebuilds the index when migrating from the legacy plain table,
 * - provides an honest keyword-only search path when embeddings are unavailable.
 *
 * This module is intentionally independent from LanceDB so the system can
 * degrade to lexical retrieval without polluting vector space.
 *
 * @module memory/memory-node-fts
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { parseJsonSafe } from "../utils/index.js"

const log = createLogger("memory.memory-node-fts")

interface SqliteMasterRow {
  type: string
  sql: string | null
}

export interface MemoryNodeKeywordResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

const SHORT_TECHNICAL_TOKENS = new Set([
  "ai",
  "db",
  "go",
  "io",
  "js",
  "ml",
  "qa",
  "ts",
  "ui",
  "ux",
])

const FTS_TRIGGER_NAMES = [
  "MemoryNodeFTS_ai",
  "MemoryNodeFTS_ad",
  "MemoryNodeFTS_au",
] as const

let ensureReadyPromise: Promise<void> | null = null
let isReady = false

function tokenizeKeywordQuery(query: string): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const rawToken of query.match(/[a-zA-Z0-9_]+/g) ?? []) {
    const token = rawToken.trim().toLowerCase()
    if (!token) {
      continue
    }

    const allowShort = token.length >= 2 && SHORT_TECHNICAL_TOKENS.has(token)
    if (token.length <= 2 && !allowShort) {
      continue
    }

    if (seen.has(token)) {
      continue
    }

    seen.add(token)
    deduped.push(token)

    if (deduped.length >= 8) {
      break
    }
  }

  return deduped
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value) {
    return {}
  }

  if (typeof value === "string") {
    return parseJsonSafe(value)
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

function isManagedFTSTableDefinition(sql: string | null): boolean {
  if (typeof sql !== "string") {
    return false
  }

  const normalized = sql.toLowerCase()
  return normalized.includes("create virtual table")
    && normalized.includes("fts5")
    && normalized.includes("content='memorynode'")
}

async function keywordContainsFallback(
  userId: string,
  query: string,
  limit: number,
): Promise<MemoryNodeKeywordResult[]> {
  const tokens = tokenizeKeywordQuery(query)
  const trimmed = query.trim()
  if (!trimmed && tokens.length === 0) {
    return []
  }

  const results = await prisma.memoryNode.findMany({
    where: {
      userId,
      validUntil: null,
      OR: [
        ...(trimmed ? [{ content: { contains: trimmed } }] : []),
        ...tokens.map((token) => ({ content: { contains: token } })),
      ],
    },
    orderBy: { validFrom: "desc" },
    take: Math.max(1, Math.floor(limit)),
  })

  return results.map((row, index) => ({
    id: row.id,
    content: row.content,
    metadata: normalizeMetadata(row.metadata),
    score: 1 / (index + 1),
  }))
}

async function dropLegacyFTSArtifacts(): Promise<void> {
  for (const triggerName of FTS_TRIGGER_NAMES) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "MemoryNodeFTS"`)
}

async function createManagedFTSTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE "MemoryNodeFTS"
    USING fts5(content, content='MemoryNode', content_rowid='rowid')
  `)
}

async function ensureManagedFTSTriggers(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "MemoryNodeFTS_ai"
    AFTER INSERT ON "MemoryNode"
    BEGIN
      INSERT INTO "MemoryNodeFTS"(rowid, content)
      VALUES (new.rowid, new.content);
    END
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "MemoryNodeFTS_ad"
    AFTER DELETE ON "MemoryNode"
    BEGIN
      INSERT INTO "MemoryNodeFTS"("MemoryNodeFTS", rowid, content)
      VALUES ('delete', old.rowid, old.content);
    END
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "MemoryNodeFTS_au"
    AFTER UPDATE ON "MemoryNode"
    BEGIN
      INSERT INTO "MemoryNodeFTS"("MemoryNodeFTS", rowid, content)
      VALUES ('delete', old.rowid, old.content);
      INSERT INTO "MemoryNodeFTS"(rowid, content)
      VALUES (new.rowid, new.content);
    END
  `)
}

/**
 * Ensure MemoryNode keyword retrieval uses a managed FTS5 virtual table.
 *
 * This repairs older installs that still have a plain MemoryNodeFTS table and
 * makes trigger-based sync explicit instead of relying on migration comments.
 */
export async function ensureMemoryNodeFTSReady(): Promise<void> {
  if (isReady) {
    return
  }

  if (!ensureReadyPromise) {
    ensureReadyPromise = (async () => {
      const existing = await prisma.$queryRaw<Array<SqliteMasterRow>>`
        SELECT type, sql
        FROM sqlite_master
        WHERE name = 'MemoryNodeFTS'
        LIMIT 1
      `

      const definition = existing[0] ?? null
      if (!definition || !isManagedFTSTableDefinition(definition.sql)) {
        await dropLegacyFTSArtifacts()
        await createManagedFTSTable()
        await ensureManagedFTSTriggers()
        log.info("recreated MemoryNodeFTS as managed FTS5 virtual table")
      } else {
        await ensureManagedFTSTriggers()
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MemoryNodeFTS"("MemoryNodeFTS")
        VALUES ('rebuild')
      `)

      isReady = true
    })().finally(() => {
      ensureReadyPromise = null
    })
  }

  await ensureReadyPromise
}

/**
 * Build a sanitized FTS5 prefix query for MemoryNode search.
 *
 * @param query - Raw user query text.
 * @returns FTS5-safe prefix query string.
 */
export function buildMemoryNodeFTSQuery(query: string): string {
  return tokenizeKeywordQuery(query).map((token) => `${token}*`).join(" ")
}

/**
 * Search MemoryNode through the managed keyword path.
 *
 * Uses FTS5 when available and falls back to a direct SQLite contains query if
 * the host SQLite build cannot create the virtual table.
 *
 * @param userId - User identifier.
 * @param query - Raw text query.
 * @param limit - Maximum number of results.
 * @returns Keyword-ranked results.
 */
export async function searchMemoryNodeFTS(
  userId: string,
  query: string,
  limit: number,
): Promise<MemoryNodeKeywordResult[]> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const ftsQuery = buildMemoryNodeFTSQuery(query)

  if (!ftsQuery) {
    return keywordContainsFallback(userId, query, safeLimit)
  }

  try {
    await ensureMemoryNodeFTSReady()
    const results = await prisma.$queryRaw<Array<{
      id: string
      content: string
      metadata: unknown
      rank: number
    }>>`
      SELECT
        m.id,
        m.content,
        m.metadata,
        bm25("MemoryNodeFTS") AS rank
      FROM "MemoryNodeFTS"
      JOIN "MemoryNode" m ON m.rowid = "MemoryNodeFTS".rowid
      WHERE m.userId = ${userId}
        AND m.validUntil IS NULL
        AND "MemoryNodeFTS" MATCH ${ftsQuery}
      ORDER BY rank ASC
      LIMIT ${safeLimit}
    `

    return results.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: normalizeMetadata(row.metadata),
      score: 1 / (1 + Math.max(0, row.rank)),
    }))
  } catch (error) {
    log.warn("managed MemoryNode FTS unavailable, falling back to keyword contains search", { error })
    return keywordContainsFallback(userId, query, safeLimit)
  }
}

export const __memoryNodeFTSTestUtils = {
  SHORT_TECHNICAL_TOKENS: new Set(SHORT_TECHNICAL_TOKENS),
  buildMemoryNodeFTSQuery,
  resetState(): void {
    isReady = false
    ensureReadyPromise = null
  },
}
