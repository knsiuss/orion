/**
 * @file shutdown.test.ts
 * @description Tests for the graceful shutdown sequence in shutdown.ts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Verifies that performShutdown() calls all expected teardown steps
 *   (outbox flush, WAL checkpoint, prisma disconnect, channel stop, sidecars).
 *   Uses _resetShutdownState() to reset the once-only shutdownCalled guard
 *   between test cases — no module reset needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted ensures these objects are available when vi.mock factories are called
// (factories are hoisted to the top of the file by Vitest's transform step).
const {
  mockOutbox,
  mockChannelManager,
  mockSidecarManager,
  mockPrisma,
  mockRateLimiter,
  mockDaemon,
} = vi.hoisted(() => ({
  mockOutbox:        { stopFlushing: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) },
  mockChannelManager:{ stop: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(true) },
  mockSidecarManager:{ stopAll: vi.fn() },
  mockPrisma:        { $disconnect: vi.fn().mockResolvedValue(undefined), $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) },
  mockRateLimiter:   { destroy: vi.fn() },
  mockDaemon:        { isRunning: vi.fn().mockReturnValue(true), stop: vi.fn() },
}))

vi.mock("../../channels/outbox.js",                   () => ({ outbox: mockOutbox }))
vi.mock("../../channels/manager.js",                  () => ({ channelManager: mockChannelManager }))
vi.mock("../sidecar-manager.js",                      () => ({ sidecarManager: mockSidecarManager }))
vi.mock("../../database/index.js",                    () => ({ prisma: mockPrisma }))
vi.mock("../../security/pipeline-rate-limiter.js",    () => ({ pipelineRateLimiter: mockRateLimiter }))
vi.mock("../../background/daemon.js",                 () => ({ daemon: mockDaemon }))

import { performShutdown, _resetShutdownState } from "../shutdown.js"

describe("performShutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
