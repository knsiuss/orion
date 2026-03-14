/** Per-model context window and capability metadata. */
export interface ModelInfo {
  contextWindow: number
}

export interface EngineModelCatalogEntry {
  displayName: string
  models: string[]
  modelInfo?: Record<string, ModelInfo>
}

export const ENGINE_MODEL_CATALOG: Record<string, EngineModelCatalogEntry> = {
  anthropic: {
    displayName: "Anthropic",
    models: ["claude-sonnet-4-20250514"],
  },
  gemini: {
    displayName: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
  },
  groq: {
    displayName: "Groq",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  ollama: {
    displayName: "Ollama",
    models: ["llama3.2", "qwen2.5", "phi4-mini"],
  },
  openai: {
    displayName: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini"],
  },
  openrouter: {
    displayName: "OpenRouter",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o-mini"],
  },
}

export interface ModelPreference {
  engine: string
  model?: string
}

class ModelPreferencesStore {
  private readonly preferences = new Map<string, ModelPreference>()

  get(userId: string): ModelPreference | null {
    return this.preferences.get(userId) ?? null
  }

  setEngine(userId: string, engine: string): ModelPreference {
    const next = { engine }
    this.preferences.set(userId, next)
    return next
  }

  setModel(userId: string, engine: string, model: string): ModelPreference {
    const next = { engine, model }
    this.preferences.set(userId, next)
    return next
  }

  reset(userId: string): void {
    this.preferences.delete(userId)
  }
}

export const modelPreferences = new ModelPreferencesStore()