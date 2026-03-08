/**
 * @file error-boundaries.test.ts
 * @description Tests for global process error boundaries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockLogError, mockInc, mockShutdown } = vi.hoisted(() => ({
  mockLogError: vi.fn(),
  mockInc: vi.fn(),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../logger.js", () => ({ createLogger: () => ({ error: mockLogError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
vi.mock("../../observability/metrics.js", () => ({ edithMetrics: { errorsTotal: { inc: mockInc } } }))
vi.mock("../shutdown.js", () => ({ performShutdown: mockShutdown }))

import { registerErrorBoundaries, _resetErrorBoundaries } from "../error-boundaries.js"

describe("registerErrorBoundaries", () => {
  beforeEach(() => {
    _resetErrorBoundaries()
    vi.clearAllMocks()
  })

  it("registers unhandledRejection handler", () => {
    const spy = vi.spyOn(process, "on")
    registerErrorBoundaries()
    expect(spy).toHaveBeenCalledWith("unhandledRejection", expect.any(Function))
    spy.mockRestore()
  })

  it("registers uncaughtException handler", () => {
    const spy = vi.spyOn(process, "on")
    registerErrorBoundaries()
    expect(spy).toHaveBeenCalledWith("uncaughtException", expect.any(Function))
    spy.mockRestore()
  })

  it("is idempotent — only registers once", () => {
    const spy = vi.spyOn(process, "on")
    registerErrorBoundaries()
    registerErrorBoundaries()
    const calls = spy.mock.calls.filter(c => c[0] === "unhandledRejection")
    expect(calls).toHaveLength(1)
    spy.mockRestore()
  })

  it("logs unhandledRejection without crashing and increments metric", () => {
    registerErrorBoundaries()
    process.emit("unhandledRejection", new Error("test rejection"), Promise.resolve())
    expect(mockLogError).toHaveBeenCalled()
    expect(mockInc).toHaveBeenCalledWith({ source: "unhandled_rejection" })
  })
})
