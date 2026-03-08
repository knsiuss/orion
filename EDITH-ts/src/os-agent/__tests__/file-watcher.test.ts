import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FileWatcher, __fileWatcherTestUtils } from "../file-watcher.js"

describe("file watcher helpers", () => {
  it("classifies sensitive, working, and noisy files", () => {
    expect(__fileWatcherTestUtils.classifyWatchPath("C:/repo/.env")).toBe("high")
    expect(__fileWatcherTestUtils.classifyWatchPath("C:/repo/src/app.ts")).toBe("medium")
    expect(__fileWatcherTestUtils.classifyWatchPath("C:/repo/logs/server.log")).toBe("low")
  })

  it("ignores repo and cache noise", () => {
    expect(__fileWatcherTestUtils.shouldIgnoreWatchPath("C:/repo/node_modules/pkg/index.js")).toBe(true)
    expect(__fileWatcherTestUtils.shouldIgnoreWatchPath("C:/repo/.git/config")).toBe(true)
    expect(__fileWatcherTestUtils.shouldIgnoreWatchPath("C:/repo/src/index.ts")).toBe(false)
  })
})

describe("FileWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("dispatches sensitive file changes immediately", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      requestedChannels: ["desktop", "mobile"],
      deliveredChannels: ["desktop"],
    })
    const watcher = new FileWatcher({ dispatch } as never)

    await watcher.processFileEvent("change", "C:/repo/.env")

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sensitive file changed",
      priority: "high",
      bypassQuietHours: true,
    }))
  })

  it("buffers working-file changes into a summary notification", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      requestedChannels: ["desktop"],
      deliveredChannels: ["desktop"],
    })
    const watcher = new FileWatcher({ dispatch } as never)

    await watcher.processFileEvent("change", "C:/repo/src/app.ts")
    await watcher.processFileEvent("add", "C:/repo/docs/notes.md")

    expect(dispatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300_000)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      title: "Workspace activity",
      priority: "medium",
    }))
  })
})
