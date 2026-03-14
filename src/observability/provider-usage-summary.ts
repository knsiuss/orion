/**
 * @file provider-usage-summary.ts
 * @description Windowed provider usage summary — aggregates token/cost data per provider
 *              into time-based windows (daily/weekly/monthly) for display and budget alerts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Sits on top of usage-tracker.ts. Called by system-prompt-builder.ts to inject
 *   a one-line usage summary into the system prompt, and by gateway routes for
 *   dashboard reporting.
 *
 *   Inspired by OpenClaw's provider-usage facade: window-based snapshots,
 *   reset-time tracking, and human-readable formatting.
 */

import { createLogger } from "../logger.js"
import { usageTracker } from "./usage-tracker.js"

const log = createLogger("observability.provider-usage-summary")

/** A single time window for a provider. */
export interface UsageWindow {
  /** Human-readable window label (e.g. "daily", "weekly", "monthly"). */
  label: string
  /** Percentage of budget used in this window (0-100). */
  usedPercent: number
  /** Unix timestamp (ms) when this window resets. */
  resetAt?: number
}

/** Snapshot of a single provider's usage. */
export interface ProviderUsageSnapshot {
  provider: string
  displayName: string
  windows: UsageWindow[]
  error?: string
}

/** Full usage summary across all providers. */
export interface UsageSummary {
  updatedAt: number
  providers: ProviderUsageSnapshot[]
}

/** Per-provider budget configuration. */
export interface ProviderBudget {
  provider: string
  dailyLimitUsd?: number
  weeklyLimitUsd?: number
  monthlyLimitUsd?: number
}

/** Display name mapping for known providers. */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  groq: "Groq",
  google: "Gemini",
  gemini: "Gemini",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  together: "Together",
  fireworks: "Fireworks",
  cohere: "Cohere",
  "github-copilot": "Copilot",
}

/** Clamp a number to [0, 100]. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

/**
 * ProviderUsageSummary — builds windowed usage snapshots from the usage tracker.
 */
export class ProviderUsageSummary {
  private budgets = new Map<string, ProviderBudget>()

  /**
   * Set budget limits for a provider.
   */
  setBudget(budget: ProviderBudget): void {
    this.budgets.set(budget.provider.toLowerCase(), budget)
  }

  /**
   * Load a full usage summary for a user across all providers.
   * @param userId - User to query
   * @param nowMs - Current timestamp (injectable for testing)
   */
  async loadSummary(userId: string, nowMs?: number): Promise<UsageSummary> {
    const now = nowMs ?? Date.now()

    try {
      const dayStart = new Date(now - 24 * 60 * 60 * 1000)
      const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000)
      const monthStart = new Date(now - 30 * 24 * 60 * 60 * 1000)

      const summary = await usageTracker.getUserSummary(userId, monthStart, new Date(now))

      // Build per-provider snapshots
      const providers: ProviderUsageSnapshot[] = []

      for (const [providerKey, stats] of Object.entries(summary.byProvider)) {
        const budget = this.budgets.get(providerKey.toLowerCase())
        const displayName = PROVIDER_DISPLAY_NAMES[providerKey.toLowerCase()] ?? providerKey

        const windows: UsageWindow[] = []

        // Daily window
        const dailyCost = this.sumCostForWindow(summary.daily, dayStart, new Date(now))
        if (budget?.dailyLimitUsd) {
          windows.push({
            label: "daily",
            usedPercent: clampPercent((dailyCost / budget.dailyLimitUsd) * 100),
            resetAt: this.getNextDayReset(now),
          })
        }

        // Weekly window
        const weeklyCost = this.sumCostForWindow(summary.daily, weekStart, new Date(now))
        if (budget?.weeklyLimitUsd) {
          windows.push({
            label: "weekly",
            usedPercent: clampPercent((weeklyCost / budget.weeklyLimitUsd) * 100),
            resetAt: this.getNextWeekReset(now),
          })
        }

        // Monthly window
        if (budget?.monthlyLimitUsd) {
          windows.push({
            label: "monthly",
            usedPercent: clampPercent((stats.cost / budget.monthlyLimitUsd) * 100),
            resetAt: this.getNextMonthReset(now),
          })
        }

        // If no budget configured, still show raw cost info
        if (windows.length === 0 && stats.cost > 0) {
          windows.push({
            label: "total",
            usedPercent: 0, // no budget, can't compute percent
          })
        }

        providers.push({ provider: providerKey, displayName, windows })
      }

      return { updatedAt: now, providers }
    } catch (error) {
      log.error("Failed to load provider usage summary", { userId, error })
      return { updatedAt: now, providers: [] }
    }
  }

  /**
   * Format a human-readable one-liner for injection into system prompt.
   * Example: "📊 Usage: Claude daily 45% left · OpenAI weekly 72% left"
   */
  formatSummaryLine(summary: UsageSummary): string | null {
    const parts: string[] = []

    for (const provider of summary.providers) {
      if (provider.windows.length === 0 || provider.error) continue

      // Pick the most constrained window (highest usedPercent)
      const tightest = provider.windows.reduce((best, w) =>
        w.usedPercent > best.usedPercent ? w : best,
      )

      const remaining = clampPercent(100 - tightest.usedPercent)
      const resetSuffix = tightest.resetAt ? ` ⏱${this.formatResetRemaining(tightest.resetAt)}` : ""
      parts.push(`${provider.displayName} ${remaining.toFixed(0)}% left (${tightest.label}${resetSuffix})`)
    }

    if (parts.length === 0) return null
    return `📊 Usage: ${parts.join(" · ")}`
  }

  /**
   * Format a multi-line usage report.
   */
  formatReport(summary: UsageSummary): string[] {
    if (summary.providers.length === 0) {
      return ["Usage: no provider usage available."]
    }

    const lines: string[] = ["Usage:"]
    for (const entry of summary.providers) {
      if (entry.error) {
        lines.push(`  ${entry.displayName}: ${entry.error}`)
        continue
      }
      if (entry.windows.length === 0) {
        lines.push(`  ${entry.displayName}: no data`)
        continue
      }
      lines.push(`  ${entry.displayName}`)
      for (const window of entry.windows) {
        const remaining = clampPercent(100 - window.usedPercent)
        const reset = window.resetAt ? this.formatResetRemaining(window.resetAt) : null
        const resetSuffix = reset ? ` · resets ${reset}` : ""
        lines.push(`    ${window.label}: ${remaining.toFixed(0)}% left${resetSuffix}`)
      }
    }
    return lines
  }

  /** Sum daily cost entries within a date range. */
  private sumCostForWindow(
    daily: Array<{ date: string; cost: number }>,
    start: Date,
    end: Date,
  ): number {
    const startStr = start.toISOString().split("T")[0]
    const endStr = end.toISOString().split("T")[0]
    return daily
      .filter((d) => d.date >= startStr && d.date <= endStr)
      .reduce((sum, d) => sum + d.cost, 0)
  }

  /** Format remaining time until reset as human-readable string. */
  private formatResetRemaining(targetMs: number): string {
    const diffMs = targetMs - Date.now()
    if (diffMs <= 0) return "now"

    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 60) return `${diffMins}m`

    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`

    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  /** Next midnight UTC. */
  private getNextDayReset(nowMs: number): number {
    const d = new Date(nowMs)
    d.setUTCHours(24, 0, 0, 0)
    return d.getTime()
  }

  /** Next Monday midnight UTC. */
  private getNextWeekReset(nowMs: number): number {
    const d = new Date(nowMs)
    const daysUntilMonday = (8 - d.getUTCDay()) % 7 || 7
    d.setUTCDate(d.getUTCDate() + daysUntilMonday)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }

  /** Next 1st of month midnight UTC. */
  private getNextMonthReset(nowMs: number): number {
    const d = new Date(nowMs)
    d.setUTCMonth(d.getUTCMonth() + 1, 1)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }
}

export const providerUsageSummary = new ProviderUsageSummary()
