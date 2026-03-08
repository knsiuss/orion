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
  orchestrator: { generate: vi.fn().mockResolvedValue("Good evening, Sir.") },
}))

vi.mock("../../memory/store.js", () => ({
  memory: { save: vi.fn().mockResolvedValue(undefined) },
}))

import { eveningSummary } from "../evening-summary.js"

describe("EveningSummaryProtocol", () => {
  it("delivers an evening summary", async () => {
    const result = await eveningSummary.deliver("owner")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})
