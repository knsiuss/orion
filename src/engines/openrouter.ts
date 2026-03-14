/**
 * @file openrouter.ts
 * @description OpenRouter engine adapter — implements the Engine interface for
 *              the OpenRouter API, which proxies requests to 100+ LLM providers
 *              through a unified OpenAI-compatible endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as "openrouter" in engines/orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Task priority: reasoning (5th), code (5th), fast (3rd), multimodal (4th).
 *   Acts as a broad fallback covering providers not individually integrated
 *   (Mistral, Command R+, Perplexity, etc.) via a single API key.
 *   The Orchestrator calls isAvailable() at init-time; the engine is only registered
 *   if OPENROUTER_API_KEY is set. generate() is never called on an unregistered engine.
 *
 *   Changes from original (Tahap 1.2 + 1.3):
 *   - Singleton client: OpenAI-compatible client instance created ONCE at construction,
 *     not per call. Reuses the underlying HTTP connection pool, reducing TCP overhead
 *     on every request.
 *   - Typed errors: catch block now throws via classifyEngineError() instead of returning "".
 *     Orchestrator receives the real error type (rate-limit / auth / timeout / unavailable)
 *     enabling accurate retry decisions and circuit-breaker classification.
 *
 * @module engines/openrouter
 */

import OpenAI from "openai";

import config from "../config.js";
import { createLogger } from "../logger.js";
import { classifyEngineError, EngineEmptyResponseError } from "./errors.js";
import type { Engine, GenerateOptions } from "./types.js";

const log = createLogger("engines.openrouter");

/** OpenRouter base URL — OpenAI-compatible REST API. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter-specific request headers added to every API call.
 * These are optional but recommended by OpenRouter for usage tracking.
 */
const OPENROUTER_DEFAULT_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://github.com/edith-ai/edith",
  "X-Title": "EDITH AI Companion",
};

/**
 * Convert GenerateOptions to the OpenAI-compatible chat messages format.
 * OpenRouter uses the same message structure as the OpenAI Chat Completions API.
 */
function toMessages(
  options: GenerateOptions,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() });
  }

  messages.push(...(options.context ?? []));
  messages.push({ role: "user", content: options.prompt });
  return messages;
}

/**
 * OpenRouterEngine — multi-provider proxy adapter.
 *
 * OpenRouter exposes an OpenAI-compatible API surface, so we use the `openai`
 * package pointed at the OpenRouter base URL. This gives us access to Mistral,
 * Command R+, Perplexity, WizardLM, and many others through a single key.
 *
 * Uses a lazy-initialised singleton OpenAI client (with OpenRouter base URL)
 * so that the TCP connection pool is reused across all generate() calls,
 * avoiding per-request handshake overhead that was present when
 * `new OpenAI(...)` was called inside generate().
 */
export class OpenRouterEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "openrouter";

  /** Provider label for logging and telemetry. */
  readonly provider = "openrouter";

  /**
   * Default model used when GenerateOptions.model is not specified.
   * Claude 3.5 Sonnet via OpenRouter is a strong general-purpose fallback.
   */
  readonly defaultModel = "anthropic/claude-3.5-sonnet";

  /** Lazily-initialised singleton OpenAI-compatible client. Created on first generate() call. */
  private client: OpenAI | null = null;

  /**
   * Returns (and caches) the OpenAI-compatible client instance configured for OpenRouter.
   * Constructed lazily so that import-time side effects are avoided when the
   * engine is not configured.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: config.OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: OPENROUTER_DEFAULT_HEADERS,
      });
    }
    return this.client;
  }

  /**
   * Returns true if OPENROUTER_API_KEY is set in config.
   * Orchestrator calls this at init() and only registers the engine if true.
   */
  isAvailable(): boolean {
    return config.OPENROUTER_API_KEY.trim().length > 0;
  }

  /**
   * Generate a response via OpenRouter (proxied to the configured model provider).
   *
   * @throws {EngineRateLimitError}     on HTTP 429 or rate-limit message
   * @throws {EngineAuthError}          on HTTP 401/403 or bad API key
   * @throws {EngineTimeoutError}       on request timeout
   * @throws {EngineUnavailableError}   on HTTP 5xx
   * @throws {EngineEmptyResponseError} when the API returns no content
   * @throws {EngineError}              for all other failures
   */
  async generate(options: GenerateOptions): Promise<string> {
    const client = this.getClient();

    try {
      const response = await client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: toMessages(options),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      });

      const text = response.choices[0]?.message?.content?.trim() ?? "";

      if (text.length === 0) {
        throw new EngineEmptyResponseError(this.name);
      }

      return text;
    } catch (error) {
      // Re-throw already-typed engine errors (e.g. EngineEmptyResponseError above).
      if (error instanceof EngineEmptyResponseError) {
        log.warn("empty response from OpenRouter", {
          model: options.model ?? this.defaultModel,
        });
        throw error;
      }

      // Classify raw SDK / fetch errors into typed EngineError subclasses.
      const classified = classifyEngineError(this.name, error);
      log.error("generate failed", {
        errorType: classified.name,
        message: classified.message,
        model: options.model ?? this.defaultModel,
      });
      throw classified;
    }
  }
}

export const openRouterEngine = new OpenRouterEngine();
