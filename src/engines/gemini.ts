/**
 * @file gemini.ts
 * @description Google Gemini engine adapter — implements the Engine interface
 *              for the Gemini model family via the @google/generative-ai package.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as "gemini" in engines/orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Task priority: reasoning (1st), code (2nd), fast (2nd), multimodal (1st).
 *   Gemini is the preferred "reasoning" and "multimodal" engine due to its large
 *   context window and vision capabilities.
 *   The Orchestrator calls isAvailable() at init-time; the engine is only registered
 *   if GEMINI_API_KEY is set. generate() is never called on an unregistered engine.
 *
 *   Changes from original (Tahap 1.2 + 1.3):
 *   - Singleton client: GoogleGenerativeAI instance created ONCE at construction,
 *     not per call. Avoids redundant object allocation on every request.
 *   - Typed errors: catch block now throws via classifyEngineError() instead of
 *     returning "". Orchestrator receives the real error type (rate-limit / auth /
 *     timeout / unavailable) enabling accurate retry decisions and circuit-breaker
 *     classification.
 *
 * @module engines/gemini
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

import config from "../config.js";
import { createLogger } from "../logger.js";
import { classifyEngineError, EngineEmptyResponseError } from "./errors.js";
import type { Engine, GenerateOptions } from "./types.js";

const log = createLogger("engines.gemini");

/**
 * GeminiEngine — Google Gemini model family adapter.
 *
 * Uses a lazy-initialised singleton GoogleGenerativeAI client so that the
 * instance is created only once and reused across all generate() calls,
 * avoiding redundant object allocation overhead on every request.
 *
 * Note: Gemini's chat API requires history to be passed as an array of
 * { role: "user" | "model", parts: [{ text }] } objects. The "model" role
 * is Gemini's equivalent of "assistant" in OpenAI/Anthropic conventions.
 */
export class GeminiEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "gemini";

  /** Provider label for logging and telemetry. */
  readonly provider = "google";

  /** Default model used when GenerateOptions.model is not specified. */
  readonly defaultModel = "gemini-1.5-pro";

  /** Lazily-initialised singleton GoogleGenerativeAI client. */
  private genAI: GoogleGenerativeAI | null = null;

  /**
   * Returns (and caches) the GoogleGenerativeAI client instance.
   * Constructed lazily so that import-time side effects are avoided when the
   * engine is not configured.
   */
  private getClient(): GoogleGenerativeAI {
    if (!this.genAI) {
      this.genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    }
    return this.genAI;
  }

  /**
   * Returns true if GEMINI_API_KEY is set in config.
   * Orchestrator calls this at init() and only registers the engine if true.
   */
  isAvailable(): boolean {
    return config.GEMINI_API_KEY.trim().length > 0;
  }

  /**
   * Generate a response from Gemini using the provided options.
   *
   * Gemini uses a stateful Chat session model: history is passed upfront,
   * then the current user message is sent via sendMessage(). This matches
   * the multi-turn conversation pattern used across the EDITH pipeline.
   *
   * @throws {EngineRateLimitError}     on HTTP 429 or rate-limit message
   * @throws {EngineAuthError}          on HTTP 401/403 or bad API key
   * @throws {EngineTimeoutError}       on request timeout
   * @throws {EngineUnavailableError}   on HTTP 5xx
   * @throws {EngineEmptyResponseError} when the API returns empty text
   * @throws {EngineError}              for all other failures
   */
  async generate(options: GenerateOptions): Promise<string> {
    const genAI = this.getClient();

    try {
      const model = genAI.getGenerativeModel({
        model: options.model ?? this.defaultModel,
        systemInstruction: options.systemPrompt?.trim() || undefined,
      });

      // Convert EDITH's context history to Gemini's expected format.
      // Gemini uses "model" instead of "assistant" for the AI role.
      const history =
        options.context?.map((msg) => ({
          role: msg.role === "user" ? "user" : ("model" as const),
          parts: [{ text: msg.content }],
        })) ?? [];

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(options.prompt);

      const text = result.response.text().trim();

      if (text.length === 0) {
        throw new EngineEmptyResponseError(this.name);
      }

      return text;
    } catch (error) {
      // Re-throw already-typed engine errors (e.g. EngineEmptyResponseError above).
      if (error instanceof EngineEmptyResponseError) {
        log.warn("empty response from Gemini", {
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

export const geminiEngine = new GeminiEngine();
