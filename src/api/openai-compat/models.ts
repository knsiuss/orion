/**
 * @file models.ts
 * @description GET /v1/models — OpenAI-compatible model listing.
 *
 * ARCHITECTURE:
 *   Part of the OpenAI-compatible REST surface exposed by EDITH gateway.
 *   Consumed by any client that uses OpenAI SDK pointed at EDITH.
 */
import type { FastifyInstance } from "fastify"
import { orchestrator } from "../../engines/orchestrator.js"
import { createLogger } from "../../logger.js"

const log = createLogger("api.openai-compat.models")

const STATIC_MODELS = [
  { id: "edith-1", description: "EDITH full pipeline — memory, persona, LATS" },
  { id: "edith-fast", description: "EDITH fast mode — lower latency, groq/gemini routing" },
  { id: "edith-reasoning", description: "EDITH reasoning mode — multi-step LATS planner" },
  { id: "edith-local", description: "EDITH offline mode — ollama only, no cloud" },
] as const

export function registerModels(app: FastifyInstance): void {
  app.get("/v1/models", async (_req, reply) => {
    const available = orchestrator.getAvailableEngines()
    log.debug("model listing requested", { available })
    return reply.send({
      object: "list",
      data: STATIC_MODELS.map((m) => ({
        id: m.id,
        object: "model",
        created: 1_700_000_000,
        owned_by: "edith",
        description: m.description,
      })),
    })
  })
}
