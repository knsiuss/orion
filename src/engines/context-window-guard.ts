/**
 * @file context-window-guard.ts
 * @description Evaluates whether a model's context window is adequate for a task
 *              and provides token budget information for safe prompt construction.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Consumed by orchestrator.ts during engine selection to filter out models with
 *   insufficient context windows. Also used by system-prompt-builder.ts to calculate
 *   available tokens for conversation history.
 *
 *   Inspired by OpenClaw's context-window.ts:
 *   - Multi-source context window resolution (model catalog → config override → default)
 *   - Hard minimum check (blocks models below 16k)
 *   - Warning threshold for models below 32k
 *   - Lazy caching of resolved context info per model
 *
 * PAPER BASIS:
 *   - Context window overflow is a leading cause of hallucination in LLMs.
 *     Proactive budgeting prevents truncation artifacts.
 */

import { createLogger } from "../logger.js"
import { ENGINE_MODEL_CATALOG, type ModelInfo } from "./model-preferences.js"

const log = createLogger("engines.context-window-guard")

/** Absolute minimum tokens a model must support to be usable. */
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000

/** Models below this threshold trigger a warning. */
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000

/** Where the context window value was resolved from. */
export type ContextWindowSource = "modelCatalog" | "configOverride" | "default"

/** Resolved context window information for a model. */
export interface ContextWindowInfo {
  /** Context window size in tokens. */
  tokens: number
  /** Where this value came from. */
  source: ContextWindowSource
}

/** Guard evaluation result. */
export interface ContextWindowGuardResult extends ContextWindowInfo {
  /** True if below the warning threshold but above hard minimum. */
  shouldWarn: boolean
  /** True if below the hard minimum — model should not be used. */
  shouldBlock: boolean
  /** Available tokens after reserving space for system prompt (+safety margin). */
  availableForHistory: number
}

/** Cache of resolved context window info per "engine:model" key. */
const resolvedCache = new Map<string, ContextWindowInfo>()

/**
 * Resolve the context window for a given engine/model combination.
 *
 * Resolution order:
 * 1. Config override (if provided via overrideTokens)
 * 2. MODEL_CATALOG modelInfo.contextWindow
 * 3. Default fallback (128_000)
 *
 * @param engine - Engine name (e.g. "anthropic", "openai")
 * @param modelId - Model identifier
 * @param overrideTokens - Optional config-level override
 * @returns Resolved context window info
 */
export function resolveContextWindow(
  engine: string,
  modelId: string,
  overrideTokens?: number,
): ContextWindowInfo {
  const cacheKey = `${engine}:${modelId}`

  // Config override always wins and is not cached (may change at runtime)
  if (typeof overrideTokens === "number" && overrideTokens > 0) {
    return { tokens: Math.floor(overrideTokens), source: "configOverride" }
  }

  const cached = resolvedCache.get(cacheKey)
  if (cached) return cached

  // Look up from model catalog
  const catalogEntry = ENGINE_MODEL_CATALOG[engine]
  const modelInfo: ModelInfo | undefined = catalogEntry?.modelInfo?.[modelId]

  if (modelInfo && modelInfo.contextWindow > 0) {
    const info: ContextWindowInfo = { tokens: modelInfo.contextWindow, source: "modelCatalog" }
    resolvedCache.set(cacheKey, info)
    return info
  }

  // Default fallback
  const info: ContextWindowInfo = { tokens: 128_000, source: "default" }
  resolvedCache.set(cacheKey, info)
  return info
}

/**
 * Evaluate whether a model's context window meets the requirements.
 *
 * @param info - Resolved context window info
 * @param systemPromptTokens - Estimated tokens used by system prompt (default: 2000)
 * @param safetyMarginPercent - Percentage of total to reserve as safety margin (default: 10)
 * @returns Guard result with shouldWarn/shouldBlock flags
 */
export function evaluateContextWindowGuard(
  info: ContextWindowInfo,
  systemPromptTokens = 2000,
  safetyMarginPercent = 10,
): ContextWindowGuardResult {
  const tokens = Math.max(0, Math.floor(info.tokens))
  const safetyReserve = Math.ceil(tokens * (safetyMarginPercent / 100))
  const availableForHistory = Math.max(0, tokens - systemPromptTokens - safetyReserve)

  const shouldWarn = tokens > 0 && tokens < CONTEXT_WINDOW_WARN_BELOW_TOKENS
  const shouldBlock = tokens > 0 && tokens < CONTEXT_WINDOW_HARD_MIN_TOKENS

  if (shouldBlock) {
    log.warn("Model context window below hard minimum", {
      tokens,
      hardMin: CONTEXT_WINDOW_HARD_MIN_TOKENS,
      source: info.source,
    })
  } else if (shouldWarn) {
    log.debug("Model context window below warning threshold", {
      tokens,
      warnBelow: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
      source: info.source,
    })
  }

  return {
    ...info,
    tokens,
    shouldWarn,
    shouldBlock,
    availableForHistory,
  }
}

/**
 * Quick check: resolve + evaluate in one call.
 * @returns Guard result for the given model
 */
export function checkContextWindow(
  engine: string,
  modelId: string,
  opts?: {
    overrideTokens?: number
    systemPromptTokens?: number
    safetyMarginPercent?: number
  },
): ContextWindowGuardResult {
  const info = resolveContextWindow(engine, modelId, opts?.overrideTokens)
  return evaluateContextWindowGuard(info, opts?.systemPromptTokens, opts?.safetyMarginPercent)
}

/**
 * Clear the context window resolution cache.
 * Call this if the model catalog is updated at runtime.
 */
export function clearContextWindowCache(): void {
  resolvedCache.clear()
}
