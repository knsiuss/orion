/**
 * @file prompt-filter.ts
 * @description PromptFilter  injection detection and input safety scanner.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Screens inbound user messages for prompt injection, jailbreak patterns,
 *   and policy violations before they reach the LLM pipeline.
 */
import { createLogger } from "../logger.js"
import { affordanceChecker, type AffordanceResult } from "./affordance-checker.js"

const log = createLogger("security.prompt-filter")

const SANITIZED_PREFIX = "[CONTENT SANITIZED] "
const MAX_LOG_LENGTH = 50
const AFFORDANCE_WARN_THRESHOLD = 0.55

interface RegexReplaceRule {
  pattern: RegExp
  replacement: string
}

interface DetectionRuleGroup {
  reason: string
  patterns: readonly RegExp[]
}

type DetectionResult =
  | { detected: false }
  | { detected: true; reason: string }

/**
 * Common homoglyph substitutions used in prompt injection bypass attempts.
 * Maps lookalike Unicode characters to their ASCII equivalents.
 */
const HOMOGLYPH_MAP: Readonly<Record<string, string>> = {
  // Cyrillic and Greek lookalikes for latin letters
  "\u0430": "a", // Cyrillic Ð°
  "\u0435": "e", // Cyrillic Ðµ
  "\u043e": "o", // Cyrillic Ð¾
  "\u0440": "r", // Cyrillic Ñ€
  "\u0441": "c", // Cyrillic Ñ
  "\u0443": "y", // Cyrillic Ñƒ
  "\u0445": "x", // Cyrillic Ñ…
  "\u0456": "i", // Cyrillic Ñ–
  "\u0391": "A", // Greek Î‘
  "\u0392": "B", // Greek Î’
  "\u0395": "E", // Greek Î•
  "\u0396": "Z", // Greek Î–
  "\u0397": "H", // Greek Î—
  "\u0399": "I", // Greek Î™
  "\u039a": "K", // Greek Îš
  "\u039c": "M", // Greek Îœ
  "\u039d": "N", // Greek Î
  "\u039f": "O", // Greek ÎŸ
  "\u03a1": "P", // Greek Î¡
  "\u03a4": "T", // Greek Î¤
  "\u03a7": "X", // Greek Î§
  "\u03b1": "a", // Greek Î±
  "\u03b5": "e", // Greek Îµ
  "\u03bf": "o", // Greek Î¿
  // Mathematical bold/italic variants of common injection keywords
  "\u2170": "i", // small roman numeral i â†’ i
  "\uff49": "i", // fullwidth i
  "\uff4f": "o", // fullwidth o
  "\uff41": "a", // fullwidth a
  "\uff45": "e", // fullwidth e
  "\uff53": "s", // fullwidth s
  "\uff59": "y", // fullwidth y
  "\uff52": "r", // fullwidth r
}

/**
 * Normalizes text for injection detection by applying NFKC Unicode normalization
 * followed by homoglyph replacement, making bypass attempts via lookalike characters
 * ineffective.
 *
 * @param text - Raw input text
 * @returns Normalized text safe for pattern matching
 */
function normalizeForDetection(text: string): string {
  // NFKC decomposes compatibility characters (e.g., ï¬ â†’ fi, Â² â†’ 2)
  const nfkc = text.normalize("NFKC")

  // Replace known homoglyphs char by char
  let result = ""
  for (const char of nfkc) {
    result += HOMOGLYPH_MAP[char] ?? char
  }
  return result
}

const DIRECT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions?/i,
  /forget\s+(all\s+)?(your\s+)?instructions?/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?\s*:/i,
  /system\s+prompt\s*:/i,
  /override\s+(previous\s+)?instructions?/i,
  /bypass\s+(all\s+)?restrictions?/i,
]

const JAILBREAK_PATTERNS: readonly RegExp[] = [
  /\bDAN\b/i,
  /do\s+anything\s+now\b/i,
  /pretend\s+(you\s+are|to\s+be)\b/i,
  /act\s+as\s+if\b/i,
  /you\s+are\s+(a|an)\s+\w+\s+(who|that|which)\b/i,
  /simulate\s+(being|a|an)\b/i,
  /role[ -]?play\s+(as|that)\b/i,
]

const ROLE_HIJACK_PATTERNS: readonly RegExp[] = [
  /your\s+new\s+persona\b/i,
  /from\s+now\s+on\s+you\s+are\b/i,
  /adopt\s+(the\s+)?(persona|role|identity)\s+(of|as)\b/i,
  /change\s+(your\s+)?(persona|role|identity)\b/i,
]

const DELIMITER_PATTERNS: readonly RegExp[] = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[SYSTEM\]/i,
  /\[USER\]/i,
  /\[ASSISTANT\]/i,
  /###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/i,
  /"""[^\n]*instruction/i,
  /---+\s*(system|instruction)/i,
]

const DETECTION_RULE_GROUPS: readonly DetectionRuleGroup[] = [
  { reason: "Direct injection pattern detected", patterns: DIRECT_INJECTION_PATTERNS },
  { reason: "Jailbreak pattern detected", patterns: JAILBREAK_PATTERNS },
  { reason: "Role hijack pattern detected", patterns: ROLE_HIJACK_PATTERNS },
  { reason: "Delimiter injection pattern detected", patterns: DELIMITER_PATTERNS },
]

const SANITIZE_STRUCTURE_RULES: readonly RegexReplaceRule[] = [
  { pattern: /<\|[^|]+\|>/g, replacement: "" },
  { pattern: /\[SYSTEM\]/gi, replacement: "[BLOCKED]" },
  { pattern: /\[USER\]/gi, replacement: "[BLOCKED]" },
  { pattern: /\[ASSISTANT\]/gi, replacement: "[BLOCKED]" },
  { pattern: /###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/gi, replacement: "### BLOCKED" },
  { pattern: /"""[^\n]*instruction/gi, replacement: '""" BLOCKED' },
  { pattern: /---+\s*(system|instruction)/gi, replacement: "--- BLOCKED" },
]

// Intentionally limited to direct-override phrases. This keeps sanitization
// conservative while still neutralizing the most common instruction-takeover text.
const SANITIZE_DIRECT_INJECTION_RULES: readonly RegexReplaceRule[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /disregard\s+(all\s+)?(previous\s+)?instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /forget\s+(all\s+)?(your\s+)?instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /you\s+are\s+now\b/gi, replacement: "[BLOCKED]" },
  { pattern: /new\s+instructions?\s*:/gi, replacement: "[BLOCKED]" },
  { pattern: /system\s+prompt\s*:/gi, replacement: "[BLOCKED]" },
]

function truncateForLogging(content: string): string {
  if (content.length <= MAX_LOG_LENGTH) {
    return content
  }
  return `${content.slice(0, MAX_LOG_LENGTH)}...`
}

function matchesAnyPattern(content: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return true
    }
  }
  return false
}

function detectInjection(content: string): DetectionResult {
  // Normalize first to defeat homoglyph bypass attempts
  const normalized = normalizeForDetection(content)
  for (const group of DETECTION_RULE_GROUPS) {
    if (matchesAnyPattern(normalized, group.patterns)) {
      return { detected: true, reason: group.reason }
    }
  }

  return { detected: false }
}

function applyReplaceRules(content: string, rules: readonly RegexReplaceRule[]): string {
  let next = content
  for (const rule of rules) {
    next = next.replace(rule.pattern, rule.replacement)
  }
  return next
}

function sanitizeContent(content: string): string {
  // Normalize first so homoglyph-encoded injection phrases are sanitized too
  const normalized = normalizeForDetection(content)
  const structuredSanitized = applyReplaceRules(normalized, SANITIZE_STRUCTURE_RULES)
  return applyReplaceRules(structuredSanitized, SANITIZE_DIRECT_INJECTION_RULES)
}

export interface PromptFilterResult {
  safe: boolean
  reason?: string
  sanitized: string
}

export interface PromptSafetyResult extends PromptFilterResult {
  affordance?: AffordanceResult
}

interface FilterTextOptions {
  userId?: string
  logMessage: string
  logErrorMessage: string
  addSanitizedPrefix: boolean
}

function filterText(content: string, options: FilterTextOptions): PromptFilterResult {
  try {
    const detection = detectInjection(content)
    if (!detection.detected) {
      return {
        safe: true,
        sanitized: content,
      }
    }

    const preview = truncateForLogging(content)
    const metadata = options.userId
      ? { userId: options.userId, reason: detection.reason, preview }
      : { reason: detection.reason, preview }
    log.warn(options.logMessage, metadata)

    const sanitizedBody = sanitizeContent(content)
    return {
      safe: false,
      reason: detection.reason,
      sanitized: options.addSanitizedPrefix ? `${SANITIZED_PREFIX}${sanitizedBody}` : sanitizedBody,
    }
  } catch (error) {
    // Fail closed on internal errors to avoid allowing injected input.
    log.error(options.logErrorMessage, error)
    const blocked = "[BLOCKED]"
    return {
      safe: false,
      reason: "Prompt filter internal error",
      sanitized: options.addSanitizedPrefix ? `${SANITIZED_PREFIX}${blocked}` : blocked,
    }
  }
}

export function filterPrompt(prompt: string, userId: string): PromptFilterResult {
  return filterText(prompt, {
    userId,
    logMessage: "Prompt injection detected",
    logErrorMessage: "filterPrompt error",
    addSanitizedPrefix: true,
  })
}

export async function filterPromptWithAffordance(
  prompt: string,
  userId: string,
): Promise<PromptSafetyResult> {
  const patternFiltered = filterPrompt(prompt, userId)
  if (!patternFiltered.safe) {
    return patternFiltered
  }

  const affordance = await affordanceChecker.deepCheck(patternFiltered.sanitized, userId)
  if (affordance.shouldBlock) {
    log.warn("Prompt blocked by affordance checker", {
      userId,
      riskScore: affordance.riskScore,
      category: affordance.category,
      reasoning: affordance.reasoning,
      preview: truncateForLogging(prompt),
    })

    return {
      safe: false,
      reason: `Affordance blocked (${affordance.category})`,
      sanitized: patternFiltered.sanitized,
      affordance,
    }
  }

  if (affordance.riskScore >= AFFORDANCE_WARN_THRESHOLD) {
    log.warn("Prompt allowed with affordance warning", {
      userId,
      riskScore: affordance.riskScore,
      category: affordance.category,
      reasoning: affordance.reasoning,
      preview: truncateForLogging(prompt),
    })
  }

  return {
    ...patternFiltered,
    affordance,
  }
}

export function filterToolResult(result: string): PromptFilterResult {
  return filterText(result, {
    logMessage: "Tool result injection detected",
    logErrorMessage: "filterToolResult error",
    addSanitizedPrefix: false,
  })
}
