/**
 * @file banner.ts
 * @description Shared CLI branding module for EDITH. Provides colored output,
 * ASCII art banner, status display, and a minimal TTY-aware spinner.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by main.ts, onboard.ts, and doctor.ts for consistent CLI UX.
 *   chalk v5 (pure ESM) provides ANSI color support.
 *   tagline.ts provides randomised/configurable startup messages.
 */

import chalk from "chalk"

import { pickTagline, type TaglineMode } from "./tagline.js"

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

/**
 * Returns a colored status marker for the given level.
 * Uses Unicode symbols that render cleanly in modern terminals.
 * @param level - "ok" | "warn" | "error"
 * @returns Colored status marker string
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

/** EDITH block-font ASCII art (figlet "Block", 80-col safe). */
const ASCII_ART = `
███████╗██████╗ ██╗████████╗██╗  ██╗
██╔════╝██╔══██╗██║╚══██╔══╝██║  ██║
█████╗  ██║  ██║██║   ██║   ███████║
██╔══╝  ██║  ██║██║   ██║   ██╔══██║
███████╗██████╔╝██║   ██║   ██║  ██║
╚══════╝╚═════╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝`

/** Options accepted by {@link printBanner}. */
export interface BannerOptions {
  /** Override subtitle shown below the art. */
  subtitle?: string
  /** Tagline display mode: "default" | "random" | "off". Default: "default". */
  taglineMode?: TaglineMode
}

/**
 * Prints the EDITH block-font banner with version and optional tagline.
 * @param options - Optional subtitle and tagline mode
 */
export function printBanner(options?: BannerOptions): void {
  const version = "v0.1.0"
  const subtitle = options?.subtitle ?? "Persistent AI Companion"
  const tagline = pickTagline({ mode: options?.taglineMode ?? "default" })

  process.stdout.write(colors.brand(ASCII_ART) + "\n")
  process.stdout.write(`  ${colors.dim(version)} ${colors.dim("|")} ${colors.accent(subtitle)}\n`)
  if (tagline) {
    process.stdout.write(`  ${colors.dim(tagline)}\n`)
  }
  process.stdout.write("\n")
}

/** Prints a horizontal divider line (60 box-drawing chars). */
export function printDivider(): void {
  process.stdout.write(colors.dim("─".repeat(60)) + "\n")
}

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

/** Whether stdout is a TTY (interactive terminal). */
const isTTY = Boolean(process.stdout.isTTY)

/** Spinner animation frames. */
const SPINNER_FRAMES = ["-", "\\", "|", "/"]

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
