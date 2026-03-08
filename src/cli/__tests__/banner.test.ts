import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { statusIcon, printBanner, printStatusBox, printDivider, spinner, type StatusSection } from "../banner.js"

/** Strip ANSI escape codes to verify raw content. */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "")
}

/** Capture all stdout.write output as a single string. */
function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const original = process.stdout.write
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    fn()
  } finally {
    process.stdout.write = original
  }
  return chunks.join("")
}

describe("statusIcon", () => {
  it("returns a check mark for ok", () => {
    const raw = stripAnsi(statusIcon("ok"))
    expect(raw).toContain("✓")
  })

  it("returns a warning symbol for warn", () => {
    const raw = stripAnsi(statusIcon("warn"))
    expect(raw).toContain("⚠")
  })

  it("returns a cross for error", () => {
    const raw = stripAnsi(statusIcon("error"))
    expect(raw).toContain("✗")
  })
})

describe("printBanner", () => {
  it("prints ASCII art containing EDITH letters", () => {
    const output = captureStdout(() => printBanner())
    const raw = stripAnsi(output)
    expect(raw).toContain("███████╗")
    expect(raw).toContain("v0.1.0")
    expect(raw).toContain("Persistent AI Companion")
  })

  it("prints a custom subtitle when provided", () => {
    const output = captureStdout(() => printBanner({ subtitle: "Doctor" }))
    const raw = stripAnsi(output)
    expect(raw).toContain("Doctor")
  })
})

describe("printStatusBox", () => {
  it("renders all sections and items", () => {
    const sections: StatusSection[] = [
      {
        title: "Engines",
        items: [
          { label: "Anthropic", value: "ready", level: "ok" },
          { label: "OpenAI", value: "no key", level: "warn" },
        ],
      },
      {
        title: "System",
        items: [
          { label: "Database", value: "error", level: "error" },
        ],
      },
    ]

    const output = captureStdout(() => printStatusBox(sections))
    const raw = stripAnsi(output)

    expect(raw).toContain("Engines")
    expect(raw).toContain("Anthropic")
    expect(raw).toContain("ready")
    expect(raw).toContain("OpenAI")
    expect(raw).toContain("no key")
    expect(raw).toContain("System")
    expect(raw).toContain("Database")
  })
})

describe("printDivider", () => {
  it("writes a line of dashes", () => {
    const output = captureStdout(() => printDivider())
    const raw = stripAnsi(output)
    expect(raw).toContain("─".repeat(60))
  })
})

describe("spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    spinner.stop("done", "ok")
    vi.useRealTimers()
  })

  it("start and stop lifecycle works without throwing", () => {
    const output = captureStdout(() => {
      spinner.start("Loading...")
      vi.advanceTimersByTime(500)
      spinner.stop("Done", "ok")
    })
    expect(output).toBeTruthy()
  })

  it("stop clears the interval", () => {
    captureStdout(() => {
      spinner.start("Loading...")
      vi.advanceTimersByTime(200)
      spinner.stop("Finished", "ok")
    })
    expect(spinner._interval).toBeNull()
  })
})
