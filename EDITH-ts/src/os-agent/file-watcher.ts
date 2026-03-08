/**
 * @file os-agent/file-watcher.ts
 * @description Chokidar-based file watcher with classification and notification routing.
 * @module os-agent/file-watcher
 */

import path from "node:path"

import chokidar, { type FSWatcher } from "chokidar"

import type { RuntimeProactiveConfig } from "../background/runtime-config.js"
import { eventBus } from "../core/event-bus.js"
import { createLogger } from "../logger.js"
import { notificationDispatcher, type NotificationDispatcher } from "./notification.js"

const log = createLogger("os-agent.file-watcher")

type WatchedEventType = "add" | "change" | "unlink"
type WatchedImportance = "high" | "medium" | "low"

interface FileWatcherSummaryState {
  timer: NodeJS.Timeout | null
  entries: Set<string>
}

const IGNORED_PATH_SEGMENTS = [".git", "node_modules", ".cache", ".tmp"]
const HIGH_EXTENSIONS = new Set([".env", ".key", ".pem", ".p12", ".pfx"])
const MEDIUM_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".docx", ".xlsx", ".json", ".yaml", ".yml"])
const LOW_EXTENSIONS = new Set([".log", ".tmp", ".cache"])

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/")
}

export function shouldIgnoreWatchPath(filePath: string): boolean {
  const normalized = normalizeFilePath(filePath).toLowerCase()
  return IGNORED_PATH_SEGMENTS.some((segment) => normalized.includes(`/${segment.toLowerCase()}/`) || normalized.endsWith(`/${segment.toLowerCase()}`))
}

export function classifyWatchPath(filePath: string): WatchedImportance {
  const normalized = normalizeFilePath(filePath)
  const ext = path.extname(normalized).toLowerCase()
  const lowerBase = path.basename(normalized).toLowerCase()

  if (
    HIGH_EXTENSIONS.has(ext)
    || lowerBase === ".env"
    || /(secret|token|credential|password|private|id_rsa|id_ed25519)/i.test(lowerBase)
  ) {
    return "high"
  }

  if (LOW_EXTENSIONS.has(ext)) {
    return "low"
  }

  if (MEDIUM_EXTENSIONS.has(ext)) {
    return "medium"
  }

  return "medium"
}

/**
 * Host-side file watcher for proactive awareness. Sensitive files notify
 * immediately, working files are summarized, and noisy cache/log files stay silent.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null
  private activeSignature = ""
  private activeUserId = "owner"
  private debounceMs = 500
  private summaryWindowMs = 300_000
  private readonly eventTimers = new Map<string, NodeJS.Timeout>()
  private readonly mediumSummary: FileWatcherSummaryState = {
    timer: null,
    entries: new Set<string>(),
  }

  constructor(private readonly dispatcher: NotificationDispatcher = notificationDispatcher) {}

  /**
   * Apply the current proactive runtime config to the watcher. This method is
   * idempotent and only restarts the chokidar watcher when the watched paths or
   * timing controls actually change.
   *
   * @param proactiveConfig The normalized proactive config snapshot.
   * @param userId User who should receive routed notifications.
   */
  async applyConfig(proactiveConfig: RuntimeProactiveConfig, userId: string): Promise<void> {
    this.activeUserId = userId
    this.debounceMs = proactiveConfig.fileWatcher.debounceMs
    this.summaryWindowMs = proactiveConfig.fileWatcher.summaryWindowMs

    const watchPaths = proactiveConfig.enabled && proactiveConfig.fileWatcher.enabled
      ? proactiveConfig.fileWatcher.paths.filter((entry) => !shouldIgnoreWatchPath(entry))
      : []
    const signature = JSON.stringify({
      userId,
      watchPaths,
      debounceMs: this.debounceMs,
      summaryWindowMs: this.summaryWindowMs,
    })

    if (signature === this.activeSignature && this.watcher) {
      return
    }

    await this.shutdown()

    if (watchPaths.length === 0) {
      log.info("file watcher idle", { userId })
      return
    }

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: this.debounceMs,
        pollInterval: 100,
      },
    })

    const bindEvent = (eventName: WatchedEventType) => {
      this.watcher?.on(eventName, (changedPath) => {
        this.queueFileEvent(eventName, changedPath)
      })
    }

    bindEvent("add")
    bindEvent("change")
    bindEvent("unlink")
    this.activeSignature = signature

    log.info("file watcher started", {
      userId,
      watchPaths,
      debounceMs: this.debounceMs,
      summaryWindowMs: this.summaryWindowMs,
    })
  }

  /**
   * Stop the watcher and clear any queued file summaries.
   */
  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    for (const timer of this.eventTimers.values()) {
      clearTimeout(timer)
    }
    this.eventTimers.clear()

    if (this.mediumSummary.timer) {
      clearTimeout(this.mediumSummary.timer)
      this.mediumSummary.timer = null
    }
    this.mediumSummary.entries.clear()
    this.activeSignature = ""
  }

  /**
   * Process one file event after debounce. Exported as a public method so the
   * watcher logic can be tested without a live chokidar instance.
   *
   * @param eventName File change event name.
   * @param changedPath Absolute or relative file path.
   */
  async processFileEvent(eventName: WatchedEventType, changedPath: string): Promise<void> {
    if (shouldIgnoreWatchPath(changedPath)) {
      return
    }

    const importance = classifyWatchPath(changedPath)
    eventBus.dispatch("system.file.changed", {
      userId: this.activeUserId,
      path: changedPath,
      event: eventName,
      importance,
      timestamp: Date.now(),
    })

    if (importance === "low") {
      log.debug("file event observed without notification", {
        userId: this.activeUserId,
        event: eventName,
        path: changedPath,
      })
      return
    }

    if (importance === "high") {
      await this.dispatcher.dispatch({
        userId: this.activeUserId,
        title: "Sensitive file changed",
        message: `${path.basename(changedPath)} was ${eventName} in ${path.dirname(changedPath)}`,
        priority: "high",
        source: "file-watcher",
        bypassQuietHours: true,
        metadata: {
          event: eventName,
          path: changedPath,
          importance,
        },
      })
      return
    }

    this.mediumSummary.entries.add(`${eventName}:${changedPath}`)
    if (this.mediumSummary.timer) {
      return
    }

    this.mediumSummary.timer = setTimeout(() => {
      const entries = Array.from(this.mediumSummary.entries)
      this.mediumSummary.entries.clear()
      this.mediumSummary.timer = null

      const summarizedFiles = entries
        .slice(0, 5)
        .map((entry) => {
          const separatorIndex = entry.indexOf(":")
          const event = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : "change"
          const watchedPath = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : entry
          return `${path.basename(watchedPath)} (${event})`
        })

      void this.dispatcher.dispatch({
        userId: this.activeUserId,
        title: "Workspace activity",
        message: summarizedFiles.length === 1
          ? `${summarizedFiles[0]} changed`
          : `${summarizedFiles.join(", ")}${entries.length > 5 ? ` +${entries.length - 5} more` : ""}`,
        priority: "medium",
        source: "file-watcher",
        metadata: {
          entries,
          importance: "medium",
        },
      })
    }, this.summaryWindowMs)
  }

  private queueFileEvent(eventName: WatchedEventType, changedPath: string): void {
    const key = `${eventName}:${normalizeFilePath(changedPath)}`
    const previous = this.eventTimers.get(key)
    if (previous) {
      clearTimeout(previous)
    }

    const timer = setTimeout(() => {
      this.eventTimers.delete(key)
      void this.processFileEvent(eventName, changedPath)
    }, this.debounceMs)

    this.eventTimers.set(key, timer)
  }
}

export const __fileWatcherTestUtils = {
  shouldIgnoreWatchPath,
  classifyWatchPath,
}
