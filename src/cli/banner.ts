/**
 * @file banner.ts
 * @description Shared CLI branding module for EDITH. Provides colored output,
 * ASCII art banner, status display, and a minimal TTY-aware spinner.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by main.ts, onboard.ts, and doctor.ts for consistent CLI UX.
 *   chalk v5 (pure ESM) provides ANSI color support.
 */

import chalk from "chalk"

// ─── Color palette ───────────────────────────────────────────────────────────

/** Reusable color helpers for consistent CLI branding. */
export const colors = {
  brand: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  dim: chalk.gray,
  accent: chalk.magenta,
  label: chalk.bold,
} as const

// ─── Status icons ────────────────────────────────────────────────────────────

/**
 * Returns a colored status icon for the given level.
 * @param level - "ok" | "warn" | "error"
 * @returns Colored status character string
 */
export function statusIcon(level: "ok" | "warn" | "error"): string {
  switch (level) {
    case "ok":
      return colors.success("✓")
    case "warn":
      return colors.warning("⚠")
    case "error":
      return colors.error("✗")
  }
}

// ─── ASCII banner ────────────────────────────────────────────────────────────

/** EDITH ASCII art (fits 80-col terminal). */
const ASCII_ART = `
  ███████╗██████╗ ██╗████████╗██╗  ██╗
  ██╔════╝██╔══██╗██║╚══██╔══╝██║  ██║
  █████╗  ██║  ██║██║   ██║   ███████║
  ██╔══╝  ██║  ██║██║   ██║   ██╔══██║
  ███████╗██████╔╝██║   ██║   ██║  ██║
  ╚══════╝╚═════╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝`

/**
 * Prints the EDITH ASCII art banner with version tagline.
 * @param options - Optional subtitle to display below the art
 */
export function printBanner(options?: { subtitle?: string }): void {
  const version = "v0.1.0"
  const tagline = options?.subtitle
    ? `${version}  ·  ${options.subtitle}`
    : `${version}  ·  Persistent AI Companion`

  process.stdout.write(colors.brand(ASCII_ART) + "\n")
  process.stdout.write(`  ${colors.dim(tagline)}\n\n`)
}

// ─── Divider ─────────────────────────────────────────────────────────────────

/** Prints a horizontal divider line (60 chars). */
export function printDivider(): void {
  process.stdout.write(colors.dim("─".repeat(60)) + "\n")
}

// ─── Status box ──────────────────────────────────────────────────────────────

/** A single status item within a section. */
export interface StatusItem {
  label: string
  value: string
  level: "ok" | "warn" | "error"
}

/** A titled group of status items. */
export interface StatusSection {
  title: string
  items: StatusItem[]
}

/**
 * Prints grouped status sections with colored icons and labels.
 * @param sections - Array of status sections to render
 */
export function printStatusBox(sections: StatusSection[]): void {
  for (const section of sections) {
    process.stdout.write(`  ${colors.label(section.title)}\n`)
    for (const item of section.items) {
      const icon = statusIcon(item.level)
      const label = colors.dim(item.label)
      process.stdout.write(`    ${icon} ${label}  ${item.value}\n`)
    }
    process.stdout.write("\n")
  }
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

/** Whether stdout is a TTY (interactive terminal). */
const isTTY = Boolean(process.stdout.isTTY)

/** Spinner animation frames. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * Minimal spinner for CLI progress indication. Only animates when stdout is a TTY;
 * otherwise falls back to a single-line print.
 */
export const spinner = {
  _interval: null as ReturnType<typeof setInterval> | null,
  _frameIndex: 0,

  /**
   * Starts the spinner with the given text.
   * @param text - Message to display alongside the spinner
   */
  start(text: string): void {
    if (!isTTY) {
      process.stdout.write(`  ${colors.dim("...")} ${text}\n`)
      return
    }

    this._frameIndex = 0
    process.stdout.write(`  ${colors.brand(SPINNER_FRAMES[0])} ${text}`)

    this._interval = setInterval(() => {
      this._frameIndex = (this._frameIndex + 1) % SPINNER_FRAMES.length
      const frame = SPINNER_FRAMES[this._frameIndex]
      process.stdout.write(`\r  ${colors.brand(frame)} ${text}`)
    }, 80)
  },

  /**
   * Stops the spinner and prints a final status line.
   * @param text - Final message to display
   * @param level - Status level for the icon
   */
  stop(text: string, level: "ok" | "warn" | "error"): void {
    if (this._interval) {
      clearInterval(this._interval)
      this._interval = null
    }

    if (isTTY) {
      process.stdout.write(`\r  ${statusIcon(level)} ${text}\n`)
    } else {
      process.stdout.write(`  ${statusIcon(level)} ${text}\n`)
    }
  },
}
