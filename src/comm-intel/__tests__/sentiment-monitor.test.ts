import { describe, it, expect } from "vitest"
import { sentimentMonitor } from "../sentiment-monitor.js"

describe("SentimentMonitor", () => {
  it("records sentiment and returns trend", () => {
    sentimentMonitor.record("user1", "alice", 0.8)
    sentimentMonitor.record("user1", "alice", 0.6)
    sentimentMonitor.record("user1", "alice", 0.7)

    const trend = sentimentMonitor.getTrend("user1", "alice")
    expect(trend).toBeGreaterThan(0)
    expect(trend).toBeLessThanOrEqual(1)
  })

  it("returns 0 for unknown contacts", () => {
    const trend = sentimentMonitor.getTrend("user1", "unknown")
    expect(trend).toBe(0)
  })
})
