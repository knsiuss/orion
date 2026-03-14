/**
 * @file key-normalizer.ts
 * @description Input normalization and multi-format key resolution for delegation chains.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Ported from OpenClaw's subagent-depth.ts normalizeSpawnDepth / normalizeSessionKey /
 *   buildKeyCandidates / findEntryBySessionId patterns.
 *   Used by DurableDepthStore and DepthGuard to sanitize task IDs, depths, and instance IDs
 *   before storage or lookup — prevents mismatches from whitespace, type coercion, etc.
 *
 * PAPER BASIS:
 *   - Defensive input normalization pattern from OpenClaw session-key-utils
 */

import { createLogger } from "../../logger.js"

const log = createLogger("legion.key-normalizer")

/**
 * Normalize an unknown depth value into a valid non-negative integer.
 * Handles number, string, undefined, null, and garbage input gracefully.
 *
 * @param value - Raw depth value (could be anything from external input)
 * @returns Validated integer >= 0, or undefined if unrecoverable
 */
export function normalizeDepth(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined
  }
  return undefined
}

/**
 * Normalize a task ID or instance ID — trims whitespace, lowercases, rejects empty.
 *
 * @param value - Raw key value
 * @returns Normalized key string, or undefined if empty/invalid
 */
export function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed || undefined
}

/**
 * Build candidate lookup keys from a raw task ID.
 * Generates prefix variants so cross-format lookups succeed.
 *
 * Candidate order:
 *   1. Raw key (normalized)
 *   2. "legion:{instanceId}:{rawKey}" — instance-scoped variant
 *   3. "task:{rawKey}" — generic task prefix
 *
 * @param rawKey    - The raw task ID
 * @param instanceId - Optional instance ID for scoped lookups
 * @returns Array of candidate keys to try in order
 */
export function buildKeyCandidates(rawKey: string, instanceId?: string): string[] {
  const normalized = normalizeKey(rawKey)
  if (!normalized) return []

  // Skip prefix building for already-prefixed keys
  if (normalized.startsWith("legion:") || normalized.startsWith("task:")) {
    return [normalized]
  }

  const candidates = [normalized]
  if (instanceId) {
    const normInstance = normalizeKey(instanceId)
    if (normInstance) {
      candidates.push(`legion:${normInstance}:${normalized}`)
    }
  }
  candidates.push(`task:${normalized}`)
  return candidates
}

/**
 * Infer depth from the structure of a key by counting delegation segments.
 * Fallback when no metadata is available (OpenClaw's getSubagentDepth pattern).
 *
 * Convention: each ":delegate:" or ":spawn:" segment implies +1 depth.
 *
 * @param key - Task or session key
 * @returns Inferred depth based on segment counting
 */
export function inferDepthFromSegments(key: string): number {
  const normalized = normalizeKey(key)
  if (!normalized) return 0

  const delegateSegments = normalized.split(":delegate:").length - 1
  const spawnSegments = normalized.split(":spawn:").length - 1
  return delegateSegments + spawnSegments
}

/**
 * Validate and normalize the full set of chain start parameters.
 * Logs warnings for any coerced or rejected values.
 *
 * @returns Normalized parameters or null if validation fails
 */
export function normalizeChainParams(params: {
  taskId: unknown
  instanceId: unknown
  spawnedBy?: unknown
  timeoutMs?: unknown
}): {
  taskId: string
  instanceId: string
  spawnedBy: string | undefined
  timeoutMs: number | undefined
} | null {
  const taskId = normalizeKey(params.taskId)
  if (!taskId) {
    log.warn("chain params rejected — invalid taskId", { raw: params.taskId })
    return null
  }

  const instanceId = normalizeKey(params.instanceId)
  if (!instanceId) {
    log.warn("chain params rejected — invalid instanceId", { raw: params.instanceId })
    return null
  }

  const spawnedBy = params.spawnedBy !== undefined ? normalizeKey(params.spawnedBy) : undefined
  const timeoutMs = params.timeoutMs !== undefined ? normalizeDepth(params.timeoutMs) : undefined

  return { taskId, instanceId, spawnedBy, timeoutMs }
}
