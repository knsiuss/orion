/**
 * @file together.ts
 * @description Together AI LLM provider — OpenAI-compatible API with open source models.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Together AI's OpenAI-compatible endpoint.
 *   Good for cost-effective open source model access.
 *   Reads TOGETHER_API_KEY from config.
 */
import config from '../config.js'
import { createLogger } from '../logger.js'
import type { Engine, GenerateOptions } from './types.js'

const log = createLogger('engines.together')

class TogetherEngine implements Engine {
  readonly name = 'together'
  readonly provider = 'together'
  readonly defaultModel = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'

  async generate(options: GenerateOptions): Promise<string> {
    const apiKey = config.TOGETHER_API_KEY
    if (!apiKey) throw new Error('TOGETHER_API_KEY not set')

    const messages: Array<{ role: string; content: string }> = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    if (options.context) messages.push(...options.context)
    messages.push({ role: 'user', content: options.prompt })

    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
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
      log.error('together api error', { status: res.status, err })
      throw new Error(`Together AI API error: ${res.status}`)
    }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  isAvailable(): boolean {
    return !!config.TOGETHER_API_KEY
  }
}

/** Singleton Together AI engine instance. */
export const togetherEngine = new TogetherEngine()
