/**
 * @file chat-completions.ts
 * @description OpenAI-compatible POST /v1/chat/completions endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Any OpenAI SDK client pointing to EDITH's gateway URL works transparently.
 *   Routes through EDITH's full pipeline (memory, persona, CaMeL, etc.).
 *   Enabled when OPENAI_COMPAT_API_ENABLED=true.
 */
import type { FastifyInstance } from 'fastify'
import { createLogger } from '../../logger.js'

const log = createLogger('api.openai-compat')

/** Register OpenAI-compatible chat completions and models routes. */
export function registerChatCompletions(app: FastifyInstance): void {
  app.post<{ Body: unknown }>('/v1/chat/completions', async (req, reply) => {
    const body = req.body as {
      model?: string
      messages: Array<{ role: string; content: string }>
      stream?: boolean
      max_tokens?: number
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return reply.code(400).send({
        error: { message: 'messages array required', type: 'invalid_request_error' },
      })
    }

    const lastUserMsg = body.messages.filter(m => m.role === 'user').at(-1)
    if (!lastUserMsg) {
      return reply.code(400).send({
        error: { message: 'No user message found', type: 'invalid_request_error' },
      })
    }

    const userId = (req.headers['x-user-id'] as string) || 'api-user'

    try {
      const { processMessage } = await import('../../core/message-pipeline.js')
      const result = await processMessage(userId, lastUserMsg.content, {
        channel: 'openai-compat-api',
      })

      const responseText =
        typeof result === 'string' ? result : (result as { response: string }).response

      log.debug('openai-compat request processed', { userId, model: body.model })

      return reply.send({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'edith-1',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    } catch (err) {
      log.error('openai-compat pipeline error', { userId, err })
      return reply.code(500).send({ error: { message: 'Internal server error', type: 'server_error' } })
    }
  })
}
