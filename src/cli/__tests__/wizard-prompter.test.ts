/**
 * @file wizard-prompter.test.ts
 * @description Unit tests for WizardPrompter types and WizardCancelledError.
 *
 * createClackPrompter() calls @clack/prompts which is TTY-interactive, so
 * we verify the interface contract and error type only — not the live clack I/O.
 */
import { describe, expect, it } from "vitest"

import { createClackPrompter, WizardCancelledError } from "../wizard-prompter.js"

describe("WizardCancelledError", () => {
  it("is an instance of Error", () => {
    const err = new WizardCancelledError()
    expect(err).toBeInstanceOf(Error)
  })

  it("has name WizardCancelledError", () => {
    expect(new WizardCancelledError().name).toBe("WizardCancelledError")
  })

  it("uses the provided message", () => {
    expect(new WizardCancelledError("risk not accepted").message).toBe("risk not accepted")
  })

  it("defaults to 'wizard cancelled' message", () => {
    expect(new WizardCancelledError().message).toBe("wizard cancelled")
  })
})

describe("createClackPrompter", () => {
  it("returns an object implementing the WizardPrompter interface", () => {
    const p = createClackPrompter()
    expect(typeof p.intro).toBe("function")
    expect(typeof p.outro).toBe("function")
    expect(typeof p.note).toBe("function")
    expect(typeof p.select).toBe("function")
    expect(typeof p.multiselect).toBe("function")
    expect(typeof p.text).toBe("function")
    expect(typeof p.confirm).toBe("function")
    expect(typeof p.progress).toBe("function")
  })

  it("progress() returns a reporter with update and stop", () => {
    // We mock stdout.write so the spinner doesn't actually render in CI
    const mockWrite = () => true
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = mockWrite as typeof process.stdout.write
    try {
      const p = createClackPrompter()
      const reporter = p.progress("Loading...")
      expect(typeof reporter.update).toBe("function")
      expect(typeof reporter.stop).toBe("function")
      reporter.stop("done")
    } finally {
      process.stdout.write = originalWrite
    }
  })
})
