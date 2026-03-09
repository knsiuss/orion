/**
 * @file tagline.test.ts
 * @description Unit tests for pickTagline — mirrors openclaw's tagline.test.ts pattern.
 */
import { describe, expect, it } from "vitest"

import { DEFAULT_TAGLINE, pickTagline } from "../tagline.js"

describe("pickTagline", () => {
  it("returns empty string when mode is off", () => {
    expect(pickTagline({ mode: "off" })).toBe("")
  })

  it("returns DEFAULT_TAGLINE when mode is default", () => {
    expect(pickTagline({ mode: "default" })).toBe(DEFAULT_TAGLINE)
  })

  it("returns DEFAULT_TAGLINE when called with no arguments", () => {
    expect(pickTagline()).toBe(DEFAULT_TAGLINE)
  })

  it("returns a non-empty tagline in random mode", () => {
    const result = pickTagline({ mode: "random" })
    expect(result.length).toBeGreaterThan(0)
  })

  it("is deterministic in random mode when EDITH_TAGLINE_INDEX is set", () => {
    const first = pickTagline({ mode: "random", env: { EDITH_TAGLINE_INDEX: "3" } as NodeJS.ProcessEnv })
    const second = pickTagline({ mode: "random", env: { EDITH_TAGLINE_INDEX: "3" } as NodeJS.ProcessEnv })
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it("handles out-of-range EDITH_TAGLINE_INDEX with modulo wrap", () => {
    const result = pickTagline({ mode: "random", env: { EDITH_TAGLINE_INDEX: "9999" } as NodeJS.ProcessEnv })
    expect(result.length).toBeGreaterThan(0)
  })

  it("handles negative EDITH_TAGLINE_INDEX safely", () => {
    const result = pickTagline({ mode: "random", env: { EDITH_TAGLINE_INDEX: "-1" } as NodeJS.ProcessEnv })
    expect(result.length).toBeGreaterThan(0)
  })

  it("ignores non-numeric EDITH_TAGLINE_INDEX and falls back to random", () => {
    const result = pickTagline({ mode: "random", env: { EDITH_TAGLINE_INDEX: "banana" } as NodeJS.ProcessEnv })
    expect(result.length).toBeGreaterThan(0)
  })
})
