/**
 * @file cohere.ts
 * @description Cohere AI LLM provider — Command R+ model.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Cohere's native chat API (different from OpenAI format).
 *   Command R+ is optimized for RAG and tool use.
 *   Reads COHERE_API_KEY from config.
 */
import config from '../config.js'
import { createLogger } from '../logger.js'
import type { Engine, GenerateOptions } from './types.js'

const log = createLogger('engines.cohere')

class CohereEngine implements Engine {
  readonly name = 'cohere'
  readonly provider = 'cohere'
  readonly defaultModel = 'command-r-plus'

  async generate(options: GenerateOptions): Promise<string> {
    const apiKey = config.COHERE_API_KEY
    if (!apiKey) throw new Error('COHERE_API_KEY not set')

    const res = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        message: options.prompt,
        preamble: options.systemPrompt,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      log.error('cohere api error', { status: res.status, err })
      throw new Error(`Cohere API error: ${res.status}`)
    }
    const data = await res.json() as { text: string }
    return data.text ?? ''
  }

  isAvailable(): boolean {
    return !!config.COHERE_API_KEY
  }
}

/** Singleton Cohere engine instance. */
export const cohereEngine = new CohereEngine()
