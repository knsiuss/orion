/**
 * @file groq.ts
 * @description Groq LLM engine adapter — implements the Engine interface
 *              for Llama and other models served via the Groq API.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as "groq" in engines/orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Task priority: reasoning (2nd), code (1st), fast (1st), multimodal (not used).
 *   Groq is the preferred "fast" engine due to its extremely low-latency inference.
 *   The Orchestrator calls isAvailable() at init-time; the engine is only registered
 *   if GROQ_API_KEY is set. generate() is never called on an unregistered engine.
 *
 *   Changes from original (Tahap 1.2 + 1.3):
 *   - Singleton client: Groq SDK instance created ONCE at construction, not per call.
 *     Reuses the underlying HTTP connection pool, reducing TCP overhead on every request.
 *   - Typed errors: catch block now throws via classifyEngineError() instead of returning "".
 *     Orchestrator receives the real error type (rate-limit / auth / timeout / unavailable)
 *     enabling accurate retry decisions and circuit-breaker classification.
 *
 * @module engines/groq
 */

import Groq from "groq-sdk";

import config from "../config.js";
import { createLogger } from "../logger.js";
import { classifyEngineError, EngineEmptyResponseError } from "./errors.js";
import type { Engine, GenerateOptions } from "./types.js";

const log = createLogger("engines.groq");

/**
 * Convert GenerateOptions to the Groq chat messages format.
 * Groq supports a "system" role as the first message, unlike Anthropic which
 * accepts a separate system parameter.
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
 * GroqEngine — Llama / Mixtral / Gemma model family adapter.
 *
 * Uses a lazy-initialised singleton Groq client so that the TCP connection
 * pool is reused across all generate() calls, avoiding per-request handshake
 * overhead that was present when `new Groq(...)` was called inside generate().
 */
export class GroqEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "groq";

  /** Provider label for logging and telemetry. */
  readonly provider = "groq";

  /** Default model used when GenerateOptions.model is not specified. */
  readonly defaultModel = "llama-3.3-70b-versatile";

  /** Lazily-initialised singleton SDK client. Created on first generate() call. */
  private client: Groq | null = null;

  /**
   * Returns (and caches) the Groq SDK client instance.
   * Constructed lazily so that import-time side effects are avoided when the
   * engine is not configured.
   */
  private getClient(): Groq {
    if (!this.client) {
      this.client = new Groq({ apiKey: config.GROQ_API_KEY });
    }
    return this.client;
  }

  /**
   * Returns true if GROQ_API_KEY is set in config.
   * Orchestrator calls this at init() and only registers the engine if true.
   */
  isAvailable(): boolean {
    return config.GROQ_API_KEY.trim().length > 0;
  }

  /**
   * Generate a response from Groq (Llama/Mixtral) using the provided options.
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
        log.warn("empty response from Groq", {
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

export const groqEngine = new GroqEngine();
