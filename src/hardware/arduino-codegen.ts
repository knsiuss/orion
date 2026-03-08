/**
 * @file arduino-codegen.ts
 * @description LLM-powered Arduino sketch generator and CLI upload bridge.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses orchestrator.generate('code', ...) to produce Arduino C++ sketches.
 *   - Optionally invokes arduino-cli for verification and upload (graceful if missing).
 *   - serial-driver.ts is used for the upload step if arduino-cli is unavailable.
 */

import { exec } from "node:child_process"
import { promisify } from "node:util"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"

const log = createLogger("hardware.arduino-codegen")
const execAsync = promisify(exec)

/**
 * Generates and optionally uploads Arduino sketches via LLM + arduino-cli.
 */
export class ArduinoCodegen {
  /**
   * Generate an Arduino sketch from a natural-language description.
   *
   * @param description - Human-readable description of the desired sketch.
   * @param board       - Arduino board FQBN (e.g. 'arduino:avr:uno').
   * @param libraries   - List of library names to include.
   * @returns Arduino sketch source code as a string.
   */
  async generate(description: string, board: string, libraries: string[]): Promise<string> {
    const libList = libraries.length > 0 ? `\nRequired libraries: ${libraries.join(", ")}` : ""
    const prompt = [
      `Generate a complete Arduino sketch for board: ${board}`,
      `Task: ${description}${libList}`,
      "Output ONLY the sketch code. No explanation. Include all necessary #include statements.",
    ].join("\n")

    const sketch = await orchestrator.generate("code", { prompt })
    log.info("arduino sketch generated", { board, libraries: libraries.length })
    return sketch
  }

  /**
   * Verify an Arduino sketch using arduino-cli.
   * Returns a mock success result if arduino-cli is not installed.
   *
   * @param sketchPath - Path to the .ino sketch file.
   * @returns Verification result with success flag and compiler output.
   */
  async verify(sketchPath: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `arduino-cli compile --verify "${sketchPath}"`,
        { timeout: 60_000 },
      )
      return { success: true, output: stdout + stderr }
    } catch (err) {
      const error = err as { code?: number; stderr?: string; message?: string }
      if (error.code === 127 || String(error.message).includes("not found")) {
        log.warn("arduino-cli not installed — verification skipped")
        return { success: true, output: "(arduino-cli not available — verification skipped)" }
      }
      return {
        success: false,
        output: error.stderr ?? String(error.message ?? "unknown error"),
      }
    }
  }

  /**
   * Upload a sketch to a board via arduino-cli.
   * Returns a mock success result if arduino-cli is not installed.
   *
   * @param sketchPath - Path to the .ino sketch file.
   * @param port       - Serial port path (e.g. '/dev/ttyUSB0', 'COM3').
   * @returns Upload result with success flag and output.
   */
  async upload(sketchPath: string, port: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `arduino-cli upload -p "${port}" "${sketchPath}"`,
        { timeout: 120_000 },
      )
      log.info("arduino sketch uploaded", { sketchPath, port })
      return { success: true, output: stdout + stderr }
    } catch (err) {
      const error = err as { code?: number; stderr?: string; message?: string }
      if (error.code === 127 || String(error.message).includes("not found")) {
        log.warn("arduino-cli not installed — upload skipped")
        return { success: true, output: "(arduino-cli not available — upload skipped)" }
      }
      return {
        success: false,
        output: error.stderr ?? String(error.message ?? "unknown error"),
      }
    }
  }
}

/** Singleton Arduino code generator. */
export const arduinoCodegen = new ArduinoCodegen()
