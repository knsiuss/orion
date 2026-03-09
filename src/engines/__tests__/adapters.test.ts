/**
 * @file adapters.test.ts
 * @description Unit tests for all LLM engine adapters.
 *
 * Tests isAvailable() (config-key gating) and generate() (happy path + error
 * handling) for every Engine implementation. External SDK calls and fetch() are
 * fully mocked so no API keys or network access are required.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"

// ── Config mock (must be before engine imports) ──────────────────────────────
vi.mock("../../config.js", () => ({
  default: {
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GROQ_API_KEY: "test-groq-key",
    OPENAI_API_KEY: "test-openai-key",
    GEMINI_API_KEY: "test-gemini-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    DEEPSEEK_API_KEY: "test-deepseek-key",
    FIREWORKS_API_KEY: "test-fireworks-key",
    MISTRAL_API_KEY: "test-mistral-key",
    TOGETHER_API_KEY: "test-together-key",
    COHERE_API_KEY: "test-cohere-key",
    OLLAMA_BASE_URL: "http://localhost:11434",
  },
}))

// ── SDK mocks ─────────────────────────────────────────────────────────────────
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(),
}))

vi.mock("groq-sdk", () => ({
  default: vi.fn(),
}))

vi.mock("openai", () => ({
  default: vi.fn(),
}))

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk"
import Groq from "groq-sdk"
import OpenAI from "openai"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { AnthropicEngine } from "../anthropic.js"
import { GroqEngine } from "../groq.js"
import { OpenAIEngine } from "../openai.js"
import { GeminiEngine } from "../gemini.js"
import { OpenRouterEngine } from "../openrouter.js"
import { deepSeekEngine } from "../deepseek.js"
import { fireworksEngine } from "../fireworks.js"
import { mistralEngine } from "../mistral.js"
import { togetherEngine } from "../together.js"
import { cohereEngine } from "../cohere.js"
import { OllamaEngine } from "../ollama.js"
import config from "../../config.js"

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildFetchMock(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

const baseOptions = { prompt: "Hello", systemPrompt: "You are helpful." }

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
// ─────────────────────────────────────────────────────────────────────────────
describe("AnthropicEngine", () => {
  let engine: AnthropicEngine

  beforeEach(() => {
    engine = new AnthropicEngine()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hi from Anthropic" }],
    })
    vi.mocked(Anthropic).mockImplementation(function () {
      return { messages: { create: createFn } } as unknown as Anthropic
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(engine.isAvailable()).toBe(true)
  })

  it("isAvailable() returns false when API key is empty", () => {
    const saved = (config as unknown as Record<string, string>).ANTHROPIC_API_KEY
    ;(config as unknown as Record<string, string>).ANTHROPIC_API_KEY = ""
    expect(engine.isAvailable()).toBe(false)
    ;(config as unknown as Record<string, string>).ANTHROPIC_API_KEY = saved
  })

  it("generate() returns text from Anthropic response", async () => {
    const result = await engine.generate(baseOptions)
    expect(result).toBe("Hi from Anthropic")
  })

  it("generate() returns empty string when unavailable", async () => {
    const saved = (config as unknown as Record<string, string>).ANTHROPIC_API_KEY
    ;(config as unknown as Record<string, string>).ANTHROPIC_API_KEY = ""
    const result = await engine.generate(baseOptions)
    expect(result).toBe("")
    ;(config as unknown as Record<string, string>).ANTHROPIC_API_KEY = saved
  })

  it("generate() returns empty string on SDK error", async () => {
    vi.mocked(Anthropic).mockImplementation(function () {
      return { messages: { create: vi.fn().mockRejectedValue(new Error("API error")) } } as unknown as Anthropic
    })
    const result = await engine.generate(baseOptions)
    expect(result).toBe("")
  })

  it("engine has correct name and provider", () => {
    expect(engine.name).toBe("anthropic")
    expect(engine.provider).toBe("anthropic")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Groq
// ─────────────────────────────────────────────────────────────────────────────
describe("GroqEngine", () => {
  let engine: GroqEngine

  beforeEach(() => {
    engine = new GroqEngine()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Hi from Groq" } }],
    })
    vi.mocked(Groq).mockImplementation(function () {
      return { chat: { completions: { create: createFn } } } as unknown as Groq
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(engine.isAvailable()).toBe(true)
  })

  it("generate() returns text from Groq response", async () => {
    const result = await engine.generate(baseOptions)
    expect(result).toBe("Hi from Groq")
  })

  it("generate() includes context messages", async () => {
    const createSpy = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    })
    vi.mocked(Groq).mockImplementation(function () {
      return { chat: { completions: { create: createSpy } } } as unknown as Groq
    })

    await engine.generate({
      prompt: "follow-up",
      systemPrompt: "Be helpful",
      context: [{ role: "user", content: "first" }, { role: "assistant", content: "response" }],
    })

    const call = createSpy.mock.calls[0]?.[0]
    expect(call?.messages[0]).toEqual({ role: "system", content: "Be helpful" })
    expect(call?.messages.at(-1)).toEqual({ role: "user", content: "follow-up" })
  })

  it("generate() returns empty string on SDK error", async () => {
    vi.mocked(Groq).mockImplementation(function () {
      return { chat: { completions: { create: vi.fn().mockRejectedValue(new Error("fail")) } } } as unknown as Groq
    })
    expect(await engine.generate(baseOptions)).toBe("")
  })

  it("engine has correct name and provider", () => {
    expect(engine.name).toBe("groq")
    expect(engine.provider).toBe("groq")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenAIEngine", () => {
  let engine: OpenAIEngine

  beforeEach(() => {
    engine = new OpenAIEngine()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Hi from OpenAI" } }],
    })
    vi.mocked(OpenAI).mockImplementation(function () {
      return { chat: { completions: { create: createFn } } } as unknown as OpenAI
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(engine.isAvailable()).toBe(true)
  })

  it("generate() returns text from OpenAI response", async () => {
    expect(await engine.generate(baseOptions)).toBe("Hi from OpenAI")
  })

  it("generate() returns empty string on SDK error", async () => {
    vi.mocked(OpenAI).mockImplementation(function () {
      return { chat: { completions: { create: vi.fn().mockRejectedValue(new Error("fail")) } } } as unknown as OpenAI
    })
    expect(await engine.generate(baseOptions)).toBe("")
  })

  it("engine has correct name and provider", () => {
    expect(engine.name).toBe("openai")
    expect(engine.provider).toBe("openai")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────────────────────
describe("GeminiEngine", () => {
  let engine: GeminiEngine
  let sendMessageMock: ReturnType<typeof vi.fn>
  let startChatMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    engine = new GeminiEngine()
    sendMessageMock = vi.fn().mockResolvedValue({
      response: { text: () => "Hi from Gemini" },
    })
    startChatMock = vi.fn().mockReturnValue({ sendMessage: sendMessageMock })
    const localStartChat = startChatMock
    vi.mocked(GoogleGenerativeAI).mockImplementation(function () {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({ startChat: localStartChat }),
      } as unknown as GoogleGenerativeAI
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(engine.isAvailable()).toBe(true)
  })

  it("generate() returns text from Gemini response", async () => {
    expect(await engine.generate(baseOptions)).toBe("Hi from Gemini")
  })

  it("generate() passes context as history", async () => {
    await engine.generate({
      prompt: "Hello",
      context: [{ role: "user", content: "prev" }, { role: "assistant", content: "resp" }],
    })
    const chatArg = startChatMock.mock.calls[0]?.[0]
    expect(chatArg?.history).toHaveLength(2)
    expect(chatArg?.history[1]?.role).toBe("model")
  })

  it("generate() returns empty string on SDK error", async () => {
    vi.mocked(GoogleGenerativeAI).mockImplementation(function () {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({
          startChat: vi.fn().mockReturnValue({
            sendMessage: vi.fn().mockRejectedValue(new Error("fail")),
          }),
        }),
      } as unknown as GoogleGenerativeAI
    })
    expect(await engine.generate(baseOptions)).toBe("")
  })

  it("engine has correct name and provider", () => {
    expect(engine.name).toBe("gemini")
    expect(engine.provider).toBe("google")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenRouterEngine", () => {
  let engine: OpenRouterEngine

  beforeEach(() => {
    engine = new OpenRouterEngine()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Hi from OpenRouter" } }],
    })
    vi.mocked(OpenAI).mockImplementation(function () {
      return { chat: { completions: { create: createFn } } } as unknown as OpenAI
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(engine.isAvailable()).toBe(true)
  })

  it("generate() returns OpenRouter response text", async () => {
    expect(await engine.generate(baseOptions)).toBe("Hi from OpenRouter")
  })

  it("generate() uses OpenRouter baseURL", async () => {
    const constructorSpy = vi.mocked(OpenAI)
    await engine.generate(baseOptions)
    expect(constructorSpy.mock.calls[0]?.[0]).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
    })
  })

  it("generate() returns empty string on SDK error", async () => {
    vi.mocked(OpenAI).mockImplementation(function () {
      return { chat: { completions: { create: vi.fn().mockRejectedValue(new Error("fail")) } } } as unknown as OpenAI
    })
    expect(await engine.generate(baseOptions)).toBe("")
  })

  it("engine name and provider are correct", () => {
    expect(engine.name).toBe("openrouter")
    expect(engine.provider).toBe("openrouter")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek (fetch-based)
// ─────────────────────────────────────────────────────────────────────────────
describe("DeepSeekEngine", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock({
      choices: [{ message: { content: "Hi from DeepSeek" } }],
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(deepSeekEngine.isAvailable()).toBe(true)
  })

  it("generate() returns text from response", async () => {
    expect(await deepSeekEngine.generate(baseOptions)).toBe("Hi from DeepSeek")
  })

  it("generate() calls DeepSeek endpoint", async () => {
    await deepSeekEngine.generate(baseOptions)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("deepseek.com"),
      expect.any(Object),
    )
  })

  it("generate() throws on HTTP error", async () => {
    global.fetch = buildFetchMock({ error: "bad" }, false, 401)
    await expect(deepSeekEngine.generate(baseOptions)).rejects.toThrow("DeepSeek API error")
  })

  it("engine name and provider are correct", () => {
    expect(deepSeekEngine.name).toBe("deepseek")
    expect(deepSeekEngine.provider).toBe("deepseek")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fireworks (fetch-based)
// ─────────────────────────────────────────────────────────────────────────────
describe("FireworksEngine", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock({
      choices: [{ message: { content: "Hi from Fireworks" } }],
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(fireworksEngine.isAvailable()).toBe(true)
  })

  it("generate() returns text from response", async () => {
    expect(await fireworksEngine.generate(baseOptions)).toBe("Hi from Fireworks")
  })

  it("generate() calls Fireworks endpoint", async () => {
    await fireworksEngine.generate(baseOptions)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("fireworks.ai"),
      expect.any(Object),
    )
  })

  it("generate() throws on HTTP error", async () => {
    global.fetch = buildFetchMock({ error: "bad" }, false, 500)
    await expect(fireworksEngine.generate(baseOptions)).rejects.toThrow("Fireworks API error")
  })

  it("engine name and provider are correct", () => {
    expect(fireworksEngine.name).toBe("fireworks")
    expect(fireworksEngine.provider).toBe("fireworks")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Mistral (fetch-based)
// ─────────────────────────────────────────────────────────────────────────────
describe("MistralEngine", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock({
      choices: [{ message: { content: "Hi from Mistral" } }],
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(mistralEngine.isAvailable()).toBe(true)
  })

  it("generate() returns text from response", async () => {
    expect(await mistralEngine.generate(baseOptions)).toBe("Hi from Mistral")
  })

  it("generate() calls Mistral endpoint", async () => {
    await mistralEngine.generate(baseOptions)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("mistral.ai"),
      expect.any(Object),
    )
  })

  it("generate() throws on HTTP error", async () => {
    global.fetch = buildFetchMock({ error: "bad" }, false, 429)
    await expect(mistralEngine.generate(baseOptions)).rejects.toThrow("Mistral API error")
  })

  it("engine name and provider are correct", () => {
    expect(mistralEngine.name).toBe("mistral")
    expect(mistralEngine.provider).toBe("mistral")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Together AI (fetch-based)
// ─────────────────────────────────────────────────────────────────────────────
describe("TogetherEngine", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock({
      choices: [{ message: { content: "Hi from Together" } }],
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(togetherEngine.isAvailable()).toBe(true)
  })

  it("generate() returns text from response", async () => {
    expect(await togetherEngine.generate(baseOptions)).toBe("Hi from Together")
  })

  it("generate() calls Together endpoint", async () => {
    await togetherEngine.generate(baseOptions)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("together.xyz"),
      expect.any(Object),
    )
  })

  it("generate() throws on HTTP error", async () => {
    global.fetch = buildFetchMock({ error: "bad" }, false, 503)
    await expect(togetherEngine.generate(baseOptions)).rejects.toThrow("Together AI API error")
  })

  it("engine name and provider are correct", () => {
    expect(togetherEngine.name).toBe("together")
    expect(togetherEngine.provider).toBe("together")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cohere (fetch-based, different response shape)
// ─────────────────────────────────────────────────────────────────────────────
describe("CohereEngine", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock({ text: "Hi from Cohere" })
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when API key is set", () => {
    expect(cohereEngine.isAvailable()).toBe(true)
  })

  it("generate() returns text from Cohere response", async () => {
    expect(await cohereEngine.generate(baseOptions)).toBe("Hi from Cohere")
  })

  it("generate() calls Cohere API endpoint", async () => {
    await cohereEngine.generate(baseOptions)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("cohere.ai"),
      expect.any(Object),
    )
  })

  it("generate() throws on HTTP error", async () => {
    global.fetch = buildFetchMock({ message: "unauthorized" }, false, 401)
    await expect(cohereEngine.generate(baseOptions)).rejects.toThrow("Cohere API error")
  })

  it("engine name and provider are correct", () => {
    expect(cohereEngine.name).toBe("cohere")
    expect(cohereEngine.provider).toBe("cohere")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ollama (fetch-based, local)
// ─────────────────────────────────────────────────────────────────────────────
describe("OllamaEngine", () => {
  let engine: OllamaEngine

  beforeEach(() => {
    engine = new OllamaEngine()
  })

  afterEach(() => vi.restoreAllMocks())

  it("isAvailable() returns true when /api/tags responds 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    expect(await engine.isAvailable()).toBe(true)
  })

  it("isAvailable() returns false when /api/tags fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    expect(await engine.isAvailable()).toBe(false)
  })

  it("generate() returns model content", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [{ name: "llama3" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: { content: "Hi from Ollama" } }),
      })

    expect(await engine.generate(baseOptions)).toBe("Hi from Ollama")
  })

  it("generate() uses provided model option without calling /api/tags", async () => {
    global.fetch = buildFetchMock({ message: { content: "Hi Ollama" } })
    await engine.generate({ prompt: "hi", model: "phi3" })
    // Only one fetch call (chat), not two (tags + chat)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("generate() returns empty string when no models available", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ models: [] }),
    })
    expect(await engine.generate(baseOptions)).toBe("")
  })

  it("generate() returns empty string on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network fail"))
    expect(await engine.generate({ prompt: "hi", model: "llama3" })).toBe("")
  })

  it("engine name and provider are correct", () => {
    expect(engine.name).toBe("ollama")
    expect(engine.provider).toBe("ollama")
  })
})
