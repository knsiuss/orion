/**
 * @file errors.test.ts
 * @description Tests for structured error system — EdithError, circuit breakers, error aggregator.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  EdithError,
  LlmError,
  SecurityError,
  circuitBreakerRegistry,
  errorAggregator,
  ErrorCode,
  EDITHError,
  SafetyBlockError,
  LLMError,
  RateLimitError,
  PermissionError,
  MemoryError,
} from '../errors.js'

describe('EDITHError (legacy)', () => {
  it('has correct code', () => {
    const err = new EDITHError('test error')
    expect(err.code).toBe('EDITH_ERROR')
    expect(err.message).toBe('test error')
  })

  it('SafetyBlockError has SAFETY_BLOCK code', () => {
    const err = new SafetyBlockError('blocked')
    expect(err.code).toBe('SAFETY_BLOCK')
  })

  it('LLMError has LLM_ERROR code', () => {
    const err = new LLMError('llm failed')
    expect(err.code).toBe('LLM_ERROR')
  })

  it('RateLimitError has RATE_LIMIT code', () => {
    const err = new RateLimitError('rate limited')
    expect(err.code).toBe('RATE_LIMIT')
  })

  it('PermissionError has PERMISSION_DENIED code', () => {
    const err = new PermissionError('denied')
    expect(err.code).toBe('PERMISSION_DENIED')
  })

  it('MemoryError has MEMORY_ERROR code', () => {
    const err = new MemoryError('memory failed')
    expect(err.code).toBe('MEMORY_ERROR')
  })
})

describe('EdithError', () => {
  it('has correct code and recovery hint', () => {
    const err = new EdithError(ErrorCode.LLM_TIMEOUT, 'timed out', {}, true)
    expect(err.code).toBe(ErrorCode.LLM_TIMEOUT)
    expect(err.isRetryable).toBe(true)
    expect(err.recoveryHint).toBeTruthy()
    expect(err.recoveryHint).toContain('Retry')
  })

  it('has timestamp', () => {
    const before = Date.now()
    const err = new EdithError(ErrorCode.INTERNAL_ERROR, 'test')
    expect(err.timestamp).toBeInstanceOf(Date)
    expect(err.timestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('carries context', () => {
    const err = new EdithError(ErrorCode.INTERNAL_ERROR, 'test', { key: 'value' })
    expect(err.context).toEqual({ key: 'value' })
  })

  it('is not retryable by default', () => {
    const err = new EdithError(ErrorCode.VALIDATION_FAILED, 'invalid')
    expect(err.isRetryable).toBe(false)
  })
})

describe('LlmError', () => {
  it('carries provider', () => {
    const err = new LlmError(ErrorCode.LLM_UNAVAILABLE, 'down', 'anthropic')
    expect(err.provider).toBe('anthropic')
    expect(err.isRetryable).toBe(true)
  })

  it('LLM_TIMEOUT is retryable', () => {
    const err = new LlmError(ErrorCode.LLM_TIMEOUT, 'timeout', 'groq')
    expect(err.isRetryable).toBe(true)
  })

  it('LLM_QUOTA_EXCEEDED is not retryable', () => {
    const err = new LlmError(ErrorCode.LLM_QUOTA_EXCEEDED, 'quota', 'openai')
    expect(err.isRetryable).toBe(false)
  })

  it('includes provider in context', () => {
    const err = new LlmError(ErrorCode.LLM_INVALID_RESPONSE, 'bad response', 'gemini')
    expect(err.context.provider).toBe('gemini')
  })
})

describe('SecurityError', () => {
  it('is never retryable', () => {
    const err = new SecurityError(ErrorCode.SECURITY_UNAUTHORIZED, 'blocked')
    expect(err.isRetryable).toBe(false)
  })

  it('has correct name', () => {
    const err = new SecurityError(ErrorCode.SECURITY_PROMPT_INJECTION, 'injection')
    expect(err.name).toBe('SecurityError')
  })
})

describe('CircuitBreakerRegistry', () => {
  it('starts closed for new provider', () => {
    expect(circuitBreakerRegistry.isOpen('new-provider-xyz-1')).toBe(false)
  })

  it('opens after 5 consecutive failures', () => {
    const provider = `test-breaker-open-${Date.now()}`
    for (let i = 0; i < 5; i++) circuitBreakerRegistry.recordFailure(provider)
    expect(circuitBreakerRegistry.isOpen(provider)).toBe(true)
  })

  it('stays closed before threshold', () => {
    const provider = `test-breaker-closed-${Date.now()}`
    for (let i = 0; i < 4; i++) circuitBreakerRegistry.recordFailure(provider)
    expect(circuitBreakerRegistry.isOpen(provider)).toBe(false)
  })

  it('closes after successful recovery from half-open', () => {
    const provider = `test-breaker-recover-${Date.now()}`
    for (let i = 0; i < 5; i++) circuitBreakerRegistry.recordFailure(provider)
    expect(circuitBreakerRegistry.isOpen(provider)).toBe(true)

    // Manually set to half-open to simulate cooldown expiry
    const all = circuitBreakerRegistry.getAll()
    if (all[provider]) all[provider]!.state = 'half-open'

    circuitBreakerRegistry.recordSuccess(provider)
    expect(circuitBreakerRegistry.isOpen(provider)).toBe(false)
  })

  it('getAll returns record of states', () => {
    const all = circuitBreakerRegistry.getAll()
    expect(typeof all).toBe('object')
  })
})

describe('ErrorAggregator', () => {
  beforeEach(() => {
    errorAggregator.reset()
  })

  it('tracks error frequency', () => {
    const err = new EdithError(ErrorCode.CHANNEL_SEND_FAILED, 'failed')
    errorAggregator.record(err)
    errorAggregator.record(err)
    const frequent = errorAggregator.getFrequent(2)
    expect(frequent.some(f => f.code === ErrorCode.CHANNEL_SEND_FAILED)).toBe(true)
  })

  it('does not return below threshold', () => {
    const err = new EdithError(ErrorCode.MEMORY_READ_FAILED, 'read fail')
    errorAggregator.record(err)
    const frequent = errorAggregator.getFrequent(5)
    expect(frequent.some(f => f.code === ErrorCode.MEMORY_READ_FAILED)).toBe(false)
  })

  it('resets all tallies', () => {
    const err = new EdithError(ErrorCode.INTERNAL_ERROR, 'err')
    for (let i = 0; i < 10; i++) errorAggregator.record(err)
    errorAggregator.reset()
    expect(errorAggregator.getFrequent(1)).toHaveLength(0)
  })

  it('includes sample message', () => {
    const err = new EdithError(ErrorCode.LLM_CIRCUIT_OPEN, 'circuit open')
    errorAggregator.record(err)
    errorAggregator.record(err)
    const frequent = errorAggregator.getFrequent(1)
    const entry = frequent.find(f => f.code === ErrorCode.LLM_CIRCUIT_OPEN)
    expect(entry?.sample).toBe('circuit open')
  })
})
