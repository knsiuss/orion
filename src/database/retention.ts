/**
 * @file retention.ts
 * @description Periodic database retention and vacuum service.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Scheduled weekly by daemon.ts. Deletes expired Message and AuditRecord rows,
 *   then runs PRAGMA incremental_vacuum to reclaim SQLite free pages without a
 *   full exclusive-lock VACUUM.
 *   Retention windows are configurable via env vars. Errors are swallowed (never
 *   thrown) so a failed retention cycle doesn't affect normal operation.
 *
 * PAPER BASIS:
 *   SQLite incremental_vacuum: https://sqlite.org/pragma.html#pragma_incremental_vacuum
 *   Unlike VACUUM, incremental_vacuum doesn't require an exclusive lock.
 *
 * @module database/retention
 */

import { prisma } from "./index.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("database.retention")

/** How often the retention job runs — once per week. */
const RETENTION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Manages periodic deletion of old rows and SQLite incremental vacuum.
 *
 * Usage:
 *   retentionService.start()  // called from daemon.ts
 */
export class RetentionService {
  /** Active interval timer, null when stopped. */
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Execute one retention cycle: delete old rows and run incremental vacuum.
   * Never throws — all errors are logged and swallowed.
   */
  async run(): Promise<void> {
    try {
      const now = new Date()

      const messageCutoff = new Date(now)
      messageCutoff.setDate(messageCutoff.getDate() - config.MESSAGE_RETENTION_DAYS)

      const auditCutoff = new Date(now)
      auditCutoff.setDate(auditCutoff.getDate() - config.AUDIT_RETENTION_DAYS)

      const [msgResult, auditResult] = await Promise.all([
        prisma.message.deleteMany({ where: { createdAt: { lt: messageCutoff } } }),
        prisma.auditRecord.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
      ])

      log.info("retention cleanup complete", {
        messagesDeleted: msgResult.count,
        auditDeleted: auditResult.count,
      })

      await prisma.$executeRawUnsafe("PRAGMA incremental_vacuum")
      log.debug("incremental vacuum complete")
    } catch (err) {
      log.warn("retention run failed", { err: String(err) })
    }
  }

  /**
   * Start the weekly retention timer. No-op if already running.
   * Timer is unref()-ed so it won't prevent clean process exit.
   */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.run() }, RETENTION_INTERVAL_MS)
    this.timer.unref()
    log.info("retention scheduler started", {
      messageDays: config.MESSAGE_RETENTION_DAYS,
      auditDays: config.AUDIT_RETENTION_DAYS,
    })
  }

  /** Stop the retention timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/** Singleton retention service. */
export const retentionService = new RetentionService()
