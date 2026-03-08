/**
 * @file alerting.test.ts
 * @description Unit tests for the self-monitoring AlertingService.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../channels/manager.js", () => ({ channelManager: { send: vi.fn().mockResolvedValue(true) } }))
vi.mock("../../channels/outbox.js", () => ({ outbox: { getStatus: vi.fn() } }))
vi.mock("../../channels/circuit-breaker.js", () => ({ channelCircuitBreaker: { getState: vi.fn() } }))
vi.mock("../../config.js", () => ({
  default: {
    ALERT_USER_ID: "admin-user",
    ALERT_DEAD_LETTER_THRESHOLD: 5,
    ALERT_ERROR_RATE_THRESHOLD: 10,
  },
}))

import { AlertingService } from "../alerting.js"
import { channelManager } from "../../channels/manager.js"
import { outbox } from "../../channels/outbox.js"
import { channelCircuitBreaker } from "../../channels/circuit-breaker.js"

const mockSend = vi.mocked(channelManager.send)
const mockGetStatus = vi.mocked(outbox.getStatus)
const mockGetState = vi.mocked(channelCircuitBreaker.getState)

describe("AlertingService", () => {
  let service: AlertingService

  beforeEach(() => {
    service = new AlertingService()
    vi.clearAllMocks()
    mockGetStatus.mockReturnValue({ pending: 0, deadLetters: 0 })
    mockGetState.mockReturnValue("closed")
  })

  it("does not alert when everything is healthy", async () => {
    await service.check()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends alert when dead-letter count >= threshold", async () => {
    mockGetStatus.mockReturnValue({ pending: 0, deadLetters: 5 })
    await service.check()
    expect(mockSend).toHaveBeenCalledWith("admin-user", expect.stringContaining("dead-letter"))
  })

  it("does not alert when dead-letter count is below threshold", async () => {
    mockGetStatus.mockReturnValue({ pending: 0, deadLetters: 4 })
    await service.check()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends alert when 2+ circuit breakers are open", async () => {
    mockGetState.mockImplementation((ch: string) => ["telegram", "discord"].includes(ch) ? "open" : "closed")
    await service.check()
    expect(mockSend).toHaveBeenCalledWith("admin-user", expect.stringContaining("circuit"))
  })

  it("does not alert when only 1 circuit breaker is open", async () => {
    mockGetState.mockImplementation((ch: string) => ch === "telegram" ? "open" : "closed")
    await service.check()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("respects 30-minute cooldown between same-type alerts", async () => {
    mockGetStatus.mockReturnValue({ pending: 0, deadLetters: 10 })
    await service.check() // first alert — should send
    await service.check() // second alert — should be suppressed by cooldown
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("does not alert when ALERT_USER_ID is empty", async () => {
    // Patch config for this test
    const { default: config } = await import("../../config.js")
    const original = config.ALERT_USER_ID
    Object.defineProperty(config, "ALERT_USER_ID", { value: "", writable: true, configurable: true })
    mockGetStatus.mockReturnValue({ pending: 0, deadLetters: 10 })
    await service.check()
    expect(mockSend).not.toHaveBeenCalled()
    Object.defineProperty(config, "ALERT_USER_ID", { value: original, writable: true, configurable: true })
  })
})
