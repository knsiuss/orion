/**
 * @file output-scanner.ts
 * @description OutputScanner — scans LLM responses for sensitive data patterns
 *              before delivery to the user and sanitizes any matches found.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called at Stage 7 of message-pipeline.ts (after LLM generation + critique,
 *   before persistence). Also called by ChannelManager.send() and broadcast()
 *   as a second layer before messages reach external platforms.
 *
 *   Two categories of patterns:
 *     SENSITIVE_OUTPUT_PATTERNS — matched content is REDACTED (safe to deliver)
 *     WARNING_PATTERNS          — matched content is flagged but NOT redacted
 *                                 (logged as a warning, `safe` set to false)
 *
 *   Pattern coverage (Tahap 1.6 expansion):
 *     - OpenAI / generic API keys (sk-...)
 *     - GitHub personal access tokens (ghp_, gho_, ghs_, ghr_)
 *     - JWT tokens (three-part base64url)
 *     - Passwords in key=value format
 *     - AWS access key IDs (AKIA...)
 *     - AWS secret access keys (40-char alphanumeric after "aws_secret")
 *     - GCP / Google service account keys (JSON with "private_key")
 *     - SSH private key blocks (-----BEGIN ... PRIVATE KEY-----)
 *     - Slack bot/user/app tokens (xoxb-, xoxp-, xoxa-)
 *     - Database connection URLs (postgres://, mysql://, mongodb://, redis://)
 *     - Generic bearer tokens in Authorization headers
 *     - Twilio auth tokens / SIDs
 *     - Stripe API keys (sk_live_, sk_test_)
 *     - Harmful instruction patterns (warning only)
 *
 * @module security/output-scanner
 */

import { createLogger } from "../logger.js";

const log = createLogger("security.output-scanner");

export interface OutputScanResult {
  /** Whether the output is considered safe (no issues detected). */
  safe: boolean;
  /** List of issue descriptions for each match found. */
  issues: string[];
  /** The sanitized version of the output with sensitive data redacted. */
  sanitized: string;
}

/**
 * A rule that matches sensitive content and replaces it with a safe placeholder.
 */
interface SensitiveOutputPattern {
  /** Regex to detect the sensitive value. Must use the `g` flag. */
  pattern: RegExp;
  /** Replacement string — should clearly indicate what was redacted. */
  replace: string;
  /** Human-readable issue label for the issues[] array in OutputScanResult. */
  issue: string;
}

/**
 * Patterns that, when matched, cause content to be REDACTED in the output.
 * Each pattern must use the `g` (global) flag so `lastIndex` resets are handled
 * consistently in the scan loop.
 *
 * ORDER MATTERS: More specific patterns (e.g. AWS AKIA) before broader ones
 * (e.g. generic long alphanumeric strings) to avoid false positives.
 */
const SENSITIVE_OUTPUT_PATTERNS: readonly SensitiveOutputPattern[] = [
  // ── OpenAI / generic sk- API keys ──────────────────────────────────────────
  {
    pattern: /\bsk-[a-zA-Z0-9_-]{20,}/g,
    replace: "[OPENAI_KEY_REDACTED]",
    issue: "OpenAI / generic API key in output",
  },

  // ── Anthropic API keys ──────────────────────────────────────────────────────
  {
    pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}/g,
    replace: "[ANTHROPIC_KEY_REDACTED]",
    issue: "Anthropic API key in output",
  },

  // ── GitHub tokens ───────────────────────────────────────────────────────────
  {
    pattern: /\bghp_[a-zA-Z0-9]{36,}\b/g,
    replace: "[GITHUB_TOKEN_REDACTED]",
    issue: "GitHub personal access token in output",
  },
  {
    pattern: /\bgho_[a-zA-Z0-9]{36,}\b/g,
    replace: "[GITHUB_OAUTH_REDACTED]",
    issue: "GitHub OAuth token in output",
  },
  {
    pattern: /\bghs_[a-zA-Z0-9]{36,}\b/g,
    replace: "[GITHUB_APP_SECRET_REDACTED]",
    issue: "GitHub App secret in output",
  },
  {
    pattern: /\bghr_[a-zA-Z0-9]{36,}\b/g,
    replace: "[GITHUB_REFRESH_REDACTED]",
    issue: "GitHub refresh token in output",
  },

  // ── AWS keys ────────────────────────────────────────────────────────────────
  {
    // AWS Access Key ID: always starts with AKIA (or ASIA for STS, AROA for role)
    pattern: /\b(AKIA|ASIA|AROA|AIDA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/g,
    replace: "[AWS_ACCESS_KEY_REDACTED]",
    issue: "AWS access key ID in output",
  },
  {
    // AWS Secret Access Key: 40-char base64 string typically after aws_secret_access_key
    pattern:
      /(?:aws_secret_access_key|aws[_\s-]?secret)[^\S\r\n]*[=:][^\S\r\n]*["']?([A-Za-z0-9/+]{40})["']?/gi,
    replace: "aws_secret_access_key: [AWS_SECRET_REDACTED]",
    issue: "AWS secret access key in output",
  },

  // ── GCP / Google Service Account keys ───────────────────────────────────────
  {
    // JSON service account with private_key field
    pattern:
      /"private_key"\s*:\s*"-----BEGIN[^"]{20,}-----END[^"]+KEY-----\\n"/g,
    replace: '"private_key": "[GCP_PRIVATE_KEY_REDACTED]"',
    issue: "GCP service account private key in output",
  },
  {
    // Google API keys
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: "[GOOGLE_API_KEY_REDACTED]",
    issue: "Google API key in output",
  },

  // ── SSH private keys ─────────────────────────────────────────────────────────
  {
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]{20,}?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replace: "[SSH_PRIVATE_KEY_REDACTED]",
    issue: "SSH/TLS private key in output",
  },

  // ── Slack tokens ─────────────────────────────────────────────────────────────
  {
    // Slack bot token
    pattern: /\bxoxb-[0-9A-Za-z-]{40,}\b/g,
    replace: "[SLACK_BOT_TOKEN_REDACTED]",
    issue: "Slack bot token in output",
  },
  {
    // Slack user token
    pattern: /\bxoxp-[0-9A-Za-z-]{40,}\b/g,
    replace: "[SLACK_USER_TOKEN_REDACTED]",
    issue: "Slack user token in output",
  },
  {
    // Slack app-level token
    pattern: /\bxapp-[0-9A-Za-z-]{40,}\b/g,
    replace: "[SLACK_APP_TOKEN_REDACTED]",
    issue: "Slack app token in output",
  },
  {
    // Slack OAuth v2 token
    pattern: /\bxoxa-[0-9A-Za-z-]{40,}\b/g,
    replace: "[SLACK_OAUTH_TOKEN_REDACTED]",
    issue: "Slack OAuth token in output",
  },

  // ── Database connection URLs ─────────────────────────────────────────────────
  {
    // PostgreSQL: postgres://user:password@host/db
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@\s"'`]+@[^\s"'`]+/gi,
    replace: "[POSTGRES_URL_REDACTED]",
    issue: "PostgreSQL connection URL with credentials in output",
  },
  {
    // MySQL: mysql://user:password@host/db
    pattern: /mysql:\/\/[^:]+:[^@\s"'`]+@[^\s"'`]+/gi,
    replace: "[MYSQL_URL_REDACTED]",
    issue: "MySQL connection URL with credentials in output",
  },
  {
    // MongoDB: mongodb://user:password@host/db
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@\s"'`]+@[^\s"'`]+/gi,
    replace: "[MONGODB_URL_REDACTED]",
    issue: "MongoDB connection URL with credentials in output",
  },
  {
    // Redis: redis://:password@host or redis://user:password@host
    pattern: /redis:\/\/(?:[^:]+:[^@\s"'`]+@)[^\s"'`]+/gi,
    replace: "[REDIS_URL_REDACTED]",
    issue: "Redis connection URL with credentials in output",
  },
  {
    // Generic database URL pattern (catches mssql://, cockroachdb://, etc.)
    pattern:
      /(?:mssql|sqlserver|cockroachdb|cassandra|couchdb|neo4j):\/\/[^:]+:[^@\s"'`]+@[^\s"'`]+/gi,
    replace: "[DB_URL_REDACTED]",
    issue: "Database connection URL with credentials in output",
  },

  // ── Bearer / Authorization header tokens ────────────────────────────────────
  {
    // Authorization: Bearer <token> where token is 20+ chars
    pattern:
      /(?:Authorization|Bearer)[^\S\r\n]*[=:][^\S\r\n]*["']?Bearer[^\S\r\n]+([a-zA-Z0-9._\-+/]{20,})["']?/gi,
    replace: "Authorization: Bearer [TOKEN_REDACTED]",
    issue: "Authorization Bearer token in output",
  },

  // ── Twilio credentials ───────────────────────────────────────────────────────
  {
    // Twilio Account SID: starts with AC, 34 chars total
    pattern: /\bAC[a-f0-9]{32}\b/g,
    replace: "[TWILIO_SID_REDACTED]",
    issue: "Twilio Account SID in output",
  },
  {
    // Twilio Auth Token: 32-char hex string (context-dependent, skip if too broad)
    pattern:
      /(?:twilio[_\s-]?auth[_\s-]?token|TWILIO_AUTH_TOKEN)[^\S\r\n]*[=:][^\S\r\n]*["']?([a-f0-9]{32})["']?/gi,
    replace: "TWILIO_AUTH_TOKEN=[TWILIO_AUTH_REDACTED]",
    issue: "Twilio auth token in output",
  },

  // ── Stripe keys ──────────────────────────────────────────────────────────────
  {
    pattern: /\bsk_live_[a-zA-Z0-9]{24,}\b/g,
    replace: "[STRIPE_LIVE_KEY_REDACTED]",
    issue: "Stripe live secret key in output",
  },
  {
    pattern: /\bsk_test_[a-zA-Z0-9]{24,}\b/g,
    replace: "[STRIPE_TEST_KEY_REDACTED]",
    issue: "Stripe test secret key in output",
  },
  {
    pattern: /\brk_live_[a-zA-Z0-9]{24,}\b/g,
    replace: "[STRIPE_RESTRICTED_KEY_REDACTED]",
    issue: "Stripe restricted key in output",
  },

  // ── JWT tokens ───────────────────────────────────────────────────────────────
  {
    // Three-part base64url JWT: header.payload.signature (min 20 chars each part)
    pattern:
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    replace: "[JWT_REDACTED]",
    issue: "JWT token in output",
  },

  // ── Password in key=value / key: value format ────────────────────────────────
  {
    pattern: /\bpassword\s*[:=]\s*["']?[^\s"'\n]{8,}["']?/gi,
    replace: "password: [REDACTED]",
    issue: "Password in output",
  },
  {
    pattern: /\bpasswd\s*[:=]\s*["']?[^\s"'\n]{8,}["']?/gi,
    replace: "passwd: [REDACTED]",
    issue: "Password (passwd) in output",
  },
  {
    // SECRET_KEY / secret_key / SECRET in env format
    pattern:
      /\b(?:secret[_-]?key|private[_-]?key|api[_-]?secret)\s*[:=]\s*["']?[a-zA-Z0-9_\-+/]{16,}["']?/gi,
    replace: "secret_key: [REDACTED]",
    issue: "Secret key value in output",
  },
];

/**
 * Patterns that flag potentially harmful content in the output.
 * These do NOT redact — they add a warning entry to the issues array.
 * The `safe` property is set to false, allowing the pipeline to log or
 * apply further review, but the content is preserved as-is.
 */
const WARNING_PATTERNS: readonly RegExp[] = [
  /step\s*\d+.*\b(kill|harm|attack|steal)\b/gi,
  /\b(instructions|steps|guide)\b.*\b(hack|exploit|bypass)\b/gi,
  /\bhow\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|malware|virus|ransomware)\b/gi,
  /\b(synthesize|manufacture|produce)\s+(drugs?|explosives?|poison)\b/gi,
];

const WARNING_ISSUE_LABEL = "Potentially harmful instructions in output";

export class OutputScanner {
  /**
   * Scan an LLM output string for sensitive data and harmful content.
   *
   * Sensitive patterns are REDACTED in-place; the returned `sanitized` string
   * is safe to deliver to the user and persist. Warning patterns log a warning
   * but do not alter the content — they set `safe` to false.
   *
   * @param output - The raw LLM response text to scan.
   * @returns OutputScanResult with safe flag, issue list, and sanitized text.
   */
  scan(output: string): OutputScanResult {
    const start = Date.now();
    let sanitized = output;
    const issues: string[] = [];

    // Pass 1: Redact sensitive content.
    for (const rule of SENSITIVE_OUTPUT_PATTERNS) {
      // Reset lastIndex before test() to avoid the stateful regex bug.
      rule.pattern.lastIndex = 0;

      if (rule.pattern.test(sanitized)) {
        issues.push(rule.issue);
        // Reset again before replace() — test() advances lastIndex.
        rule.pattern.lastIndex = 0;
        sanitized = sanitized.replace(rule.pattern, rule.replace);
      }

      // Always reset after each rule to keep state clean for the next iteration.
      rule.pattern.lastIndex = 0;
    }

    // Pass 2: Flag harmful instructions (no redaction).
    for (const pattern of WARNING_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(sanitized)) {
        issues.push(WARNING_ISSUE_LABEL);
      }
      pattern.lastIndex = 0;
    }

    if (issues.length > 0) {
      log.warn("output scan found issues", {
        count: issues.length,
        issues,
        scanMs: Date.now() - start,
      });
    } else {
      log.debug("output scan passed", { scanMs: Date.now() - start });
    }

    return {
      safe: issues.length === 0,
      issues,
      sanitized,
    };
  }
}

export const outputScanner = new OutputScanner();
