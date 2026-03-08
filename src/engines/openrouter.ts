/**
 * @file openrouter.ts
 * @description OpenRouter engine adapter — routes requests through OpenRouter's unified API using the OpenAI-compatible client.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements Engine from ./types.ts. Registered in orchestrator.ts as a fallback
 *   provider that gives access to many models via a single API key. Reads credentials
 *   and model selection from src/config.ts.
 */
import OpenAI from "openai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.openrouter")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() })
  }

  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class OpenRouterEngine implements Engine {
  readonly name = "openrouter"
  readonly provider = "openrouter"
  readonly defaultModel = "anthropic/claude-sonnet-4"

  isAvailable(): boolean {
    return config.OPENROUTER_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new OpenAI({
        apiKey: config.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      })

      const response = await client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: toMessages(options),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      })

      return response.choices[0]?.message?.content ?? ""
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const openRouterEngine = new OpenRouterEngine()
