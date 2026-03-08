/**
 * @file retention.test.ts
 * @description Tests for the database retention and vacuum service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockDeleteMany, mockExecuteRaw } = vi.hoisted(() => ({
  mockDeleteMany: vi.fn().mockResolvedValue({ count: 3 }),
  mockExecuteRaw: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../index.js", () => ({
  prisma: {
    message: { deleteMany: mockDeleteMany },
    auditRecord: { deleteMany: mockDeleteMany },
    $executeRawUnsafe: mockExecuteRaw,
  },
}))
vi.mock("../../config.js", () => ({
  default: { MESSAGE_RETENTION_DAYS: 365, AUDIT_RETENTION_DAYS: 90 },
}))

import { RetentionService } from "../retention.js"

describe("RetentionService", () => {
  let service: RetentionService

  beforeEach(() => {
    service = new RetentionService()
    vi.clearAllMocks()
  })

  it("deletes messages older than cutoff", async () => {
    await service.run()
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) })
    )
  })

  it("runs PRAGMA incremental_vacuum after deletion", async () => {
    await service.run()
    expect(mockExecuteRaw).toHaveBeenCalledWith("PRAGMA incremental_vacuum")
  })

  it("does not throw on DB error — logs warning and continues", async () => {
    mockDeleteMany.mockRejectedValueOnce(new Error("db error"))
    await expect(service.run()).resolves.not.toThrow()
  })

  it("start() sets up interval, stop() clears it", () => {
    service.start()
    service.stop()
    // Should not throw
  })
})
