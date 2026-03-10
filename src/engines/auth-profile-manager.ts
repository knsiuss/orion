/**
 * @file auth-profile-manager.ts
 * @description API key rotation and cooldown management for LLM provider engines.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Inspired by OpenClaw's auth-profiles system. Manages multiple API keys per provider
 *   with cooldown tracking, failure reason classification, and smart probe throttling.
 *   Used by orchestrator.ts to select the best available key before each LLM call.
 *
 * PAPER BASIS:
 *   - Adaptive load balancing with cooldown-aware rotation (industry pattern)
 */

import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("engines.auth-profile-manager")

/** Minimum interval between probing a cooled-down key (30s). */
const MIN_PROBE_INTERVAL_MS = 30_000

/** Cooldown durations by failure reason. */
const COOLDOWN_DURATION_MS: Readonly<Record<AuthFailureReason, number>> = {
  rate_limit: 60_000,
  auth: 300_000,
  auth_permanent: Infinity,
  billing: 600_000,
  overloaded: 120_000,
  unknown: 90_000,
}

/** Why an API key was put on cooldown. */
export type AuthFailureReason =
  | "rate_limit"
  | "auth"
  | "auth_permanent"
  | "billing"
  | "overloaded"
  | "unknown"

/** Tracked state for a single API key. */
interface KeyProfile {
  /** The obfuscated key identifier for logging (last 4 chars). */
  keyHint: string
  /** The actual API key value. */
  key: string
  /** Provider name (e.g., "anthropic", "openai"). */
  provider: string
  /** Cooldown expiry timestamp, or 0 if not cooled down. */
  cooldownUntil: number
  /** Why the key is on cooldown (null if active). */
  cooldownReason: AuthFailureReason | null
  /** Last time we probed this key during cooldown. */
  lastProbeAt: number
  /** Cumulative successful calls. */
  successCount: number
  /** Cumulative failed calls. */
  failureCount: number
  /** Whether the key was last used successfully. */
  lastGood: boolean
}

/**
 * Classifies an engine error into an AuthFailureReason for cooldown duration lookup.
 * @param error - The error thrown by an engine call
 * @returns Classified failure reason
 */
export function classifyFailureReason(error: unknown): AuthFailureReason {
  const status = extractStatusCode(error)
  const message = extractMessage(error)

  if (status === 401 || status === 403 || message.includes("invalid api key") || message.includes("invalid_api_key")) {
    return message.includes("permanently") ? "auth_permanent" : "auth"
  }
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return "rate_limit"
  }
  if (status === 402 || message.includes("billing") || message.includes("insufficient") || message.includes("quota")) {
    return "billing"
  }
  if (status === 503 || status === 529 || message.includes("overloaded")) {
    return "overloaded"
  }
  return "unknown"
}

function extractStatusCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status
    return typeof status === "number" ? status : null
  }
  return null
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase()
  return String(error).toLowerCase()
}

/**
 * Manages multiple API keys per provider with cooldown-aware rotation.
 * Provides the best available key for each request and tracks failures.
 */
export class AuthProfileManager {
  private readonly profiles = new Map<string, KeyProfile[]>()

  /** Initialize profiles from config. Call during startup. */
  init(): void {
    this.profiles.clear()
    this.loadProviderKeys("anthropic", config.ANTHROPIC_API_KEY, config.ANTHROPIC_API_KEYS)
    this.loadProviderKeys("openai", config.OPENAI_API_KEY, config.OPENAI_API_KEYS)
    this.loadProviderKeys("gemini", config.GEMINI_API_KEY, config.GEMINI_API_KEYS)
    this.loadProviderKeys("groq", config.GROQ_API_KEY)
    this.loadProviderKeys("openrouter", config.OPENROUTER_API_KEY)
    this.loadProviderKeys("deepseek", config.DEEPSEEK_API_KEY)
    this.loadProviderKeys("mistral", config.MISTRAL_API_KEY)
    this.loadProviderKeys("together", config.TOGETHER_API_KEY)
    this.loadProviderKeys("fireworks", config.FIREWORKS_API_KEY)
    this.loadProviderKeys("cohere", config.COHERE_API_KEY)

    let total = 0
    for (const [provider, keys] of this.profiles) {
      if (keys.length > 0) {
        total += keys.length
        log.info("auth profiles loaded", { provider, keyCount: keys.length })
      }
    }
    log.info("auth profile manager initialized", { totalKeys: total })
  }

  /**
   * Get the best available API key for a provider.
   * Returns null if all keys are on permanent cooldown.
   *
   * @param provider - Engine provider name (e.g., "anthropic")
   * @returns The best available key, or null if none available
   */
  getBestKey(provider: string): string | null {
    const keys = this.profiles.get(provider)
    if (!keys || keys.length === 0) return null

    const now = Date.now()

    // 1. Prefer active (non-cooled-down) keys, sorted by success rate
    const active = keys.filter((k) => k.cooldownUntil <= now)
    if (active.length > 0) {
      active.sort((a, b) => {
        if (a.lastGood !== b.lastGood) return a.lastGood ? -1 : 1
        return b.successCount - a.successCount
      })
      return active[0].key
    }

    // 2. All keys on cooldown — probe the one with soonest expiry (if probe interval elapsed)
    const probeable = keys
      .filter((k) => k.cooldownReason !== "auth_permanent")
      .filter((k) => now - k.lastProbeAt >= MIN_PROBE_INTERVAL_MS)
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil)

    if (probeable.length > 0) {
      probeable[0].lastProbeAt = now
      log.debug("probing cooled-down key", {
        provider,
        keyHint: probeable[0].keyHint,
        reason: probeable[0].cooldownReason,
      })
      return probeable[0].key
    }

    // 3. All permanently blocked or recently probed
    log.warn("no available keys for provider", { provider })
    return null
  }

  /**
   * Report a successful call for a key.
   * Clears any active cooldown.
   *
   * @param provider - Engine provider name
   * @param key      - The API key that succeeded
   */
  markSuccess(provider: string, key: string): void {
    const profile = this.findProfile(provider, key)
    if (!profile) return

    profile.successCount++
    profile.lastGood = true
    profile.cooldownUntil = 0
    profile.cooldownReason = null
  }

  /**
   * Report a failed call and apply cooldown based on error classification.
   *
   * @param provider - Engine provider name
   * @param key      - The API key that failed
   * @param error    - The error to classify
   */
  markFailure(provider: string, key: string, error: unknown): void {
    const reason = classifyFailureReason(error)
    const profile = this.findProfile(provider, key)
    if (!profile) return

    const duration = COOLDOWN_DURATION_MS[reason]
    profile.failureCount++
    profile.lastGood = false
    profile.cooldownReason = reason
    profile.cooldownUntil = duration === Infinity ? Infinity : Date.now() + duration

    log.warn("key put on cooldown", {
      provider,
      keyHint: profile.keyHint,
      reason,
      cooldownMs: duration === Infinity ? "permanent" : duration,
    })
  }

  /**
   * Check if a provider has any usable keys (not all permanently blocked).
   * @param provider - Engine provider name
   */
  hasUsableKeys(provider: string): boolean {
    const keys = this.profiles.get(provider)
    if (!keys || keys.length === 0) return false
    return keys.some((k) => k.cooldownReason !== "auth_permanent")
  }

  /**
   * Get diagnostics for all profiles of a provider.
   * @param provider - Engine provider name
   */
  getProfileDiagnostics(provider: string): Array<{
    keyHint: string
    cooldownReason: AuthFailureReason | null
    cooldownUntil: number
    successCount: number
    failureCount: number
    lastGood: boolean
  }> {
    const keys = this.profiles.get(provider) ?? []
    return keys.map((k) => ({
      keyHint: k.keyHint,
      cooldownReason: k.cooldownReason,
      cooldownUntil: k.cooldownUntil,
      successCount: k.successCount,
      failureCount: k.failureCount,
      lastGood: k.lastGood,
    }))
  }

  private loadProviderKeys(provider: string, primaryKey: string, multiKeys?: string): void {
    const keys: string[] = []

    if (primaryKey.trim()) {
      keys.push(primaryKey.trim())
    }

    if (multiKeys?.trim()) {
      for (const k of multiKeys.split(",")) {
        const trimmed = k.trim()
        if (trimmed && !keys.includes(trimmed)) {
          keys.push(trimmed)
        }
      }
    }

    if (keys.length > 0) {
      this.profiles.set(
        provider,
        keys.map((key) => ({
          keyHint: key.slice(-4),
          key,
          provider,
          cooldownUntil: 0,
          cooldownReason: null,
          lastProbeAt: 0,
          successCount: 0,
          failureCount: 0,
          lastGood: true,
        })),
      )
    }
  }

  private findProfile(provider: string, key: string): KeyProfile | undefined {
    return this.profiles.get(provider)?.find((k) => k.key === key)
  }
}

export const authProfileManager = new AuthProfileManager()
