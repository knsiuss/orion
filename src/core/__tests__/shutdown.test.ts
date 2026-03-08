/**
 * @file shutdown.test.ts
 * @description Tests for the graceful shutdown sequence in shutdown.ts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Verifies that performShutdown() calls all expected teardown steps
 *   (outbox flush, WAL checkpoint, prisma disconnect, channel stop, sidecars).
 *   Uses vi.resetModules() + dynamic import to reset the once-only shutdownCalled guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOutbox = { stopFlushing: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }
const mockChannelManager = { stop: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(true) }
const mockSidecarManager = { stopAll: vi.fn() }
const mockPrisma = { $disconnect: vi.fn().mockResolvedValue(undefined), $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }
const mockRateLimiter = { destroy: vi.fn() }
const mockDaemon = { isRunning: vi.fn().mockReturnValue(true), stop: vi.fn() }

vi.mock("../../channels/outbox.js", () => ({ outbox: mockOutbox }))
vi.mock("../../channels/manager.js", () => ({ channelManager: mockChannelManager }))
vi.mock("../sidecar-manager.js", () => ({ sidecarManager: mockSidecarManager }))
vi.mock("../../database/index.js", () => ({ prisma: mockPrisma }))
vi.mock("../../security/pipeline-rate-limiter.js", () => ({ pipelineRateLimiter: mockRateLimiter }))
vi.mock("../../background/daemon.js", () => ({ daemon: mockDaemon }))

describe("performShutdown", () => {
  let performShutdown: () => Promise<void>
  let _resetShutdownState: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

    // Reset module so shutdownCalled guard is cleared between tests
    vi.resetModules()

    // Re-apply mocks after resetModules (they are cleared by resetModules)
    vi.mock("../../channels/outbox.js", () => ({ outbox: mockOutbox }))
    vi.mock("../../channels/manager.js", () => ({ channelManager: mockChannelManager }))
    vi.mock("../sidecar-manager.js", () => ({ sidecarManager: mockSidecarManager }))
    vi.mock("../../database/index.js", () => ({ prisma: mockPrisma }))
    vi.mock("../../security/pipeline-rate-limiter.js", () => ({ pipelineRateLimiter: mockRateLimiter }))
    vi.mock("../../background/daemon.js", () => ({ daemon: mockDaemon }))

    const mod = await import("../shutdown.js")
    performShutdown = mod.performShutdown
    _resetShutdownState = mod._resetShutdownState
    _resetShutdownState()
  })

  it("stops outbox flushing", async () => {
    await performShutdown()
    expect(mockOutbox.stopFlushing).toHaveBeenCalled()
  })

  it("calls prisma WAL checkpoint", async () => {
    await performShutdown()
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith("PRAGMA wal_checkpoint(TRUNCATE)")
  })

  it("calls prisma.$disconnect", async () => {
    await performShutdown()
    expect(mockPrisma.$disconnect).toHaveBeenCalled()
  })

  it("stops channel manager", async () => {
    await performShutdown()
    expect(mockChannelManager.stop).toHaveBeenCalled()
  })

  it("stops sidecars", async () => {
    await performShutdown()
    expect(mockSidecarManager.stopAll).toHaveBeenCalled()
  })
})
