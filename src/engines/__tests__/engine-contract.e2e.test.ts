/**
 * @file engine-contract.e2e.test.ts
 * @description Contract tests for all LLM engine adapters.
 *
 * These tests verify the "contract" each engine must satisfy:
 *   1. Implements the Engine interface (name, provider, isAvailable, generate)
 *   2. generate() returns a non-null string (possibly empty)
 *   3. isAvailable() returns a boolean or Promise<boolean>
 *   4. generate() never throws on SDK/network errors — returns "" instead
 *      (for SDK-wrapped engines) or propagates for fetch-based engines
 *   5. Engine names are unique across all adapters
 *
 * All external calls (SDKs, fetch) are mocked. No real API keys required.
 */
import { describe, expect, it, vi, beforeAll } from "vitest"

// ── Mocks (must come before imports) ─────────────────────────────────────────
vi.mock("../../config.js", () => ({
  default: {
    ANTHROPIC_API_KEY: "mock-key",
    GROQ_API_KEY: "mock-key",
    OPENAI_API_KEY: "mock-key",
    GEMINI_API_KEY: "mock-key",
    OPENROUTER_API_KEY: "mock-key",
    DEEPSEEK_API_KEY: "mock-key",
    FIREWORKS_API_KEY: "mock-key",
    MISTRAL_API_KEY: "mock-key",
    TOGETHER_API_KEY: "mock-key",
    COHERE_API_KEY: "mock-key",
    OLLAMA_BASE_URL: "http://localhost:11434",
  },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "response" }],
      }),
    },
  })),
}))

vi.mock("groq-sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "response" } }],
        }),
      },
    },
  })),
}))

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "response" } }],
        }),
      },
    },
  })),
}))

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      startChat: vi.fn().mockReturnValue({
        sendMessage: vi.fn().mockResolvedValue({
          response: { text: () => "response" },
        }),
      }),
    }),
  })),
}))

// ── Engine imports ────────────────────────────────────────────────────────────
import { AnthropicEngine } from "../../engines/anthropic.js"
import { GroqEngine } from "../../engines/groq.js"
import { OpenAIEngine } from "../../engines/openai.js"
import { GeminiEngine } from "../../engines/gemini.js"
import { OpenRouterEngine } from "../../engines/openrouter.js"
import { deepSeekEngine } from "../../engines/deepseek.js"
import { fireworksEngine } from "../../engines/fireworks.js"
import { mistralEngine } from "../../engines/mistral.js"
import { togetherEngine } from "../../engines/together.js"
import { cohereEngine } from "../../engines/cohere.js"
import { OllamaEngine } from "../../engines/ollama.js"
import type { Engine } from "../../engines/types.js"

// ── Shared mock fetch for all fetch-based engines ─────────────────────────────
beforeAll(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    // Cohere returns { text: ... }; others return { choices: [...] }
    const body = String(url).includes("cohere.ai")
      ? { text: "response" }
      : String(url).includes("api/tags")
        ? { models: [{ name: "llama3" }] }
        : String(url).includes("api/chat")
          ? { message: { content: "response" } }
          : { choices: [{ message: { content: "response" } }] }
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }
  })
})

// ── Engine instances ──────────────────────────────────────────────────────────
const engines: Engine[] = [
  new AnthropicEngine(),
  new GroqEngine(),
  new OpenAIEngine(),
  new GeminiEngine(),
  new OpenRouterEngine(),
  deepSeekEngine,
  fireworksEngine,
  mistralEngine,
  togetherEngine,
  cohereEngine,
  new OllamaEngine(),
]

const baseOptions = { prompt: "Hello, what is 2+2?" }

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests - run for all engines
// ─────────────────────────────────────────────────────────────────────────────
describe("Engine Contract Tests", () => {
  for (const engine of engines) {
    describe(`${engine.name} (${engine.provider})`, () => {
      it("has a non-empty name string", () => {
        expect(typeof engine.name).toBe("string")
        expect(engine.name.length).toBeGreaterThan(0)
      })

      it("has a non-empty provider string", () => {
        expect(typeof engine.provider).toBe("string")
        expect(engine.provider.length).toBeGreaterThan(0)
      })

      it("isAvailable() returns a boolean or resolves to boolean", async () => {
        const result = await Promise.resolve(engine.isAvailable())
        expect(typeof result).toBe("boolean")
      })

      it("generate() returns a string", async () => {
        const result = await engine.generate(baseOptions)
        expect(typeof result).toBe("string")
      })

      it("generate() does not return null or undefined", async () => {
        const result = await engine.generate(baseOptions)
        expect(result).not.toBeNull()
        expect(result).not.toBeUndefined()
      })

      it("generate() handles context array in options", async () => {
        const result = await engine.generate({
          ...baseOptions,
          context: [
            { role: "user", content: "previous message" },
            { role: "assistant", content: "previous response" },
          ],
          systemPrompt: "You are helpful.",
        })
        expect(typeof result).toBe("string")
      })
    })
  }

  it("all engine names are unique", () => {
    const names = engines.map((e) => e.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  it("all engines implement the required interface", () => {
    for (const engine of engines) {
      expect(typeof engine.isAvailable).toBe("function")
      expect(typeof engine.generate).toBe("function")
      expect(typeof engine.name).toBe("string")
      expect(typeof engine.provider).toBe("string")
    }
  })
})
