/**
 * @file fireworks.ts
 * @description Fireworks AI LLM provider — fast inference, OpenAI-compatible.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Fireworks AI's OpenAI-compatible inference endpoint.
 *   Specialized for fast open-source model inference.
 *   Reads FIREWORKS_API_KEY from config.
 */
import config from '../config.js'
import { createLogger } from '../logger.js'
import type { Engine, GenerateOptions } from './types.js'

const log = createLogger('engines.fireworks')

class FireworksEngine implements Engine {
  readonly name = 'fireworks'
  readonly provider = 'fireworks'
  readonly defaultModel = 'accounts/fireworks/models/llama-v3p1-70b-instruct'

  async generate(options: GenerateOptions): Promise<string> {
    const apiKey = config.FIREWORKS_API_KEY
    if (!apiKey) throw new Error('FIREWORKS_API_KEY not set')

    const messages: Array<{ role: string; content: string }> = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    if (options.context) messages.push(...options.context)
    messages.push({ role: 'user', content: options.prompt })

    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
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
      log.error('fireworks api error', { status: res.status, err })
      throw new Error(`Fireworks API error: ${res.status}`)
    }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  isAvailable(): boolean {
    return !!config.FIREWORKS_API_KEY
  }
}

/** Singleton Fireworks AI engine instance. */
export const fireworksEngine = new FireworksEngine()
