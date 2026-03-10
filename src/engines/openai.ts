/**
 * @file openai.ts
 * @description OpenAI GPT engine adapter — implements the Engine interface
 *              for the GPT model family via the openai SDK package.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as "openai" in engines/orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Task priority: reasoning (4th), code (4th), fast (5th), multimodal (2nd).
 *   The Orchestrator calls isAvailable() at init-time; the engine is only registered
 *   if OPENAI_API_KEY is set. generate() is never called on an unregistered engine.
 *
 *   Changes from original (Tahap 1.2 + 1.3):
 *   - Singleton client: OpenAI SDK instance created ONCE at construction, not per call.
 *     Reuses the underlying HTTP connection pool, reducing TCP overhead on every request.
 *   - Typed errors: catch block now throws via classifyEngineError() instead of returning "".
 *     Orchestrator receives the real error type (rate-limit / auth / timeout / unavailable)
 *     enabling accurate retry decisions and circuit-breaker classification.
 *
 * @module engines/openai
 */

import OpenAI from "openai";

import config from "../config.js";
import { createLogger } from "../logger.js";
import { classifyEngineError, EngineEmptyResponseError } from "./errors.js";
import type { Engine, GenerateOptions } from "./types.js";

const log = createLogger("engines.openai");

/**
 * Convert GenerateOptions to the OpenAI chat messages format.
 * OpenAI supports a "system" role as the first message.
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
 * OpenAIEngine — GPT-4o / GPT-4 model family adapter.
 *
 * Uses a lazy-initialised singleton OpenAI client so that the TCP connection
 * pool is reused across all generate() calls, avoiding per-request handshake
 * overhead that was present when `new OpenAI(...)` was called inside generate().
 */
export class OpenAIEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "openai";

  /** Provider label for logging and telemetry. */
  readonly provider = "openai";

  /** Default model used when GenerateOptions.model is not specified. */
  readonly defaultModel = "gpt-4o";

  /** Lazily-initialised singleton SDK client. Created on first generate() call. */
  private client: OpenAI | null = null;

  /**
   * Returns (and caches) the OpenAI SDK client instance.
   * Constructed lazily so that import-time side effects are avoided when the
   * engine is not configured.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    }
    return this.client;
  }

  /**
   * Returns true if OPENAI_API_KEY is set in config.
   * Orchestrator calls this at init() and only registers the engine if true.
   */
  isAvailable(): boolean {
    return config.OPENAI_API_KEY.trim().length > 0;
  }

  /**
   * Generate a response from OpenAI (GPT-4o / GPT-4) using the provided options.
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
        log.warn("empty response from OpenAI", {
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

export const openAIEngine = new OpenAIEngine();
