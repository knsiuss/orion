/**
 * @file models.ts
 * @description OpenAI-compatible GET /v1/models endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Returns the list of available EDITH engines in the OpenAI models format.
 *   Any OpenAI SDK client can enumerate available models via this endpoint.
 *   Enabled when OPENAI_COMPAT_API_ENABLED=true (registered alongside chat-completions).
 */
import type { FastifyInstance } from "fastify"
import { orchestrator } from "../../engines/orchestrator.js"
import { createLogger } from "../../logger.js"

const log = createLogger("api.openai-compat.models")

/** OpenAI-compatible model object. */
interface ModelObject {
  id: string
  object: "model"
  created: number
  owned_by: string
}

/** Register the GET /v1/models route on the given Fastify instance. */
export function registerModels(app: FastifyInstance): void {
  app.get("/v1/models", async (_req, reply) => {
    const available = orchestrator.getAvailableEngines()
    const created = Math.floor(Date.now() / 1000)

    const models: ModelObject[] = [
      // Always expose EDITH's virtual model aliases
      { id: "edith-1", object: "model", created, owned_by: "edith" },
      { id: "edith-fast", object: "model", created, owned_by: "edith" },
      { id: "edith-reasoning", object: "model", created, owned_by: "edith" },
      // Expose each available backend engine as a selectable model
      ...available.map((name): ModelObject => ({
        id: `edith-${name}`,
        object: "model",
        created,
        owned_by: "edith",
      })),
    ]

    log.debug("models listed", { count: models.length })

    return reply.send({ object: "list", data: models })
  })
}
