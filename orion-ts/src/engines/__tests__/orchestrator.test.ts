import { afterEach, beforeEach, describe, expect, it } from "vitest"

import config from "../../config.js"
import { engineStats } from "../engine-stats.js"
import { Orchestrator } from "../orchestrator.js"
import type { Engine, GenerateOptions } from "../types.js"

type EngineBehavior = (options: GenerateOptions) => Promise<string>

function makeEngine(name: string, behavior: EngineBehavior): Engine {
  return {
    name,
    provider: `${name}-provider`,
    defaultModel: `${name}-model`,
    isAvailable: () => true,
    generate: behavior,
  }
}

function installEngines(orchestrator: Orchestrator, engines: Engine[]): void {
  const engineMap = (orchestrator as unknown as { engines: Map<string, Engine> }).engines
  engineMap.clear()
  for (const engine of engines) {
    engineMap.set(engine.name, engine)
  }
}

describe("Orchestrator", () => {
  let originalEngineStatsEnabled: boolean

  beforeEach(() => {
    originalEngineStatsEnabled = config.ENGINE_STATS_ENABLED
    config.ENGINE_STATS_ENABLED = false
    engineStats.reset()
  })

  afterEach(() => {
    config.ENGINE_STATS_ENABLED = originalEngineStatsEnabled
    engineStats.reset()
  })

  it("routes to OpenRouter when it is the only available reasoning engine", () => {
    const orchestrator = new Orchestrator()
    const openRouter = makeEngine("openrouter", async () => "ok")
    installEngines(orchestrator, [openRouter])

    const selected = orchestrator.route("reasoning")

    expect(selected.name).toBe("openrouter")
  })

  it("falls back to the next engine when the first engine throws", async () => {
    const orchestrator = new Orchestrator()
    const groq = makeEngine("groq", async () => {
      throw new Error("groq unavailable")
    })
    const openRouter = makeEngine("openrouter", async () => "fallback response")
    installEngines(orchestrator, [groq, openRouter])

    const output = await orchestrator.generate("reasoning", { prompt: "hello" })

    expect(output).toBe("fallback response")
    expect(orchestrator.getLastUsedEngine()).toEqual({
      provider: "openrouter-provider",
      model: "openrouter-model",
    })
  })

  it("falls back when an engine returns an empty response", async () => {
    const orchestrator = new Orchestrator()
    const groq = makeEngine("groq", async () => "   ")
    const openRouter = makeEngine("openrouter", async () => "recovered")
    installEngines(orchestrator, [groq, openRouter])

    const output = await orchestrator.generate("reasoning", { prompt: "hello" })

    expect(output).toBe("recovered")
    const groqMetrics = engineStats.getMetrics("groq")
    const openRouterMetrics = engineStats.getMetrics("openrouter")
    expect(groqMetrics.callCount).toBe(1)
    expect(groqMetrics.errorRate).toBe(1)
    expect(openRouterMetrics.callCount).toBe(1)
    expect(openRouterMetrics.errorRate).toBe(0)
  })
})
