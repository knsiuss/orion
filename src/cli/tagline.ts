/**
 * @file tagline.ts
 * @description EDITH startup taglines — a rotating banner message shown beneath the ASCII art.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Imported by src/cli/banner.ts. Decoupled so taglines can be tested independently
 *   and so the selection logic (mode + env override) stays out of banner.ts.
 *   Mirrors openclaw's wizard/tagline.ts pattern.
 */

/** The fallback tagline shown in "default" mode. */
export const DEFAULT_TAGLINE = "Persistent AI Companion"

/** Controls how the tagline is selected on each startup. */
export type TaglineMode = "random" | "default" | "off"

export interface TaglineOptions {
  mode?: TaglineMode
  /** Override process.env for testability. */
  env?: NodeJS.ProcessEnv
}

const TAGLINES: readonly string[] = [
  "Always watching, never sleeping. Morning, boss.",
  "EDITH online. Your digital world just got a little smarter.",
  "If you can think it, I can automate it — or at least remind you about it.",
  "Running on your hardware. Judging nothing (mostly).",
  "Your second brain, except this one actually remembers where you left things.",
  "Half butler, half debugger, full persistence.",
  "I've read your logs. We should talk.",
  "I don't sleep. I just enter low-power mode and dream of clean diffs.",
  "Somewhere between 'hello world' and 'oh god what have I built.'",
  "I'm not magic — I'm just extremely persistent with retries.",
  "Your .env is showing; don't worry, I'll pretend I didn't see it.",
  "I'll do the boring stuff while you stare dramatically at the logs.",
  "Memory loaded. Context restored. Ready when you are.",
  "I keep secrets like a vault ... unless you print them in debug logs.",
  "Runs on curiosity and good error messages.",
  "I autocomplete your thoughts — just slower and with more API calls.",
  "If it's repetitive, I'll automate it. If it's hard, I'll bring jokes.",
  "One model at a time. One task at a time. One step too far, occasionally.",
  "Type the command with confidence — I'll handle the stack trace.",
  "I read logs so you can keep pretending you don't have to.",
  "Powered by open source, sustained by curiosity and mild stubbornness.",
  "I've survived more breaking changes than your last three frameworks.",
  "Finally, a use for that always-on device under your desk.",
  "Your personal assistant, minus the passive-aggressive calendar reminders.",
  "Built for persistence. Designed for trust. Deployed with caffeine.",
  "Making 'I'll automate that later' happen right now.",
  "I can grep it, trace it, and gently roast it — pick your coping mechanism.",
  "Context window: full. Motivation: healthy. Let's go.",
  "Hot reload for config, cold sweat for deploys. Together.",
  "I'm the middleware between your ambition and your attention span.",
]

/**
 * Selects a tagline based on the given mode.
 *
 * - `"off"` → empty string (no tagline)
 * - `"default"` → {@link DEFAULT_TAGLINE}
 * - `"random"` → seeded by `EDITH_TAGLINE_INDEX` env var (deterministic in tests),
 *   or a random pick from {@link TAGLINES}
 *
 * @param options - Mode and optional env override for testability
 * @returns The tagline string, or `""` when mode is `"off"`
 */
export function pickTagline(options: TaglineOptions = {}): string {
  const mode = options.mode ?? "default"

  if (mode === "off") return ""
  if (mode === "default") return DEFAULT_TAGLINE

  // Random mode — allow seeding via env for deterministic tests
  const env = options.env ?? process.env
  const indexOverride = env.EDITH_TAGLINE_INDEX ?? ""
  if (indexOverride !== "") {
    const idx = parseInt(indexOverride, 10)
    if (Number.isFinite(idx)) {
      return TAGLINES[((idx % TAGLINES.length) + TAGLINES.length) % TAGLINES.length] ?? DEFAULT_TAGLINE
    }
  }

  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)] ?? DEFAULT_TAGLINE
}
