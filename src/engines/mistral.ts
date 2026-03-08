/**
 * @file mistral.ts
 * @description Mistral AI LLM provider.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Mistral-compatible API endpoint.
 *   Register in orchestrator.ts DEFAULT_ENGINE_CANDIDATES.
 *   Reads MISTRAL_API_KEY from config.
 */
import config from '../config.js'
import { createLogger } from '../logger.js'
import type { Engine, GenerateOptions } from './types.js'

const log = createLogger('engines.mistral')

class MistralEngine implements Engine {
  readonly name = 'mistral'
  readonly provider = 'mistral'
  readonly defaultModel = 'mistral-large-latest'

  async generate(options: GenerateOptions): Promise<string> {
    const apiKey = config.MISTRAL_API_KEY
    if (!apiKey) throw new Error('MISTRAL_API_KEY not set')

    const messages: Array<{ role: string; content: string }> = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    if (options.context) messages.push(...options.context)
    messages.push({ role: 'user', content: options.prompt })

    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      log.error('mistral api error', { status: res.status, err })
      throw new Error(`Mistral API error: ${res.status}`)
    }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  isAvailable(): boolean {
    return !!config.MISTRAL_API_KEY
  }
}

/** Singleton Mistral engine instance. */
export const mistralEngine = new MistralEngine()
