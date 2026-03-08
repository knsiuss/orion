/**
 * @file errors.ts
 * @description Structured error system for EDITH — typed error codes, context propagation,
 * circuit breakers per provider, and auto-recovery strategies.
 *
 * ARCHITECTURE:
 *   All EDITH errors extend EdithError which carries: code, context, recovery hints.
 *   Circuit breaker prevents cascade failures per LLM provider.
 *   ErrorAggregator collects errors for alerting thresholds.
 *   Backward-compatible: preserves original EDITHError, SafetyBlockError, LLMError, etc.
 */
import { createLogger } from '../logger.js'

const log = createLogger('core.errors')

// ─── Original Error Classes (preserved for backward compatibility) ────────────

/**
 * Base class for all EDITH-specific errors.
 * Carries a structured `context` object for structured logging and
 * downstream error handling without parsing message strings.
 */
export class EDITHError extends Error {
  /** Stable string code that callers can switch on. Overridden by subclasses. */
  readonly code: string = 'EDITH_ERROR'

  /**
   * @param message - Human-readable description (English, lowercase).
   * @param context - Arbitrary key/value pairs for structured logging.
   */
  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when the safety filter (prompt-filter or output-scanner) blocks
 * a message or response. Callers should surface a neutral refusal message
 * to the user rather than the raw error.
 */
export class SafetyBlockError extends EDITHError {
  override readonly code = 'SAFETY_BLOCK'
}

/**
 * Thrown when the LLM orchestrator fails to produce a response after
 * exhausting all configured retries and fallback providers.
 */
export class LLMError extends EDITHError {
  override readonly code = 'LLM_ERROR'
}

/**
 * Thrown when a per-user or per-channel rate limit is exceeded.
 * Callers should respond with HTTP 429 (Too Many Requests) or an
 * equivalent channel-appropriate refusal.
 */
export class RateLimitError extends EDITHError {
  override readonly code = 'RATE_LIMIT'
}

/**
 * Thrown when a tool call or capability request is denied by the
 * CaMeL guard or the skill sandbox permission model.
 */
export class PermissionError extends EDITHError {
  override readonly code = 'PERMISSION_DENIED'
}

/**
 * Thrown when a memory operation (vector save/retrieve, Prisma write)
 * fails in a way that the caller cannot silently recover from.
 */
export class MemoryError extends EDITHError {
  override readonly code = 'MEMORY_ERROR'
}

// ─── New Structured Error System ──────────────────────────────────────────────

/** Structured error codes — machine-readable, never change existing values. */
export const ErrorCode = {
  // LLM Errors
  LLM_UNAVAILABLE: 'EDITH_LLM_001',
  LLM_QUOTA_EXCEEDED: 'EDITH_LLM_002',
  LLM_INVALID_RESPONSE: 'EDITH_LLM_003',
  LLM_TIMEOUT: 'EDITH_LLM_004',
  LLM_CIRCUIT_OPEN: 'EDITH_LLM_005',
  // Pipeline Errors
  PIPELINE_RATE_LIMITED: 'EDITH_PIPE_001',
  PIPELINE_BLOCKED_USER: 'EDITH_PIPE_002',
  PIPELINE_INVALID_INPUT: 'EDITH_PIPE_003',
  // Channel Errors
  CHANNEL_SEND_FAILED: 'EDITH_CH_001',
  CHANNEL_UNAVAILABLE: 'EDITH_CH_002',
  // Memory Errors
  MEMORY_WRITE_FAILED: 'EDITH_MEM_001',
  MEMORY_READ_FAILED: 'EDITH_MEM_002',
  // Security Errors
  SECURITY_PROMPT_INJECTION: 'EDITH_SEC_001',
  SECURITY_TAINT_VIOLATION: 'EDITH_SEC_002',
  SECURITY_UNAUTHORIZED: 'EDITH_SEC_003',
  // General
  INTERNAL_ERROR: 'EDITH_GEN_001',
  DEPENDENCY_UNAVAILABLE: 'EDITH_GEN_002',
  VALIDATION_FAILED: 'EDITH_GEN_003',
} as const

/** Union type of all error code values. */
export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode]

/** Recovery strategy hint for each error. */
export const ErrorRecovery: Record<ErrorCodeValue, string> = {
  [ErrorCode.LLM_UNAVAILABLE]: 'Try fallback engine or wait for provider recovery',
  [ErrorCode.LLM_QUOTA_EXCEEDED]: 'Rotate to next API key or wait for quota reset',
  [ErrorCode.LLM_INVALID_RESPONSE]: 'Retry with lower temperature or different model',
  [ErrorCode.LLM_TIMEOUT]: 'Retry with shorter prompt or faster model',
  [ErrorCode.LLM_CIRCUIT_OPEN]: 'Circuit breaker open — using fallback engine',
  [ErrorCode.PIPELINE_RATE_LIMITED]: 'User sending too fast — apply backpressure',
  [ErrorCode.PIPELINE_BLOCKED_USER]: 'User is blocked by DM policy',
  [ErrorCode.PIPELINE_INVALID_INPUT]: 'Input failed validation — reject with user message',
  [ErrorCode.CHANNEL_SEND_FAILED]: 'Outbox will retry with exponential backoff',
  [ErrorCode.CHANNEL_UNAVAILABLE]: 'Channel offline — queue message in outbox',
  [ErrorCode.MEMORY_WRITE_FAILED]: 'Non-critical — log and continue without memory write',
  [ErrorCode.MEMORY_READ_FAILED]: 'Degrade gracefully — respond without memory context',
  [ErrorCode.SECURITY_PROMPT_INJECTION]: 'Block message and log to audit trail',
  [ErrorCode.SECURITY_TAINT_VIOLATION]: 'Abort operation and escalate to audit',
  [ErrorCode.SECURITY_UNAUTHORIZED]: 'Reject with 401 response',
  [ErrorCode.INTERNAL_ERROR]: 'Log stack trace and return safe error message to user',
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: 'Degrade gracefully without the dependency',
  [ErrorCode.VALIDATION_FAILED]: 'Return validation error to caller',
}

/** Base class for all structured EDITH errors with typed codes. */
export class EdithError extends Error {
  /** Typed error code for machine-readable discrimination. */
  readonly code: ErrorCodeValue
  /** Structured context for logging. */
  readonly context: Record<string, unknown>
  /** Recovery hint for this error type. */
  readonly recoveryHint: string
  /** When the error occurred. */
  readonly timestamp: Date
  /** Whether the operation can be retried. */
  readonly isRetryable: boolean

  constructor(
    code: ErrorCodeValue,
    message: string,
    context: Record<string, unknown> = {},
    isRetryable = false,
  ) {
    super(message)
    this.name = 'EdithError'
    this.code = code
    this.context = context
    this.recoveryHint = ErrorRecovery[code] ?? 'Check logs for details'
    this.timestamp = new Date()
    this.isRetryable = isRetryable
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** LLM-specific error with provider information. */
export class LlmError extends EdithError {
  /** The provider that failed (e.g. 'anthropic', 'groq'). */
  readonly provider: string

  constructor(
    code: ErrorCodeValue,
    message: string,
    provider: string,
    context: Record<string, unknown> = {},
  ) {
    const retryable = code === ErrorCode.LLM_TIMEOUT || code === ErrorCode.LLM_UNAVAILABLE
    super(code, message, { ...context, provider }, retryable)
    this.name = 'LlmError'
    this.provider = provider
  }
}

/** Security-specific error. Always non-retryable. */
export class SecurityError extends EdithError {
  constructor(code: ErrorCodeValue, message: string, context: Record<string, unknown> = {}) {
    super(code, message, context, false)
    this.name = 'SecurityError'
    log.warn('security error raised', { code, message, context })
  }
}

// ─── Circuit Breaker Registry ─────────────────────────────────────────────────

/** State of a single provider circuit breaker. */
interface BreakerState {
  /** Consecutive failure count. */
  failures: number
  /** Timestamp of last failure. */
  lastFailureAt: number
  /** Current breaker state. */
  state: 'closed' | 'open' | 'half-open'
  /** Timestamp when breaker was opened. */
  openedAt: number
}

/** Number of consecutive failures before breaker opens. */
const BREAKER_THRESHOLD = 5
/** Milliseconds before half-open probe is allowed. */
const BREAKER_RESET_MS = 60_000

/**
 * Per-provider circuit breaker registry — prevents cascade LLM failures.
 * Tracks failure counts per provider and opens the circuit when threshold is hit.
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, BreakerState>()

  /** Get or create breaker state for a provider. */
  private get(provider: string): BreakerState {
    if (!this.breakers.has(provider)) {
      this.breakers.set(provider, {
        failures: 0,
        lastFailureAt: 0,
        state: 'closed',
        openedAt: 0,
      })
    }
    return this.breakers.get(provider)!
  }

  /**
   * Check if a provider's circuit is open (should not call).
   * @param provider - LLM provider name
   * @returns True if circuit is open and calls should be blocked
   */
  isOpen(provider: string): boolean {
    const b = this.get(provider)
    if (b.state === 'closed') return false
    if (b.state === 'open') {
      if (Date.now() - b.openedAt > BREAKER_RESET_MS) {
        b.state = 'half-open'
        log.info('circuit breaker half-open', { provider })
        return false
      }
      return true
    }
    return false // half-open: allow one test request
  }

  /**
   * Record a successful call — close the breaker if half-open.
   * @param provider - LLM provider name
   */
  recordSuccess(provider: string): void {
    const b = this.get(provider)
    if (b.state === 'half-open') {
      b.state = 'closed'
      b.failures = 0
      log.info('circuit breaker closed after recovery', { provider })
    }
  }

  /**
   * Record a failure — open the breaker after threshold.
   * @param provider - LLM provider name
   */
  recordFailure(provider: string): void {
    const b = this.get(provider)
    b.failures++
    b.lastFailureAt = Date.now()
    if (b.failures >= BREAKER_THRESHOLD && b.state === 'closed') {
      b.state = 'open'
      b.openedAt = Date.now()
      log.warn('circuit breaker OPENED', { provider, failures: b.failures })
    }
  }

  /**
   * Get all breaker states — used by /health endpoint.
   * @returns Map of provider name to breaker state
   */
  getAll(): Record<string, BreakerState> {
    return Object.fromEntries(this.breakers)
  }
}

/** Singleton circuit breaker registry for all LLM providers. */
export const circuitBreakerRegistry = new CircuitBreakerRegistry()

// ─── Error Aggregator ─────────────────────────────────────────────────────────

/** Running tally for a single error code. */
interface ErrorTally {
  /** Total occurrence count since last reset. */
  count: number
  /** When this error was last seen. */
  lastSeen: Date
  /** Sample message for diagnostics. */
  sample: string
}

/**
 * Tracks error frequency for alerting thresholds.
 * Call reset() hourly to prevent unbounded growth.
 */
class ErrorAggregator {
  private tallies = new Map<ErrorCodeValue, ErrorTally>()

  /**
   * Record an error occurrence.
   * @param error - The EdithError to record
   */
  record(error: EdithError): void {
    const existing = this.tallies.get(error.code)
    if (existing) {
      existing.count++
      existing.lastSeen = new Date()
    } else {
      this.tallies.set(error.code, {
        count: 1,
        lastSeen: new Date(),
        sample: error.message,
      })
    }
  }

  /**
   * Get errors above a frequency threshold in the given window.
   * @param minCount - Minimum occurrences to include
   * @param windowMs - Time window in milliseconds (default: 5 minutes)
   * @returns Array of frequent error entries
   */
  getFrequent(
    minCount: number,
    windowMs = 5 * 60 * 1000,
  ): Array<{ code: ErrorCodeValue; count: number; sample: string }> {
    const cutoff = Date.now() - windowMs
    return [...this.tallies.entries()]
      .filter(([, t]) => t.count >= minCount && t.lastSeen.getTime() > cutoff)
      .map(([code, t]) => ({ code, count: t.count, sample: t.sample }))
  }

  /** Reset all tallies (call hourly). */
  reset(): void {
    this.tallies.clear()
  }
}

/** Singleton error aggregator for frequency-based alerting. */
export const errorAggregator = new ErrorAggregator()
