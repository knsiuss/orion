/**
 * @file anthropic.ts
 * @description Anthropic Claude engine adapter — implements the Engine interface
 *              for the Claude model family via the @anthropic-ai/sdk package.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as "anthropic" in engines/orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Task priority: reasoning (3rd), code (3rd), fast (last), multimodal (3rd).
 *   The Orchestrator calls isAvailable() at init-time; the engine is only registered
 *   if ANTHROPIC_API_KEY is set. generate() is never called on an unregistered engine.
 *
 *   Changes from original (Tahap 1.2 + 1.3):
 *   - Singleton client: Anthropic SDK instance created ONCE at construction, not per call.
 *     Reuses the underlying HTTP connection pool, reducing TCP overhead on every request.
 *   - Typed errors: catch block now throws via classifyEngineError() instead of returning "".
 *     Orchestrator receives the real error type (rate-limit / auth / timeout / unavailable)
 *     enabling accurate retry decisions and circuit-breaker classification.
 *
 * @module engines/anthropic
 */

import Anthropic from "@anthropic-ai/sdk";

import config from "../config.js";
import { createLogger } from "../logger.js";
import { classifyEngineError, EngineEmptyResponseError } from "./errors.js";
import type { Engine, GenerateOptions } from "./types.js";

const log = createLogger("engines.anthropic");

/**
 * Convert GenerateOptions to the Anthropic messages array format.
 * Prepends context history then appends the current user prompt.
 */
function toMessages(
  options: GenerateOptions,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])];
  messages.push({ role: "user", content: options.prompt });
  return messages;
}

/**
 * Extract the system prompt string from GenerateOptions, or return undefined
 * if the string is blank (Anthropic SDK requires undefined, not "").
 */
function toSystemPrompt(options: GenerateOptions): string | undefined {
  const prompt = options.systemPrompt?.trim();
  return prompt && prompt.length > 0 ? prompt : undefined;
}

/**
 * AnthropicEngine — Claude model family adapter.
 *
 * Uses a lazy-initialised singleton Anthropic client so that the TCP connection
 * pool is reused across all generate() calls, avoiding per-request handshake
 * overhead that was present when `new Anthropic(...)` was called inside generate().
 */
export class AnthropicEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "anthropic";

  /** Provider label for logging and telemetry. */
  readonly provider = "anthropic";

  /** Default model used when GenerateOptions.model is not specified. */
  readonly defaultModel = "claude-3-5-sonnet-20241022";

  /** Lazily-initialised singleton SDK client. Created on first generate() call. */
  private client: Anthropic | null = null;

  /**
   * Returns (and caches) the Anthropic SDK client instance.
   * Constructed lazily so that import-time side effects are avoided when the
   * engine is not configured.
   */
  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  /**
   * Returns true if ANTHROPIC_API_KEY is set in config.
   * Orchestrator calls this at init() and only registers the engine if true.
   */
  isAvailable(): boolean {
    return config.ANTHROPIC_API_KEY.trim().length > 0;
  }

  /**
   * Generate a response from Claude using the provided options.
   *
   * @throws {EngineRateLimitError}   on HTTP 429 or rate-limit message
   * @throws {EngineAuthError}        on HTTP 401/403 or bad API key
   * @throws {EngineTimeoutError}     on request timeout
   * @throws {EngineUnavailableError} on HTTP 5xx
   * @throws {EngineEmptyResponseError} when the API returns no text block
   * @throws {EngineError}            for all other failures
   */
  async generate(options: GenerateOptions): Promise<string> {
    const client = this.getClient();

    try {
      const response = await client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 4096,
        system: toSystemPrompt(options),
        messages: toMessages(options),
      });

      const textBlock = response.content.find(
        (block: Anthropic.ContentBlock) => block.type === "text",
      );

      const text = textBlock?.type === "text" ? textBlock.text.trim() : "";

      if (text.length === 0) {
        throw new EngineEmptyResponseError(this.name);
      }

      return text;
    } catch (error) {
      // Re-throw already-typed engine errors (e.g. EngineEmptyResponseError above).
      if (error instanceof EngineEmptyResponseError) {
        log.warn("empty response from Anthropic", {
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

export const anthropicEngine = new AnthropicEngine();
