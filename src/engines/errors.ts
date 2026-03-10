/**
 * @file errors.ts
 * @description Typed error classes for LLM engine failures.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Thrown by engine implementations (anthropic.ts, groq.ts, gemini.ts, openai.ts,
 *   openrouter.ts, ollama.ts) instead of silently returning empty strings.
 *   The Orchestrator (orchestrator.ts) catches these in its retry/circuit-breaker
 *   logic via `isRetryableEngineError()`, enabling accurate failure classification.
 *
 *   Error hierarchy:
 *     EngineError                  ← base class (all engine errors)
 *       ├── EngineRateLimitError   ← HTTP 429 / "rate limit" messages
 *       ├── EngineAuthError        ← HTTP 401/403 / bad API key
 *       ├── EngineTimeoutError     ← request exceeded ENGINE_TIMEOUT_MS
 *       ├── EngineUnavailableError ← HTTP 500/502/503/504
 *       └── EngineEmptyResponseError ← non-error HTTP but empty content
 *
 * @module engines/errors
 */

/**
 * Base class for all engine-level errors.
 * Orchestrator catches EngineError (and subclasses) for retry/circuit-breaker logic.
 */
export class EngineError extends Error {
  constructor(
    /** The engine name (e.g. "anthropic", "groq") for context in logs. */
    public readonly engineName: string,
    message: string,
    /** Original SDK/fetch error that caused this, if any. */
    public readonly cause?: unknown,
  ) {
    super(`[${engineName}] ${message}`)
    this.name = "EngineError"
  }
}

/**
 * Thrown when the provider returns HTTP 429 or a rate-limit message.
 * Orchestrator applies exponential backoff and tries the next provider.
 */
export class EngineRateLimitError extends EngineError {
  constructor(engineName: string, cause?: unknown) {
    super(engineName, "Rate limit exceeded — try again later or switch provider", cause)
    this.name = "EngineRateLimitError"
  }
}

/**
 * Thrown when API authentication fails (HTTP 401 or 403).
 * Orchestrator should skip this engine entirely — retrying will not help.
 */
export class EngineAuthError extends EngineError {
  constructor(engineName: string, cause?: unknown) {
    super(engineName, "Authentication failed — check API key configuration", cause)
    this.name = "EngineAuthError"
  }
}

/**
 * Thrown when the engine request exceeds the configured timeout.
 * Orchestrator may retry once before falling back to the next provider.
 */
export class EngineTimeoutError extends EngineError {
  constructor(engineName: string, cause?: unknown) {
    super(engineName, "Request timed out — provider did not respond in time", cause)
    this.name = "EngineTimeoutError"
  }
}

/**
 * Thrown when the provider returns a 5xx status code (service unavailable).
 * Orchestrator retries with backoff; circuit breaker tracks consecutive failures.
 *
 * @param statusCode - The HTTP status code received, if available.
 */
export class EngineUnavailableError extends EngineError {
  constructor(engineName: string, statusCode?: number, cause?: unknown) {
    const detail = statusCode != null ? ` (HTTP ${statusCode})` : ""
    super(engineName, `Service temporarily unavailable${detail}`, cause)
    this.name = "EngineUnavailableError"
  }
}

/**
 * Thrown when the engine returns a successful HTTP response but with empty text content.
 * Orchestrator treats this as a soft failure and tries the next engine in the chain.
 */
export class EngineEmptyResponseError extends EngineError {
  constructor(engineName: string) {
    super(engineName, "Provider returned a successful response but with empty text content")
    this.name = "EngineEmptyResponseError"
  }
}

/**
 * Classify an arbitrary caught value (SDK error, fetch error, unknown) into a typed EngineError.
 *
 * Used inside engine `catch` blocks to translate vendor-specific SDK errors into
 * our typed hierarchy so the Orchestrator can make informed retry/fallback decisions.
 *
 * @param engineName - The name of the engine where the error occurred.
 * @param error      - The raw caught value from the SDK or fetch call.
 * @returns          A typed EngineError subclass with the original error preserved as `cause`.
 */
export function classifyEngineError(engineName: string, error: unknown): EngineError {
  // Already classified — pass through without double-wrapping.
  if (error instanceof EngineError) {
    return error
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  // Extract HTTP status code if present (Anthropic SDK, OpenAI SDK, Groq SDK all set `.status`).
  const status = extractHttpStatus(error)

  // Rate limit detection — HTTP 429 or message keywords.
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests") || message.includes("ratelimit")) {
    return new EngineRateLimitError(engineName, error)
  }

  // Auth failures — HTTP 401/403 or auth-related keywords.
  if (
    status === 401
    || status === 403
    || message.includes("unauthorized")
    || message.includes("authentication")
    || message.includes("invalid api key")
    || message.includes("api key")
    || message.includes("permission denied")
  ) {
    return new EngineAuthError(engineName, error)
  }

  // Timeout keywords (before 5xx check to avoid misclassifying timeout as unavailable).
  if (
    message.includes("timeout")
    || message.includes("timed out")
    || message.includes("etimedout")
    || message.includes("econnreset")
    || message.includes("aborted")
  ) {
    return new EngineTimeoutError(engineName, error)
  }

  // Server errors — HTTP 500/502/503/504.
  if (status != null && status >= 500 && status < 600) {
    return new EngineUnavailableError(engineName, status, error)
  }

  // Service unavailable keywords without status code.
  if (
    message.includes("service unavailable")
    || message.includes("bad gateway")
    || message.includes("gateway timeout")
    || message.includes("econnrefused")
    || message.includes("enotfound")
  ) {
    return new EngineUnavailableError(engineName, undefined, error)
  }

  // Fallback: generic engine error preserving original message.
  const originalMessage = error instanceof Error ? error.message : String(error)
  return new EngineError(engineName, originalMessage, error)
}

/**
 * Safely extract an HTTP status code from an unknown error object.
 * Works with Anthropic SDK, OpenAI SDK, Groq SDK, and raw fetch responses.
 *
 * @param error - The raw caught error value.
 * @returns The HTTP status code as a number, or null if not present.
 */
function extractHttpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null
  }

  const candidate = error as Record<string, unknown>

  if (typeof candidate.status === "number") {
    return candidate.status
  }

  // Some SDKs nest status under `.error.status` or `.response.status`.
  if (typeof candidate.error === "object" && candidate.error !== null) {
    const nested = candidate.error as Record<string, unknown>
    if (typeof nested.status === "number") {
      return nested.status
    }
  }

  if (typeof candidate.response === "object" && candidate.response !== null) {
    const nested = candidate.response as Record<string, unknown>
    if (typeof nested.status === "number") {
      return nested.status
    }
  }

  return null
}
