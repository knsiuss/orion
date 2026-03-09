/**
 * @file engine-stats.ts
 * @description Rolling performance tracker for LLM engines  P50/P95 latency and error rate.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by orchestrator.ts to make data-driven routing decisions.
 *   Sliding-window implementation requires no persistence.
 */
import { createLogger } from "../logger.js"

const log = createLogger("engines.stats")

const WINDOW_SIZE = 20
const DEGRADED_LATENCY_P50_MS = 5_000
const DEGRADED_ERROR_RATE = 0.3
const RECOVERY_LATENCY_P50_MS = 2_500
const RECOVERY_ERROR_RATE = 0.1

export type EngineStatus = "healthy" | "degraded" | "unknown"

interface CallRecord {
  latencyMs: number
  success: boolean
  timestamp: number
}

export interface EngineMetrics {
  p50LatencyMs: number
  p95LatencyMs: number
  errorRate: number
  callCount: number
  status: EngineStatus
}

class EngineStatsTracker {
  private readonly records = new Map<string, CallRecord[]>()

  reset(engineName?: string): void {
    if (engineName) {
      this.records.delete(engineName)
      return
    }

    this.records.clear()
  }

  record(engineName: string, latencyMs: number, success: boolean): void {
    if (!this.records.has(engineName)) {
      this.records.set(engineName, [])
    }

    const window = this.records.get(engineName)!
    window.push({ latencyMs, success, timestamp: Date.now() })

    if (window.length > WINDOW_SIZE) {
      window.splice(0, window.length - WINDOW_SIZE)
    }
  }

  getMetrics(engineName: string): EngineMetrics {
    const window = this.records.get(engineName)
    if (!window || window.length === 0) {
      return { p50LatencyMs: 0, p95LatencyMs: 0, errorRate: 0, callCount: 0, status: "unknown" }
    }

    const latencies = window.map((r) => r.latencyMs).sort((a, b) => a - b)
    const errorCount = window.filter((r) => !r.success).length
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0
    const errorRate = errorCount / window.length

    let status: EngineStatus = "healthy"
    if (p50 > DEGRADED_LATENCY_P50_MS || errorRate > DEGRADED_ERROR_RATE) {
      status = "degraded"
    }

    if (status === "degraded" && p50 < RECOVERY_LATENCY_P50_MS && errorRate < RECOVERY_ERROR_RATE) {
      status = "healthy"
    }

    return { p50LatencyMs: p50, p95LatencyMs: p95, errorRate, callCount: window.length, status }
  }

  /**
   * Rank engines from best to worst candidate.
   * Priority: healthy-with-data > unknown > degraded.
   */
  rankEngines(candidates: string[]): string[] {
    if (candidates.length === 0) {
      throw new Error("rankEngines: no candidates provided")
    }

    const ranked = candidates.map((name, index) => ({
      name,
      index,
      metrics: this.getMetrics(name),
    })).map((entry) => ({
      ...entry,
      bucket: this.getRankingBucket(entry.metrics),
    }))

    ranked.sort((a, b) => {
      if (a.bucket !== b.bucket) {
        return a.bucket - b.bucket
      }

      if (a.bucket === 0) {
        if (a.metrics.p50LatencyMs !== b.metrics.p50LatencyMs) {
          return a.metrics.p50LatencyMs - b.metrics.p50LatencyMs
        }
        if (a.metrics.errorRate !== b.metrics.errorRate) {
          return a.metrics.errorRate - b.metrics.errorRate
        }
        return a.index - b.index
      }

      if (a.bucket === 2) {
        if (a.metrics.errorRate !== b.metrics.errorRate) {
          return a.metrics.errorRate - b.metrics.errorRate
        }
        if (a.metrics.p50LatencyMs !== b.metrics.p50LatencyMs) {
          return a.metrics.p50LatencyMs - b.metrics.p50LatencyMs
        }
        return a.index - b.index
      }

      return a.index - b.index
    })

    const allDegraded = ranked.every((entry) => entry.bucket === 2)
    if (allDegraded) {
      log.warn("all engines degraded, using least-bad ranking", {
        firstEngine: ranked[0]?.name,
        firstErrorRate: ranked[0]?.metrics.errorRate,
      })
    }

    return ranked.map((entry) => entry.name)
  }

  /** Backward-compatible helper for legacy callers. */
  getBestEngine(candidates: string[]): string {
    return this.rankEngines(candidates)[0]
  }

  private getRankingBucket(metrics: EngineMetrics): number {
    if (metrics.status === "healthy" && metrics.callCount > 0) {
      return 0
    }

    if (metrics.status === "unknown") {
      return 1
    }

    return 2
  }

  logStatus(): void {
    for (const [name] of this.records) {
      const m = this.getMetrics(name)
      log.info("engine stats", {
        engine: name,
        p50: m.p50LatencyMs,
        p95: m.p95LatencyMs,
        errorRate: m.errorRate.toFixed(2),
        status: m.status,
        calls: m.callCount,
      })
    }
  }
}

export const engineStats = new EngineStatsTracker()
