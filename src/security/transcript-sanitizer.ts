/**
 * @file transcript-sanitizer.ts
 * @description Sanitizes session transcripts by redacting sensitive data before storage or LLM context.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Inspired by OpenClaw's transcript-policy.ts. Called by session-summarizer.ts before
 *   generating summaries and by session-store before persisting transcripts.
 *   Redacts API keys, passwords, tokens, credit card numbers, and SSN patterns.
 *   Preserves message structure while replacing matches with redaction markers.
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.transcript-sanitizer")

/** Patterns that should be redacted from stored transcripts. */
const REDACTION_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: "api_key",
    pattern: /\b(sk-[a-zA-Z0-9]{20,}|key-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{35})\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "bearer_token",
    pattern: /Bearer\s+[a-zA-Z0-9._~+/=-]{20,}/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  {
    name: "password_assignment",
    pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi,
    replacement: "[REDACTED_PASSWORD]",
  },
  {
    name: "credit_card",
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: "[REDACTED_CC]",
  },
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },
  {
    name: "jwt",
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_JWT]",
  },
  {
    name: "private_key_header",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "connection_string_password",
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi,
    replacement: "[REDACTED_CONNECTION_STRING]://***:***@",
  },
]

/** Result of transcript sanitization. */
export interface SanitizeResult {
  /** The sanitized text. */
  sanitized: string
  /** Number of redactions applied. */
  redactionCount: number
  /** Names of patterns that matched. */
  redactedTypes: string[]
}

/**
 * Sanitize a single text string, replacing sensitive patterns with redaction markers.
 *
 * @param text - Raw text to sanitize
 * @returns Sanitized result with metadata
 */
export function sanitizeTranscript(text: string): SanitizeResult {
  let result = text
  let redactionCount = 0
  const redactedTypes: string[] = []

  for (const { name, pattern, replacement } of REDACTION_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0
    const matches = result.match(pattern)
    if (matches && matches.length > 0) {
      redactionCount += matches.length
      redactedTypes.push(name)
      result = result.replace(pattern, replacement)
    }
  }

  if (redactionCount > 0) {
    log.debug("transcript sanitized", { redactionCount, types: redactedTypes })
  }

  return { sanitized: result, redactionCount, redactedTypes }
}

/**
 * Sanitize an array of session messages in place.
 *
 * @param messages - Array of messages with content field
 * @returns Total number of redactions applied
 */
export function sanitizeMessages<T extends { content: string }>(messages: T[]): number {
  let totalRedactions = 0
  for (const msg of messages) {
    const result = sanitizeTranscript(msg.content)
    msg.content = result.sanitized
    totalRedactions += result.redactionCount
  }
  return totalRedactions
}
