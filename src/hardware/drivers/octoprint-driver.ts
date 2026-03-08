/**
 * @file octoprint-driver.ts
 * @description OctoPrint REST API driver for 3D printer control.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Used by print-manager.ts to start, cancel, and monitor print jobs.
 *   - Uses native fetch — no additional HTTP dependencies.
 *   - Requires OctoPrint instance with API key configured via .env or edith.json.
 */

import { createLogger } from "../../logger.js"

const log = createLogger("hardware.driver.octoprint")

/** OctoPrint job status response payload. */
interface OctoPrintJobResponse {
  state: string
  progress: { completion: number | null; printTimeLeft: number | null }
}

/**
 * Driver for OctoPrint REST API.
 * Enables EDITH to control and monitor 3D printers remotely.
 */
export class OctoPrintDriver {
  /** OctoPrint base URL (e.g. http://octopi.local). */
  private baseUrl = ""
  /** OctoPrint API key. */
  private apiKey = ""

  /**
   * Configure the OctoPrint connection.
   *
   * @param baseUrl - Base URL of the OctoPrint instance.
   * @param apiKey  - OctoPrint API key for authentication.
   */
  connect(baseUrl: string, apiKey: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.apiKey = apiKey
    log.info("OctoPrint configured", { baseUrl: this.baseUrl })
  }

  /**
   * Build default request headers with API key.
   *
   * @returns Headers object for fetch requests.
   */
  private headers(): Record<string, string> {
    return { "X-Api-Key": this.apiKey, "Content-Type": "application/json" }
  }

  /**
   * Start printing a file that is already uploaded to OctoPrint.
   *
   * @param filePath - Path to the file on OctoPrint (e.g. 'local/mymodel.gcode').
   */
  async startPrint(filePath: string): Promise<void> {
    const url = `${this.baseUrl}/api/files/${filePath}`
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ command: "select", print: true }),
    })
    if (!res.ok) throw new Error(`OctoPrint startPrint failed: ${res.status}`)
    log.info("print started", { filePath })
  }

  /**
   * Cancel the currently running print job.
   */
  async cancelPrint(): Promise<void> {
    const url = `${this.baseUrl}/api/job`
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ command: "cancel" }),
    })
    if (!res.ok) throw new Error(`OctoPrint cancelPrint failed: ${res.status}`)
    log.info("print cancelled")
  }

  /**
   * Get current job status from OctoPrint.
   *
   * @returns Current job progress, time remaining, and state string.
   */
  async getJobStatus(): Promise<{ progress: number; timeLeft: number; status: string }> {
    const url = `${this.baseUrl}/api/job`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) throw new Error(`OctoPrint getJobStatus failed: ${res.status}`)
    const data = (await res.json()) as OctoPrintJobResponse
    return {
      progress: data.progress?.completion ?? 0,
      timeLeft: data.progress?.printTimeLeft ?? 0,
      status: data.state ?? "unknown",
    }
  }

  /**
   * Upload a gcode file to OctoPrint local storage.
   *
   * @param filePath - Target filename on OctoPrint.
   * @param content  - Raw gcode content.
   */
  async uploadFile(filePath: string, content: string): Promise<void> {
    const formData = new FormData()
    formData.append("file", new Blob([content], { type: "text/plain" }), filePath)
    const url = `${this.baseUrl}/api/files/local`
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey },
      body: formData,
    })
    if (!res.ok) throw new Error(`OctoPrint uploadFile failed: ${res.status}`)
    log.info("file uploaded to OctoPrint", { filePath })
  }
}

/** Singleton OctoPrint driver. */
export const octoprintDriver = new OctoPrintDriver()
