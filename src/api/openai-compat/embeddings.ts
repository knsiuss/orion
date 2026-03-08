/**
 * @file embeddings.ts
 * @description OpenAI-compatible POST /v1/embeddings endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Accepts OpenAI-format embedding requests.
 *   Currently returns placeholder embeddings; real impl uses local embedding model.
 *   Enabled when OPENAI_COMPAT_API_ENABLED=true.
 */
import type { FastifyInstance } from 'fastify'
import { createLogger } from '../../logger.js'

const log = createLogger('api.openai-compat.embeddings')

/** Register OpenAI-compatible embeddings route. */
export function registerEmbeddings(app: FastifyInstance): void {
  app.post<{ Body: unknown }>('/v1/embeddings', async (req, reply) => {
    const body = req.body as { input: string | string[]; model?: string }
    const inputs = Array.isArray(body.input) ? body.input : [body.input]

    log.debug('embeddings request', { count: inputs.length })

    const data = inputs.map((_text, i) => ({
      object: 'embedding',
      index: i,
      embedding: Array.from({ length: 384 }, () => Math.random() * 0.01),
    }))

    return reply.send({
      object: 'list',
      data,
      model: body.model ?? 'edith-embed-1',
      usage: { prompt_tokens: 0, total_tokens: 0 },
    })
  })
}
