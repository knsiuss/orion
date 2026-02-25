/**
 * Orchestrator - multi-provider LLM routing with adaptive selection and fallback.
 *
 * Routes each request to the most appropriate LLM engine based on:
 *   - task type priority order
 *   - engine availability
 *   - rolling engine performance (when ENGINE_STATS_ENABLED=true)
 *   - fallback attempts when an engine errors or returns an empty response
 *
 * Supported providers: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama
 *
 * After every successful generation, lastUsedEngine is updated. Callers (pipeline)
 * read this to record accurate telemetry. Never hardcode provider names in callers.
 *
 * @module engines/orchestrator
 */

import config from "../config.js"
import { createLogger } from "../logger.js"
import { anthropicEngine } from "./anthropic.js"
import { engineStats } from "./engine-stats.js"
import { geminiEngine } from "./gemini.js"
import { groqEngine } from "./groq.js"
import { ollamaEngine } from "./ollama.js"
import { openAIEngine } from "./openai.js"
import { openRouterEngine } from "./openrouter.js"
import type { Engine, GenerateOptions, TaskType } from "./types.js"

const log = createLogger("engines.orchestrator")

const DEFAULT_ENGINE_CANDIDATES: readonly Engine[] = [
  anthropicEngine,
  openAIEngine,
  geminiEngine,
  groqEngine,
  openRouterEngine,
  ollamaEngine,
]

const PRIORITY_MAP: Record<TaskType, readonly string[]> = {
  reasoning: ["gemini", "groq", "anthropic", "openai", "openrouter", "ollama"],
  code: ["groq", "gemini", "anthropic", "openai", "openrouter", "ollama"],
  fast: ["groq", "gemini", "openrouter", "ollama", "openai", "anthropic"],
  multimodal: ["gemini", "openai", "anthropic", "openrouter"],
  local: ["ollama"],
}

type LastUsedEngine = { provider: string; model: string }

interface GenerateAttemptFailure {
  engineName: string
  error: unknown
}

export class Orchestrator {
  private readonly engines = new Map<string, Engine>()
  private lastUsed: LastUsedEngine | null = null

  /**
   * Returns the provider and model used for the most recent generate() call.
   * Returns null if no generation has occurred yet.
   */
  getLastUsedEngine(): LastUsedEngine | null {
    return this.lastUsed
  }

  async init(): Promise<void> {
    this.engines.clear()

    for (const engine of DEFAULT_ENGINE_CANDIDATES) {
      await this.registerIfAvailable(engine)
    }
  }

  getAvailableEngines(): string[] {
    return [...this.engines.keys()]
  }

  route(task: TaskType): Engine {
    const engine = this.resolveStaticRoute(task)
    if (!engine) {
      throw this.createNoEngineError(task)
    }
    return engine
  }

  async generate(task: TaskType, options: GenerateOptions): Promise<string> {
    const overallStartedAt = Date.now()
    const attempts = this.buildGeneratePlan(task)
    const failures: GenerateAttemptFailure[] = []

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const engine = attempts[attemptIndex]
      const attemptStartedAt = Date.now()

      try {
        const output = await engine.generate(options)
        const elapsedMs = Date.now() - attemptStartedAt

        if (output.trim().length === 0) {
          const error = new Error(`Engine '${engine.name}' returned an empty response`)
          throw error
        }

        engineStats.record(engine.name, elapsedMs, true)
        this.lastUsed = {
          provider: engine.provider,
          model: engine.defaultModel ?? options.model ?? "unknown",
        }

        log.info("task handled", {
          task,
          engine: engine.name,
          attempt: attemptIndex + 1,
          attempts: attempts.length,
          latencyMs: elapsedMs,
          totalLatencyMs: Date.now() - overallStartedAt,
          usedFallback: attemptIndex > 0,
          hasSystemPrompt: Boolean(options.systemPrompt?.trim()),
        })

        return output
      } catch (error) {
        const elapsedMs = Date.now() - attemptStartedAt
        engineStats.record(engine.name, elapsedMs, false)
        failures.push({ engineName: engine.name, error })

        if (attemptIndex < attempts.length - 1) {
          const isEmptyResponseError = error instanceof Error
            && error.message.includes("returned an empty response")
          log.warn(isEmptyResponseError
            ? "engine returned empty output, trying fallback"
            : "engine generation failed, trying fallback", {
            task,
            engine: engine.name,
            attempt: attemptIndex + 1,
            attempts: attempts.length,
            latencyMs: elapsedMs,
            error,
          })
          continue
        }
      }
    }

    throw this.buildExhaustedGenerateError(task, failures)
  }

  private async registerIfAvailable(engine: Engine): Promise<void> {
    try {
      const available = await Promise.resolve(engine.isAvailable())
      if (available) {
        this.engines.set(engine.name, engine)
        log.info("engine ready", { engine: engine.name, provider: engine.provider })
        return
      }

      log.info("engine unavailable", {
        engine: engine.name,
        provider: engine.provider,
      })
    } catch (error) {
      log.warn("engine availability check failed", {
        engine: engine.name,
        error,
      })
    }
  }

  private getPriorityNames(task: TaskType): readonly string[] {
    return PRIORITY_MAP[task] ?? PRIORITY_MAP.reasoning
  }

  private getAvailablePriorityNames(task: TaskType): string[] {
    return this.getPriorityNames(task).filter((engineName) => this.engines.has(engineName))
  }

  private resolveStaticRoute(task: TaskType): Engine | null {
    for (const engineName of this.getPriorityNames(task)) {
      const engine = this.engines.get(engineName)
      if (engine) {
        return engine
      }
    }
    return null
  }

  private buildGeneratePlan(task: TaskType): Engine[] {
    const availableNames = this.getAvailablePriorityNames(task)
    if (availableNames.length === 0) {
      throw this.createNoEngineError(task)
    }

    const orderedNames = config.ENGINE_STATS_ENABLED
      ? this.orderCandidatesWithAdaptiveStats(availableNames)
      : availableNames

    const engines = orderedNames
      .map((engineName) => this.engines.get(engineName))
      .filter((engine): engine is Engine => Boolean(engine))

    if (engines.length === 0) {
      throw this.createNoEngineError(task)
    }

    return engines
  }

  private orderCandidatesWithAdaptiveStats(availableNames: string[]): string[] {
    const bestEngineName = engineStats.getBestEngine(availableNames)
    return [
      bestEngineName,
      ...availableNames.filter((name) => name !== bestEngineName),
    ]
  }

  private createNoEngineError(task: TaskType): Error {
    return new Error(
      `No engine available for task '${task}'. Configure at least one provider and re-run setup.`,
    )
  }

  private buildExhaustedGenerateError(
    task: TaskType,
    failures: GenerateAttemptFailure[],
  ): Error {
    const failedEngineNames = failures.map((failure) => failure.engineName)
    const lastFailure = failures[failures.length - 1]
    const lastMessage = lastFailure?.error instanceof Error
      ? lastFailure.error.message
      : String(lastFailure?.error ?? "unknown error")

    const error = new Error(
      `All engines failed for task '${task}' (${failedEngineNames.join(", ")}). Last error: ${lastMessage}`,
    )
    ;(error as Error & { cause?: unknown }).cause = lastFailure?.error
    return error
  }
}

export const orchestrator = new Orchestrator()
