/**
 * @file print-manager.ts
 * @description 3D print job lifecycle manager with proactive status monitoring.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses octoprint-driver.ts for all printer communication.
 *   - eventBus.dispatch() fires proactive notifications when jobs complete or fail.
 *   - config.OCTOPRINT_URL and config.OCTOPRINT_API_KEY are required.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../logger.js"
import { octoprintDriver } from "./drivers/octoprint-driver.js"
import { eventBus } from "../core/event-bus.js"
import config from "../config.js"

const log = createLogger("hardware.print-manager")

/** Active print job tracking entry. */
interface PrintJob {
  /** Unique job identifier. */
  id: string
  /** Path to the print file. */
  filePath: string
  /** Last known progress percentage. */
  progress: number
  /** Last known status string. */
  status: string
  /** Job creation timestamp. */
  startedAt: number
}

/**
 * Manages 3D print job lifecycle including start, monitoring, and cancellation.
 * Fires proactive events on completion or failure.
 */
export class PrintManager {
  /** Active jobs keyed by job ID. */
  private readonly jobs = new Map<string, PrintJob>()

  /**
   * Configure OctoPrint connection on first use.
   */
  private ensureConfigured(): void {
    if (config.OCTOPRINT_URL) {
      octoprintDriver.connect(config.OCTOPRINT_URL, config.OCTOPRINT_API_KEY)
    }
  }

  /**
   * Start a 3D print job.
   *
   * @param filePath - Path to the gcode file on OctoPrint.
   * @param _settings - Optional print settings (reserved for future use).
   * @returns Generated job ID for tracking.
   */
  async startJob(filePath: string, _settings?: Record<string, unknown>): Promise<string> {
    this.ensureConfigured()
    const jobId = randomUUID()
    await octoprintDriver.startPrint(filePath)
    this.jobs.set(jobId, {
      id: jobId,
      filePath,
      progress: 0,
      status: "printing",
      startedAt: Date.now(),
    })
    log.info("print job started", { jobId, filePath })
    return jobId
  }

  /**
   * Get current status of a print job.
   *
   * @param jobId - Job identifier returned by startJob.
   * @returns Job progress, time remaining, and status string.
   */
  async getStatus(jobId: string): Promise<{ progress: number; timeLeft: number; status: string }> {
    this.ensureConfigured()
    const job = this.jobs.get(jobId)
    if (!job) return { progress: 0, timeLeft: 0, status: "unknown" }
    const status = await octoprintDriver.getJobStatus()
    job.progress = status.progress
    job.status = status.status
    return status
  }

  /**
   * Cancel an active print job.
   *
   * @param jobId - Job identifier to cancel.
   */
  async cancel(jobId: string): Promise<void> {
    this.ensureConfigured()
    await octoprintDriver.cancelPrint()
    this.jobs.delete(jobId)
    log.info("print job cancelled", { jobId })
  }

  /**
   * Poll all active jobs and fire proactive events for completed or failed prints.
   */
  async monitorAll(): Promise<void> {
    if (this.jobs.size === 0) return
    this.ensureConfigured()

    for (const [jobId, job] of this.jobs) {
      try {
        const status = await octoprintDriver.getJobStatus()
        job.progress = status.progress
        job.status = status.status

        if (status.status === "Operational" && status.progress >= 100) {
          log.info("print job completed", { jobId, filePath: job.filePath })
          eventBus.dispatch("hardware.print.completed", { jobId, filePath: job.filePath })
          this.jobs.delete(jobId)
        } else if (status.status === "Error" || status.status === "Cancelled") {
          log.warn("print job failed", { jobId, status: status.status })
          eventBus.dispatch("hardware.print.failed", {
            jobId,
            filePath: job.filePath,
            reason: status.status,
          })
          this.jobs.delete(jobId)
        }
      } catch (err) {
        log.warn("print monitor poll failed", { jobId, err })
      }
    }
  }
}

/** Singleton print manager. */
export const printManager = new PrintManager()
