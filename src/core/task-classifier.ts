/**
 * @file task-classifier.ts
 * @description TaskClassifier — classifies user messages into LLM TaskType values
 *              so the Orchestrator can route to the optimal engine/model for each query.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called at Stage 4.5 of message-pipeline.ts, after persona detection and before
 *   LLM generation. Replaces the hardcoded `"reasoning"` TaskType that caused every
 *   message — including trivial greetings — to be routed through expensive reasoning
 *   models, wasting tokens and increasing latency by 30–50%.
 *
 *   Integration point in message-pipeline.ts:
 *     const taskType = classifyTask(safeText)
 *     const raw = await orchestrator.generate(taskType, { prompt, context, systemPrompt })
 *
 *   Classification rules (evaluated in priority order):
 *     1. code      — programming keywords, code fences, error messages, debug requests,
 *                    regex/SQL/algorithm discussion, language names, git commands
 *     2. fast      — short greetings, affirmations, social responses, time/date queries,
 *                    messages ≤ FAST_WORD_THRESHOLD words without complexity signals
 *     3. reasoning — everything else (multi-step analysis, research, planning, writing)
 *
 *   Priority map (from orchestrator.ts):
 *     reasoning → gemini → groq → anthropic → openai → openrouter → ollama
 *     code      → groq  → gemini → anthropic → openai → openrouter → ollama
 *     fast      → groq  → gemini → openrouter → ollama → openai → anthropic
 *
 * @module core/task-classifier
 */

import { createLogger } from "../logger.js"
import type { TaskType } from "../engines/types.js"

const log = createLogger("core.task-classifier")

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Messages with word count ≤ this value are candidates for "fast" routing,
 * provided they do not contain complexity signals (code, analysis request, etc.).
 */
const FAST_WORD_THRESHOLD = 10

/**
 * Minimum word count above which a message is assumed to need "reasoning",
 * regardless of other signals. Long messages almost always require depth.
 */
const REASONING_MIN_WORDS = 50

// ── Code detection patterns ──────────────────────────────────────────────────

/**
 * Patterns that strongly indicate the message is about programming or technical code.
 * Any single match promotes the query to TaskType "code".
 *
 * Rules are ordered roughly by specificity — more specific patterns first
 * to short-circuit early on common cases.
 */
const CODE_PATTERNS: readonly RegExp[] = [
  // Explicit code fences (```) — strongest signal
  /```/,

  // Common programming language names mentioned directly
  /\b(typescript|javascript|python|rust|golang|java\b|kotlin|swift|c\+\+|c#|php|ruby|scala|haskell|elixir|clojure|lua|dart|julia)\b/i,

  // Web / infra / data technologies
  /\b(html|css|sql|nosql|graphql|grpc|rest\s?api|websocket|dockerfile|nginx|kubernetes|helm|terraform|ansible)\b/i,

  // Programming constructs
  /\b(function|const\s+\w|let\s+\w|var\s+\w|class\s+\w|interface\s+\w|type\s+\w|enum\s+\w|async\s+function|arrow\s+function)\b/i,

  // Import / export / require syntax
  /\b(import\s+\w|from\s+['"]|require\s*\(|export\s+(default|const|function|class))\b/i,

  // Common error / debugging terms
  /\b(stacktrace|traceback|segfault|null\s*pointer|undefined\s+is\s+not|cannot\s+read\s+property|typeerror|referenceerror|syntaxerror|valueerror|attributeerror|keyerror|indexerror|runtimeerror|exception)\b/i,

  // Debugging / code review actions
  /\b(debug|refactor|optimize|lint|compile|build\s+error|test\s+fails?|unit\s+test|integration\s+test|mock\s+(the\s+)?\w|stub\s+(the\s+)?\w)\b/i,

  // Code review / review request
  /\b(code\s+review|review\s+(this|my|the)\s+(code|function|class|snippet)|pull\s+request)\b/i,

  // Algorithm / data structure terms
  /\b(algorithm|big.?o|complexity|recursion|iteration|loop|hash\s?map|binary\s?tree|linked\s?list|queue|stack|heap|graph\s+(traversal|search)|dfs|bfs|dynamic\s+programming|memoization)\b/i,

  // Git / version control
  /\b(git\s+(commit|push|pull|merge|rebase|clone|branch|checkout|stash|diff|log|blame)|github|gitlab|bitbucket)\b/i,

  // Package managers / build tools
  /\b(npm\s+|pnpm\s+|yarn\s+|pip\s+|cargo\s+|mvn\s+|gradle\s+|make\s+|cmake)\b/i,

  // Regular expressions
  /\b(regex|regexp|regular\s+expression)\b/i,

  // Database queries
  /\b(select\s+\*?\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|join\s+\w+\s+on|create\s+table|alter\s+table|drop\s+table)\b/i,

  // Environment / deployment
  /\b(environment\s+variable|\.env|docker\s+(run|build|compose)|ci\/cd|github\s+actions|deploy(ment)?)\b/i,

  // Fix / implement request with code context
  /\b(fix\s+(the\s+)?(bug|error|issue|problem)|implement\s+(the\s+)?(function|method|class|interface|feature)|write\s+(a\s+)?(function|class|script|test))\b/i,
]

// ── Fast detection patterns ──────────────────────────────────────────────────

/**
 * Patterns that indicate a short, conversational message needing a fast response.
 * Any single match on a short message promotes the query to TaskType "fast".
 */
const FAST_PATTERNS: readonly RegExp[] = [
  // Greetings
  /^(hi|hey|hello|halo|hai|yo|howdy|sup|what'?s\s+up)\b/i,

  // Affirmations / acknowledgements
  /^(thanks|thank\s*you|makasih|thx|ty|cheers|nice|cool|great|awesome|perfect|got\s*it|noted|understood|oke|ok|okay)\b/i,

  // Simple yes/no responses
  /^(yes|no|yeah|nope|yep|yup|nah|sure|absolutely|of\s+course|definitely|probably|maybe|not\s+really)\b/i,

  // Farewells
  /^(bye|goodbye|good\s*bye|see\s*you|ciao|later|ttyl|gotta\s+go|take\s+care)\b/i,

  // Greetings with time-of-day
  /^(good\s+(morning|afternoon|evening|night|day))\b/i,

  // Simple time / date queries
  /^(what(?:'s|\s+is)\s+(the\s+)?(time|date|day|year)\b|what\s+day\s+is\s+(it|today))/i,

  // Identity / status queries
  /^(how\s+are\s+you|are\s+you\s+(ok|okay|there|ready)|you\s+ok)\b/i,
  /^(who\s+are\s+you|what\s+are\s+you)\b/i,
  /^(are\s+you\s+(an?\s+)?ai)\b/i,

  // Wake-up / ping
  /^(wake\s+up|ping|hey\s+edith|edith)\b/i,
]

// ── Complexity signals ────────────────────────────────────────────────────────

/**
 * Patterns indicating the message requires deep reasoning, even if short.
 * A match here forces TaskType "reasoning" regardless of word count.
 */
const REASONING_SIGNALS: readonly RegExp[] = [
  // Analysis / explanation requests
  /\b(explain|analyse|analyze|compare|contrast|evaluate|assess|critique|review)\b/i,

  // Causal / hypothetical reasoning
  /\b(why\s+does|how\s+does|what\s+causes|what\s+would\s+happen|if\s+.+\s+then)\b/i,

  // Planning / strategy
  /\b(plan|strategy|roadmap|approach|best\s+(way|practice|approach)|should\s+i\s+(use|do|choose))\b/i,

  // Research / factual depth
  /\b(research|summarize|summary|pros\s+and\s+cons|tradeoffs?|recommend|suggestion)\b/i,

  // Creative / long-form writing
  /\b(write\s+(a\s+)?(story|essay|article|blog|report|email|letter|proposal|draft))\b/i,

  // Multi-step or numbered list requests
  /\b(step[- ]by[- ]step|list\s+(all|the|every)|enumerate|breakdown|break\s+it\s+down)\b/i,

  // Philosophical / abstract
  /\b(meaning\s+of|philosophy|ethics|moral(ly)?|consciousness|existence)\b/i,
]

// ── Helper utilities ──────────────────────────────────────────────────────────

/**
 * Count the number of words in a string.
 * Splitting on whitespace sequences is intentionally simple to keep this O(n).
 *
 * @param text - The input string.
 * @returns Approximate word count.
 */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length
}

/**
 * Test a string against an array of patterns, returning true on the first match.
 * Short-circuits as soon as a match is found.
 *
 * @param text     - The string to test.
 * @param patterns - Array of regular expressions to test against.
 * @returns True if any pattern matches, false otherwise.
 */
function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true
    }
  }
  return false
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a sanitized user message into a TaskType for LLM routing.
 *
 * Classification is intentionally conservative: when uncertain, the classifier
 * defaults to "reasoning" to avoid routing a complex query to a fast/cheap model.
 *
 * Performance: O(n*p) where n = message length and p = pattern count.
 * In practice this runs in < 1 ms for typical messages.
 *
 * @param message - The sanitized user message text (after prompt-filter stage).
 * @returns TaskType: "code" | "fast" | "reasoning"
 *
 * @example
 * classifyTask("fix the null pointer in my TypeScript function") // → "code"
 * classifyTask("hey!")                                           // → "fast"
 * classifyTask("explain the tradeoffs between SQL and NoSQL")    // → "reasoning"
 */
export function classifyTask(message: string): TaskType {
  const trimmed = message.trim()

  if (trimmed.length === 0) {
    log.debug("empty message → fast")
    return "fast"
  }

  // 1. Code detection — highest priority.
  //    Programming queries should always go to a code-optimised engine (Groq/Gemini).
  if (matchesAny(trimmed, CODE_PATTERNS)) {
    log.debug("classified as code", { preview: trimmed.slice(0, 60) })
    return "code"
  }

  const wordCount = countWords(trimmed)

  // 2. Long messages always need reasoning — skip fast-path evaluation.
  if (wordCount >= REASONING_MIN_WORDS) {
    log.debug("classified as reasoning (long message)", { wordCount })
    return "reasoning"
  }

  // 3. Reasoning signals — even short messages can require deep analysis.
  if (matchesAny(trimmed, REASONING_SIGNALS)) {
    log.debug("classified as reasoning (signal match)", {
      preview: trimmed.slice(0, 60),
    })
    return "reasoning"
  }

  // 4. Fast path — short messages with conversational patterns.
  //    Only applied when wordCount is within the threshold to avoid misclassifying
  //    short-but-complex queries (e.g. "why?" as a follow-up to a technical topic).
  if (wordCount <= FAST_WORD_THRESHOLD && matchesAny(trimmed, FAST_PATTERNS)) {
    log.debug("classified as fast (pattern match)", { wordCount })
    return "fast"
  }

  // 5. Short messages without explicit complexity signals — treat as fast.
  //    Example: "what's the time?" (6 words, no reasoning signal)
  if (wordCount <= FAST_WORD_THRESHOLD && !trimmed.endsWith("?")) {
    log.debug("classified as fast (short, no signal)", { wordCount })
    return "fast"
  }

  // 6. Default: reasoning.
  //    Errs on the side of quality — we'd rather over-route than under-route.
  log.debug("classified as reasoning (default)", { wordCount })
  return "reasoning"
}

/**
 * Classify a message and return a debug-friendly result object.
 * Intended for use in tests and the `/api/debug/classify` dev endpoint.
 *
 * @param message - The user message to classify.
 * @returns Object with taskType, wordCount, and matched signal description.
 */
export function classifyTaskDebug(message: string): {
  taskType: TaskType
  wordCount: number
  signal: string
} {
  const trimmed = message.trim()
  const wordCount = countWords(trimmed)

  if (trimmed.length === 0) {
    return { taskType: "fast", wordCount: 0, signal: "empty_message" }
  }

  if (matchesAny(trimmed, CODE_PATTERNS)) {
    return { taskType: "code", wordCount, signal: "code_pattern" }
  }

  if (wordCount >= REASONING_MIN_WORDS) {
    return { taskType: "reasoning", wordCount, signal: "long_message" }
  }

  if (matchesAny(trimmed, REASONING_SIGNALS)) {
    return { taskType: "reasoning", wordCount, signal: "reasoning_signal" }
  }

  if (wordCount <= FAST_WORD_THRESHOLD && matchesAny(trimmed, FAST_PATTERNS)) {
    return { taskType: "fast", wordCount, signal: "fast_pattern" }
  }

  if (wordCount <= FAST_WORD_THRESHOLD && !trimmed.endsWith("?")) {
    return { taskType: "fast", wordCount, signal: "short_no_signal" }
  }

  return { taskType: "reasoning", wordCount, signal: "default" }
}
