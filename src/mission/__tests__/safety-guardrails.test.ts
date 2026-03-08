/**
 * @file safety-guardrails.test.ts
 * @description Tests for SafetyGuardrails — pre-execution step safety enforcement.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { SafetyGuardrails } from "../safety-guardrails.js"
import type { MissionStep } from "../mission-schema.js"

/** Helper to create a test MissionStep. */
function makeStep(toolName: string, params: Record<string, unknown> = {}): MissionStep {
  return {
    id: "step_1",
    description: `Test step using ${toolName}`,
    toolName,
    params,
    dependsOn: [],
    maxRetries: 2,
    retryCount: 0,
    status: "pending",
  }
}

describe("SafetyGuardrails", () => {
  let guardrails: SafetyGuardrails

  beforeEach(() => {
    guardrails = new SafetyGuardrails()
  })

  describe("check() — blocked tools", () => {
    it("blocks system_exec tool", () => {
      const result = guardrails.check(makeStep("system_exec"))
      expect(result.allowed).toBe(false)
      expect(result.requiresApproval).toBe(false)
      expect(result.riskLevel).toBe("critical")
    })

    it("blocks shell_exec tool", () => {
      const result = guardrails.check(makeStep("shell_exec"))
      expect(result.allowed).toBe(false)
    })

    it("blocks bash tool", () => {
      const result = guardrails.check(makeStep("bash"))
      expect(result.allowed).toBe(false)
    })

    it("blocks eval tool", () => {
      const result = guardrails.check(makeStep("eval"))
      expect(result.allowed).toBe(false)
    })

    it("blocks file_delete tool", () => {
      const result = guardrails.check(makeStep("file_delete"))
      expect(result.allowed).toBe(false)
    })

    it("blocks db_drop tool", () => {
      const result = guardrails.check(makeStep("db_drop"))
      expect(result.allowed).toBe(false)
    })

    it("returns reason for blocked tools", () => {
      const result = guardrails.check(makeStep("bash"))
      expect(result.reason).toBeTruthy()
      expect(typeof result.reason).toBe("string")
    })
  })

  describe("check() — high-risk tools requiring approval", () => {
    it("allows email_send but requires approval", () => {
      const result = guardrails.check(makeStep("email_send", { to: ["user@example.com"] }))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(true)
      expect(result.riskLevel).toBe("high")
    })

    it("allows file_write but requires approval", () => {
      const result = guardrails.check(makeStep("file_write", { path: "/tmp/test.txt" }))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(true)
    })

    it("provides risk description for high-risk tools", () => {
      const result = guardrails.check(makeStep("email_send"))
      expect(result.riskDescription).toBeTruthy()
    })

    it("categorizes email tools as external_comms", () => {
      const result = guardrails.check(makeStep("email_send"))
      expect(result.riskCategory).toBe("external_comms")
    })

    it("categorizes financial tools as financial", () => {
      const result = guardrails.check(makeStep("financial_transfer"))
      expect(result.riskCategory).toBe("financial")
    })
  })

  describe("check() — safe tools", () => {
    it("allows web_search without approval", () => {
      const result = guardrails.check(makeStep("web_search", { query: "hello" }))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })

    it("allows memory_save without approval", () => {
      const result = guardrails.check(makeStep("memory_save", { content: "test" }))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })

    it("allows llm_reasoning without approval", () => {
      const result = guardrails.check(makeStep("llm_reasoning", { goal: "analyze" }))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })

    it("allows noop without approval", () => {
      const result = guardrails.check(makeStep("noop"))
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })
  })

  describe("check() — param safety", () => {
    it("blocks steps with shell injection in params", () => {
      const result = guardrails.check(makeStep("web_search", { query: "test; rm -rf /" }))
      expect(result.allowed).toBe(false)
    })

    it("blocks steps with backtick injection in params", () => {
      const result = guardrails.check(makeStep("memory_save", { content: "`ls -la`" }))
      expect(result.allowed).toBe(false)
    })

    it("allows normal params without injection", () => {
      const result = guardrails.check(makeStep("web_search", { query: "how to cook pasta" }))
      expect(result.allowed).toBe(true)
    })
  })
})
