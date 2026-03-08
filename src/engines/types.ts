/**
 * @file types.ts
 * @description Core type definitions and interfaces for the LLM engine layer.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Defines GenerateOptions, GenerateResult, Engine interface, and TaskType used
 *   across all engine adapters (anthropic.ts, openai.ts, groq.ts, etc.) and by
 *   orchestrator.ts for routing decisions.
 */
export interface GenerateOptions {
  prompt: string
  context?: Array<{ role: "user" | "assistant"; content: string }>
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  model?: string
}

export interface Engine {
  readonly name: string
  readonly provider: string
  /** Default model identifier used by this engine (e.g., "llama-3.3-70b-versatile") */
  readonly defaultModel?: string
  isAvailable(): boolean | Promise<boolean>
  generate(options: GenerateOptions): Promise<string>
}

export type TaskType = "reasoning" | "code" | "fast" | "multimodal" | "local"

export interface EngineRoute {
  task: TaskType
  priority: string[]
}
