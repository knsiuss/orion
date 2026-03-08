/**
 * @file daemon.test.ts
 * @description Unit tests for EDITHDaemon background loop, lifecycle management,
 *              and TriggerEngine evaluation (trigger definitions, cron scheduling,
 *              inactivity detection, and quiet-hours gating).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Tests EDITHDaemon (daemon.ts): lifecycle (start/stop/isRunning/healthCheck),
 *     quiet-hours gating, VoI gating, sandbox permission gating, and event dispatch.
 *   - Tests TriggerEngine (triggers.ts): CRUD, load(), cron field matching,
 *     and inactivity threshold evaluation.
 *   - All external I/O (database, channels, calendar, etc.) is mocked so no real
 *     network or filesystem access occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be declared before any SUT imports
// ---------------------------------------------------------------------------

vi.mock("../../database/index.js", () => ({
  logTrigger: vi.fn().mockResolvedValue(undefined),
  getHistory: vi.fn().mockResolvedValue([]),
  prisma: {},
}))

vi.mock("../../database/backup.js", () => ({
  databaseBackup: {
    start: vi.fn(),
    stop: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../channels/manager.js", () => ({
  channelManager: {
    send: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    DEFAULT_USER_ID: "user-test",
    DAEMON_ENABLED: true,
    DAEMON_INTERVAL_MS: 60_000,
  },
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../quiet-hours.js", () => ({
  isWithinHardQuietHours: vi.fn().mockReturnValue(false),
}))

vi.mock("../heartbeat.js", () => ({
  heartbeat: {
    start: vi.fn(),
    stop: vi.fn(),
    recordActivity: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
    getCurrentIntervalMs: vi.fn().mockReturnValue(60_000),
  },
}))

vi.mock("../../acp/router.js", () => ({
  acpRouter: {
    registerAgent: vi.fn().mockReturnValue({
      agentId: "daemon",
      secret: "test-secret",
    }),
  },
}))

vi.mock("../../acp/protocol.js", () => ({
  signMessage: vi.fn().mockReturnValue("test-signature"),
}))

vi.mock("../../core/event-bus.js", () => ({
  eventBus: {
    on: vi.fn(),
    dispatch: vi.fn(),
  },
}))

vi.mock("../../core/context-predictor.js", () => ({
  contextPredictor: {
    predict: vi.fn().mockResolvedValue({ channel: "webchat", hour: 10 }),
  },
}))

vi.mock("../../core/voi.js", () => ({
  voiCalculator: {
    calculate: vi.fn().mockReturnValue({ shouldSend: true, score: 0.8, reasoning: "ok" }),
  },
}))

vi.mock("../../permissions/sandbox.js", () => ({
  sandbox: {
    check: vi.fn().mockResolvedValue(true),
  },
  PermissionAction: {
    PROACTIVE_MESSAGE: "proactive_message",
  },
}))

vi.mock("../../pairing/manager.js", () => ({
  pairingManager: {
    cleanupExpired: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../memory/temporal-index.js", () => ({
  temporalIndex: {
    runMaintenance: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../services/calendar.js", () => ({
  calendarService: {
    init: vi.fn().mockResolvedValue(undefined),
    getUpcomingAlerts: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("../../emotion/wellness-detector.js", () => ({
  wellnessDetector: {
    check: vi.fn().mockResolvedValue({ signal: "none", confidence: 0, reason: "" }),
  },
}))

vi.mock("../../mission/mission-manager.js", () => ({
  missionManager: {
    checkpointAll: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../self-improve/learning-report.js", () => ({
  learningReport: {
    generate: vi.fn().mockReturnValue({ weekOf: "2026-03-01", totalInteractions: 10, improvements: [] }),
    format: vi.fn().mockReturnValue("Weekly report content"),
  },
}))

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
  },
}))

vi.mock("js-yaml", () => ({
  default: {
    load: vi.fn().mockReturnValue([]),
  },
  load: vi.fn().mockReturnValue([]),
}))

// ---------------------------------------------------------------------------
// SUT imports (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { EDITHDaemon } from "../daemon.js"
import { triggerEngine, TriggerType } from "../triggers.js"
import type { Trigger } from "../triggers.js"
import { channelManager } from "../../channels/manager.js"
import { isWithinHardQuietHours } from "../quiet-hours.js"
import { heartbeat } from "../heartbeat.js"
import { logTrigger, getHistory } from "../../database/index.js"
import { voiCalculator } from "../../core/voi.js"
import { sandbox } from "../../permissions/sandbox.js"
import { eventBus } from "../../core/event-bus.js"
import fs from "node:fs"
import yaml from "js-yaml"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a Trigger with sensible defaults for testing. */
function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: "t1",
    name: "test-trigger",
    type: TriggerType.SCHEDULED,
    enabled: true,
    priority: "normal",
    schedule: "* * * * *",
    message: "Hello from trigger",
    userId: "user-test",
    ...overrides,
  }
}

/** Removes all triggers from the shared singleton. */
function clearTriggerEngine(): void {
  for (const t of triggerEngine.getTriggers()) {
    triggerEngine.removeTrigger(t.id)
  }
}

// ---------------------------------------------------------------------------
// EDITHDaemon — lifecycle
// ---------------------------------------------------------------------------

describe("EDITHDaemon — lifecycle", () => {
  let daemon: EDITHDaemon
  let loadSpy: ReturnType<typeof vi.spyOn>
  let evaluateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isWithinHardQuietHours).mockReturnValue(false)
    // Prevent load() from wiping triggers on each runCycle
    loadSpy = vi.spyOn(triggerEngine, "load").mockResolvedValue(undefined)
    evaluateSpy = vi.spyOn(triggerEngine, "evaluate").mockResolvedValue([])
    daemon = new EDITHDaemon()
  })

  afterEach(() => {
    daemon.stop()
    loadSpy.mockRestore()
    evaluateSpy.mockRestore()
  })

  it("isRunning() returns false before start()", () => {
    expect(daemon.isRunning()).toBe(false)
  })

  it("start() sets running to true", async () => {
    await daemon.start()
    expect(daemon.isRunning()).toBe(true)
  })

  it("stop() sets running to false", async () => {
    await daemon.start()
    daemon.stop()
    expect(daemon.isRunning()).toBe(false)
  })

  it("stop() calls heartbeat.stop()", async () => {
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(heartbeat.stop)).toHaveBeenCalled()
  })

  it("start() calls heartbeat.start()", async () => {
    await daemon.start()
    expect(vi.mocked(heartbeat.start)).toHaveBeenCalled()
  })

  it("start() calls heartbeat.recordActivity()", async () => {
    await daemon.start()
    expect(vi.mocked(heartbeat.recordActivity)).toHaveBeenCalled()
  })

  it("start() twice does not call heartbeat.start() a second time", async () => {
    await daemon.start()
    await daemon.start()
    expect(vi.mocked(heartbeat.start)).toHaveBeenCalledTimes(1)
  })

  it("isRunning() reflects stop state correctly", async () => {
    await daemon.start()
    expect(daemon.isRunning()).toBe(true)
    daemon.stop()
    expect(daemon.isRunning()).toBe(false)
  })

  it("healthCheck() returns running=true after start", async () => {
    await daemon.start()
    const health = daemon.healthCheck()
    expect(health.running).toBe(true)
    expect(typeof health.uptime).toBe("number")
    expect(typeof health.triggersLoaded).toBe("number")
    expect(typeof health.intervalMs).toBe("number")
  })

  it("healthCheck() running=false before start", () => {
    const health = daemon.healthCheck()
    expect(health.running).toBe(false)
  })

  it("healthCheck().triggersLoaded reflects loaded trigger count", async () => {
    // Have evaluate return a trigger so getTriggers() has a count
    clearTriggerEngine()
    triggerEngine.addTrigger(makeTrigger({ id: "hc-t1" }))
    triggerEngine.addTrigger(makeTrigger({ id: "hc-t2" }))
    await daemon.start()
    const health = daemon.healthCheck()
    expect(health.triggersLoaded).toBeGreaterThanOrEqual(2)
    // cleanup
    triggerEngine.removeTrigger("hc-t1")
    triggerEngine.removeTrigger("hc-t2")
  })

  it("eventBus.on() is registered for user.message.received", async () => {
    await daemon.start()
    const events = vi.mocked(eventBus.on).mock.calls.map(([e]) => e)
    expect(events).toContain("user.message.received")
  })

  it("eventBus.on() is registered for system.heartbeat", async () => {
    await daemon.start()
    const events = vi.mocked(eventBus.on).mock.calls.map(([e]) => e)
    expect(events).toContain("system.heartbeat")
  })

  it("event subscriptions registered only once on repeated start()", async () => {
    await daemon.start()
    await daemon.start() // second call is a no-op
    const heartbeatSubs = vi.mocked(eventBus.on).mock.calls.filter(([e]) => e === "system.heartbeat")
    expect(heartbeatSubs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// EDITHDaemon — quiet hours gating
// ---------------------------------------------------------------------------

describe("EDITHDaemon — quiet hours gating", () => {
  let loadSpy: ReturnType<typeof vi.spyOn>
  let evaluateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(channelManager.send).mockResolvedValue(true)
    loadSpy = vi.spyOn(triggerEngine, "load").mockResolvedValue(undefined)
  })

  afterEach(() => {
    loadSpy.mockRestore()
    evaluateSpy?.mockRestore()
  })

  it("does not send a message during hard quiet hours", async () => {
    vi.mocked(isWithinHardQuietHours).mockReturnValue(true)
    evaluateSpy = vi.spyOn(triggerEngine, "evaluate").mockResolvedValue([makeTrigger({ id: "qh-1" })])

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(channelManager.send)).not.toHaveBeenCalled()
  })

  it("logs trigger as not acted-on during quiet hours", async () => {
    vi.mocked(isWithinHardQuietHours).mockReturnValue(true)
    evaluateSpy = vi.spyOn(triggerEngine, "evaluate").mockResolvedValue([
      makeTrigger({ id: "qh-log", name: "test-trigger", userId: "user-test" }),
    ])

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(logTrigger)).toHaveBeenCalledWith("user-test", "test-trigger", false)
  })

  it("sends a trigger outside quiet hours when VoI approves", async () => {
    vi.mocked(isWithinHardQuietHours).mockReturnValue(false)
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.9, reasoning: "ok" })
    vi.mocked(sandbox.check).mockResolvedValue(true)
    evaluateSpy = vi.spyOn(triggerEngine, "evaluate").mockResolvedValue([
      makeTrigger({ id: "qh-send", message: "Hello from trigger" }),
    ])

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(channelManager.send)).toHaveBeenCalledWith("user-test", "Hello from trigger")
  })
})

// ---------------------------------------------------------------------------
// EDITHDaemon — VoI gating
// ---------------------------------------------------------------------------

describe("EDITHDaemon — VoI gating", () => {
  let loadSpy: ReturnType<typeof vi.spyOn>
  let evaluateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isWithinHardQuietHours).mockReturnValue(false)
    vi.mocked(channelManager.send).mockResolvedValue(true)
    vi.mocked(sandbox.check).mockResolvedValue(true)
    loadSpy = vi.spyOn(triggerEngine, "load").mockResolvedValue(undefined)
    evaluateSpy = vi.spyOn(triggerEngine, "evaluate").mockResolvedValue([
      makeTrigger({ id: "voi-t1", name: "test-trigger" }),
    ])
  })

  afterEach(() => {
    loadSpy.mockRestore()
    evaluateSpy.mockRestore()
  })

  it("skips sending when VoI says shouldSend=false", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: false, score: 0.1, reasoning: "low value" })

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(channelManager.send)).not.toHaveBeenCalled()
  })

  it("logs trigger as not acted-on when VoI rejects", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: false, score: 0.1, reasoning: "low" })

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(logTrigger)).toHaveBeenCalledWith("user-test", "test-trigger", false)
  })

  it("sends when VoI says shouldSend=true", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.85, reasoning: "high value" })

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(channelManager.send)).toHaveBeenCalledWith("user-test", "Hello from trigger")
  })

  it("does not send when sandbox permission denied", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.9, reasoning: "ok" })
    vi.mocked(sandbox.check).mockResolvedValue(false)

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(channelManager.send)).not.toHaveBeenCalled()
  })

  it("dispatches trigger.fired event when trigger sends successfully", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.9, reasoning: "ok" })
    vi.mocked(channelManager.send).mockResolvedValue(true)

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(eventBus.dispatch)).toHaveBeenCalledWith(
      "trigger.fired",
      expect.objectContaining({ triggerName: "test-trigger", userId: "user-test" }),
    )
  })

  it("logs trigger with actedOn=true after successful fire", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.9, reasoning: "ok" })
    vi.mocked(channelManager.send).mockResolvedValue(true)

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(logTrigger)).toHaveBeenCalledWith("user-test", "test-trigger", true)
  })

  it("does not dispatch trigger.fired when channelManager.send returns false", async () => {
    vi.mocked(voiCalculator.calculate).mockReturnValue({ shouldSend: true, score: 0.9, reasoning: "ok" })
    vi.mocked(channelManager.send).mockResolvedValue(false)

    const daemon = new EDITHDaemon()
    await daemon.start()
    daemon.stop()
    expect(vi.mocked(eventBus.dispatch)).not.toHaveBeenCalledWith("trigger.fired", expect.anything())
  })
})

// ---------------------------------------------------------------------------
// TriggerEngine — addTrigger / removeTrigger / getTriggers
// ---------------------------------------------------------------------------

describe("TriggerEngine — CRUD", () => {
  beforeEach(() => {
    clearTriggerEngine()
  })

  it("getTriggers() returns empty array after clear", () => {
    expect(triggerEngine.getTriggers()).toEqual([])
  })

  it("addTrigger() appends a trigger", () => {
    triggerEngine.addTrigger(makeTrigger({ id: "crud-a1" }))
    expect(triggerEngine.getTriggers()).toHaveLength(1)
    expect(triggerEngine.getTriggers()[0].id).toBe("crud-a1")
  })

  it("addTrigger() appends multiple triggers independently", () => {
    triggerEngine.addTrigger(makeTrigger({ id: "crud-m1" }))
    triggerEngine.addTrigger(makeTrigger({ id: "crud-m2" }))
    expect(triggerEngine.getTriggers()).toHaveLength(2)
  })

  it("removeTrigger() removes by id leaving others intact", () => {
    triggerEngine.addTrigger(makeTrigger({ id: "crud-r1" }))
    triggerEngine.addTrigger(makeTrigger({ id: "crud-r2" }))
    triggerEngine.removeTrigger("crud-r1")
    expect(triggerEngine.getTriggers()).toHaveLength(1)
    expect(triggerEngine.getTriggers()[0].id).toBe("crud-r2")
  })

  it("removeTrigger() is a no-op for an unknown id", () => {
    triggerEngine.addTrigger(makeTrigger({ id: "crud-nop" }))
    triggerEngine.removeTrigger("nonexistent")
    expect(triggerEngine.getTriggers()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// TriggerEngine — load()
// ---------------------------------------------------------------------------

describe("TriggerEngine — load()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTriggerEngine()
  })

  it("sets triggers to [] when file does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    await triggerEngine.load("non-existent.yaml")
    expect(triggerEngine.getTriggers()).toEqual([])
  })

  it("sets triggers to [] when yaml parses to a non-array value", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue("key: value")
    vi.mocked(yaml.load).mockReturnValue({ key: "value" })

    await triggerEngine.load("triggers.yaml")
    expect(triggerEngine.getTriggers()).toEqual([])
  })

  it("loads array of triggers from valid yaml", async () => {
    const fixtures = [makeTrigger({ id: "yaml-a" }), makeTrigger({ id: "yaml-b" })]
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue("yaml content")
    vi.mocked(yaml.load).mockReturnValue(fixtures)

    await triggerEngine.load("triggers.yaml")
    expect(triggerEngine.getTriggers()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// TriggerEngine — evaluate() scheduled / cron triggers
// ---------------------------------------------------------------------------

describe("TriggerEngine — evaluate() scheduled triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHistory).mockResolvedValue([])
    clearTriggerEngine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns trigger when cron matches current time exactly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 0, 0)) // 10:00

    triggerEngine.addTrigger(makeTrigger({ id: "sched-match", schedule: "0 10 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("sched-match")
  })

  it("does not return trigger when cron hour does not match", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 11, 0, 0)) // 11:00; cron expects 10:00

    triggerEngine.addTrigger(makeTrigger({ id: "sched-miss", schedule: "0 10 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("morning greeting trigger fires between 7-9am (range)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 8, 0, 0)) // 08:00

    triggerEngine.addTrigger(makeTrigger({ id: "morning", schedule: "0 7-9 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("morning greeting trigger does NOT fire outside 7-9 window", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 0, 0)) // 10:00

    triggerEngine.addTrigger(makeTrigger({ id: "morning-miss", schedule: "0 7-9 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("evening summary trigger fires between 20-22pm (range)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 21, 0, 0)) // 21:00

    triggerEngine.addTrigger(makeTrigger({ id: "evening", schedule: "0 20-22 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("disabled trigger is never returned regardless of cron", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 0, 0))

    triggerEngine.addTrigger(makeTrigger({ id: "disabled", enabled: false, schedule: "* * * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("trigger for different userId is never returned", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 0, 0))

    triggerEngine.addTrigger(makeTrigger({ id: "wrong-user", schedule: "* * * * *", userId: "other-user" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// TriggerEngine — evaluate() inactivity triggers
// ---------------------------------------------------------------------------

describe("TriggerEngine — evaluate() inactivity triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTriggerEngine()
  })

  it("fires inactivity trigger when no message history", async () => {
    vi.mocked(getHistory).mockResolvedValue([])

    triggerEngine.addTrigger(
      makeTrigger({ id: "inact-none", type: TriggerType.INACTIVITY, inactivityMinutes: 30, schedule: undefined }),
    )
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("fires inactivity trigger when last message was 2 hours ago (threshold=60min)", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    vi.mocked(getHistory).mockResolvedValue([{ createdAt: twoHoursAgo } as never])

    triggerEngine.addTrigger(
      makeTrigger({ id: "inact-long", type: TriggerType.INACTIVITY, inactivityMinutes: 60, schedule: undefined }),
    )
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("does NOT fire inactivity trigger when user was active 2 minutes ago", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    vi.mocked(getHistory).mockResolvedValue([{ createdAt: twoMinutesAgo } as never])

    triggerEngine.addTrigger(
      makeTrigger({ id: "inact-recent", type: TriggerType.INACTIVITY, inactivityMinutes: 60, schedule: undefined }),
    )
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("fires at exact threshold boundary (deltaMinutes >= inactivityMinutes)", async () => {
    // Exactly 60 minutes ago should satisfy >= 60
    const exactlyOneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    vi.mocked(getHistory).mockResolvedValue([{ createdAt: exactlyOneHourAgo } as never])

    triggerEngine.addTrigger(
      makeTrigger({ id: "inact-boundary", type: TriggerType.INACTIVITY, inactivityMinutes: 60, schedule: undefined }),
    )
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// TriggerEngine — cron field matching edge cases
// ---------------------------------------------------------------------------

describe("TriggerEngine — cron field matching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHistory).mockResolvedValue([])
    clearTriggerEngine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("wildcard (* * * * *) always fires for an enabled trigger", async () => {
    triggerEngine.addTrigger(makeTrigger({ id: "wildcard", schedule: "* * * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("step expression (*/5 * * * *) fires when minute is divisible by 5", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 15, 0)) // minute=15

    triggerEngine.addTrigger(makeTrigger({ id: "step-fire", schedule: "*/5 * * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("step expression (*/5 * * * *) does NOT fire on non-divisible minute", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 10, 13, 0)) // minute=13

    triggerEngine.addTrigger(makeTrigger({ id: "step-skip", schedule: "*/5 * * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("comma-separated hours match the correct current hour", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 12, 0, 0)) // hour=12

    triggerEngine.addTrigger(makeTrigger({ id: "csv-match", schedule: "0 8,12,18 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(1)
  })

  it("comma-separated hours do NOT match an unlisted hour", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 8, 11, 0, 0)) // hour=11

    triggerEngine.addTrigger(makeTrigger({ id: "csv-miss", schedule: "0 8,12,18 * * *" }))
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })

  it("invalid cron expression (wrong field count) never fires", async () => {
    triggerEngine.addTrigger(makeTrigger({ id: "bad-cron", schedule: "* * *" })) // only 3 fields
    const result = await triggerEngine.evaluate("user-test")
    expect(result).toHaveLength(0)
  })
})
