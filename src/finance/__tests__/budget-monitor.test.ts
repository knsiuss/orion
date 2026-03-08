import { describe, it, expect, vi } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { budgetMonitor } from "../budget-monitor.js"

describe("BudgetMonitor", () => {
  it("tracks budget and detects overruns", async () => {
    budgetMonitor.setBudget("owner", "food", 3_000_000)
    const spending = new Map([["food", 3_500_000]])
    const warnings = await budgetMonitor.checkOverruns("owner", spending)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("Over budget")
  })

  it("warns when nearing budget limit", async () => {
    budgetMonitor.setBudget("owner2", "transport", 1_000_000)
    const spending = new Map([["transport", 850_000]])
    const warnings = await budgetMonitor.checkOverruns("owner2", spending)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("Nearing budget")
  })

  it("returns empty when under budget", async () => {
    budgetMonitor.setBudget("owner3", "entertainment", 500_000)
    const spending = new Map([["entertainment", 100_000]])
    const warnings = await budgetMonitor.checkOverruns("owner3", spending)
    expect(warnings.length).toBe(0)
  })
})
