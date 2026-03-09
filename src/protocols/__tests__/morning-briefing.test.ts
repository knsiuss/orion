/**
 * @file morning-briefing.test.ts
 * @description Unit/integration tests for protocols\.__tests__\.morning-briefing.test.ts.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: { generate: vi.fn().mockResolvedValue("Good morning, Sir.") },
}))

vi.mock("../../memory/store.js", () => ({
  memory: { save: vi.fn().mockResolvedValue(undefined) },
}))

import { morningBriefing } from "../morning-briefing.js"

describe("MorningBriefingProtocol", () => {
  it("delivers a briefing for a user", async () => {
    const result = await morningBriefing.deliver("owner")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})
