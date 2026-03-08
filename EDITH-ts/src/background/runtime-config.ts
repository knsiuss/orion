/**
 * @file background/runtime-config.ts
 * @description Runtime config resolver for proactive notifications and macros.
 * @module background/runtime-config
 */

import { loadEdithConfig, type EdithConfig } from "../config/edith-config.js"

export interface RuntimeQuietHours {
  start: string
  end: string
}

export interface RuntimeProactiveConfig {
  enabled: boolean
  quietHours: RuntimeQuietHours
  channels: {
    desktop: boolean
    mobile: boolean
    voice: boolean
  }
  fileWatcher: {
    enabled: boolean
    paths: string[]
    debounceMs: number
    summaryWindowMs: number
  }
  schedulerIntervalMs: number
  maxWatchedPaths: number
}

export interface RuntimeMacroConfig {
  enabled: boolean
  yamlPath: string
  maxConcurrent: number
}

const DEFAULT_QUIET_HOURS: RuntimeQuietHours = {
  start: "22:00",
  end: "07:00",
}

function normalizeTime(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback
  }

  const trimmed = value.trim()
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return fallback
  }

  const [hoursRaw, minutesRaw] = trimmed.split(":")
  const hours = Number.parseInt(hoursRaw, 10)
  const minutes = Number.parseInt(minutesRaw, 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return fallback
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.round(value)
}

function normalizeWatchPaths(paths: unknown, maxWatchedPaths: number): string[] {
  if (!Array.isArray(paths)) {
    return []
  }

  const unique = new Set<string>()
  for (const entry of paths) {
    if (typeof entry !== "string") {
      continue
    }

    const trimmed = entry.trim()
    if (!trimmed) {
      continue
    }

    unique.add(trimmed)
    if (unique.size >= maxWatchedPaths) {
      break
    }
  }

  return Array.from(unique)
}

/**
 * Resolve proactive runtime config from top-level edith.json, with compatibility
 * fallbacks to the legacy osAgent.system watch settings when present.
 *
 * @param edithConfig Optional loaded edith.json config.
 * @returns Normalized proactive runtime config.
 */
export function resolveRuntimeProactiveConfig(edithConfig?: EdithConfig): RuntimeProactiveConfig {
  const topLevel = edithConfig?.proactive
  const legacySystem = edithConfig?.osAgent?.system
  const maxWatchedPaths = normalizePositiveNumber(topLevel?.maxWatchedPaths, 5)
  const legacyWatchPaths = normalizeWatchPaths(legacySystem?.watchPaths, maxWatchedPaths)

  return {
    enabled: topLevel?.enabled ?? true,
    quietHours: {
      start: normalizeTime(topLevel?.quietHours?.start, DEFAULT_QUIET_HOURS.start),
      end: normalizeTime(topLevel?.quietHours?.end, DEFAULT_QUIET_HOURS.end),
    },
    channels: {
      desktop: topLevel?.channels?.desktop ?? true,
      mobile: topLevel?.channels?.mobile ?? true,
      voice: topLevel?.channels?.voice ?? false,
    },
    fileWatcher: {
      enabled: topLevel?.fileWatcher?.enabled ?? legacyWatchPaths.length > 0,
      paths: normalizeWatchPaths(topLevel?.fileWatcher?.paths ?? legacyWatchPaths, maxWatchedPaths),
      debounceMs: normalizePositiveNumber(topLevel?.fileWatcher?.debounceMs, 500),
      summaryWindowMs: normalizePositiveNumber(topLevel?.fileWatcher?.summaryWindowMs, 300_000),
    },
    schedulerIntervalMs: normalizePositiveNumber(
      topLevel?.schedulerIntervalMs ?? legacySystem?.resourceCheckIntervalMs,
      10_000,
    ),
    maxWatchedPaths,
  }
}

/**
 * Resolve macro runtime config from top-level edith.json.
 *
 * @param edithConfig Optional loaded edith.json config.
 * @returns Normalized macro runtime config.
 */
export function resolveRuntimeMacroConfig(edithConfig?: EdithConfig): RuntimeMacroConfig {
  const topLevel = edithConfig?.macros

  return {
    enabled: topLevel?.enabled ?? true,
    yamlPath: typeof topLevel?.yamlPath === "string" && topLevel.yamlPath.trim().length > 0
      ? topLevel.yamlPath.trim()
      : "macros.yaml",
    maxConcurrent: normalizePositiveNumber(topLevel?.maxConcurrent, 1),
  }
}

/**
 * Load the current proactive runtime config from edith.json.
 *
 * @returns Normalized proactive runtime config.
 */
export async function loadRuntimeProactiveConfig(): Promise<RuntimeProactiveConfig> {
  const edithConfig = await loadEdithConfig()
  return resolveRuntimeProactiveConfig(edithConfig)
}

/**
 * Load the current macro runtime config from edith.json.
 *
 * @returns Normalized macro runtime config.
 */
export async function loadRuntimeMacroConfig(): Promise<RuntimeMacroConfig> {
  const edithConfig = await loadEdithConfig()
  return resolveRuntimeMacroConfig(edithConfig)
}
