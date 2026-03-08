/**
 * @file os-agent/index.ts — OS-Agent Layer Entry Point
 * @description Central orchestrator for all OS-level capabilities.
 * Bridges EDITH's core pipeline with system-level I/O:
 * - GUI automation (screen capture, click, type)
 * - Voice I/O (STT, wake word, full-duplex TTS)
 * - Vision (screen understanding, OCR)
 * - IoT (Home Assistant, MQTT)
 * - System monitoring (processes, resources, activity)
 *
 * Based on:
 * - OSWorld (arXiv:2404.07972) — OS-level agent benchmark
 * - MemGPT (arXiv:2310.08560) — LLM as Operating System
 * - CodeAct (arXiv:2402.01030) — Executable code actions
 *
 * @module os-agent
 */

import { createLogger } from "../logger.js"
import config from "../config.js"
import { GUIAgent } from "./gui-agent.js"
import { VisionCortex, type VisionAnalysisResult } from "./vision-cortex.js"
import { VoiceIO } from "./voice-io.js"
import { SystemMonitor } from "./system-monitor.js"
import { IoTBridge } from "./iot-bridge.js"
import { PerceptionFusion } from "./perception-fusion.js"
import type {
  OSAgentConfig,
  OSAction,
  OSActionResult,
  PerceptionSnapshot,
  GUIActionPayload,
  GUIActionReflection,
  UIElement,
  VisualMemoryRecall,
} from "./types.js"

const log = createLogger("os-agent")

export class OSAgent {
  readonly gui: GUIAgent
  readonly vision: VisionCortex
  readonly voice: VoiceIO
  readonly system: SystemMonitor
  readonly iot: IoTBridge
  readonly perception: PerceptionFusion

  private running = false

  constructor(private config: OSAgentConfig) {
    this.gui = new GUIAgent(config.gui)
    this.vision = new VisionCortex(config.vision)
    this.vision.setGUIAgent(this.gui)
    this.voice = new VoiceIO(config.voice)
    this.system = new SystemMonitor(config.system)
    this.iot = new IoTBridge(config.iot)
    this.perception = new PerceptionFusion({
      gui: this.gui,
      vision: this.vision,
      voice: this.voice,
      system: this.system,
      iot: this.iot,
    })
  }

  /**
   * Initialize all OS-agent subsystems.
   * Call once during EDITH startup.
   */
  async initialize(): Promise<void> {
    log.info("Initializing OS-Agent layer...")

    const results = await Promise.allSettled([
      this.system.initialize(),
      this.gui.initialize(),
      this.vision.initialize(),
      this.voice.initialize(),
      this.iot.initialize(),
    ])

    for (const [i, result] of results.entries()) {
      const names = ["system", "gui", "vision", "voice", "iot"]
      if (result.status === "rejected") {
        log.warn(`OS-Agent subsystem ${names[i]} failed to initialize: ${result.reason}`)
      } else {
        log.info(`OS-Agent subsystem ${names[i]} initialized`)
      }
    }

    this.running = true
    log.info("OS-Agent layer ready")
  }

  /**
   * Start the perception loop — continuously monitors all sensory inputs
   * and fuses them into a unified context snapshot.
   */
  async startPerceptionLoop(): Promise<void> {
    if (!this.running) {
      throw new Error("OS-Agent not initialized. Call initialize() first.")
    }
    await this.perception.startLoop()
    log.info("Perception loop started")
  }

  /**
   * Get the current unified context snapshot from all sensors.
   */
  async getContextSnapshot(): Promise<PerceptionSnapshot> {
    return this.perception.getSnapshot()
  }

  async recallVisualMemory(query: string, limit = 5): Promise<VisualMemoryRecall> {
    return this.vision.recallVisualMemories(query, {
      userId: config.DEFAULT_USER_ID,
      limit,
    })
  }

  /**
   * Execute an OS-level action. This is the main entry point for the
   * agent runner to perform system actions.
   */
  async execute(action: OSAction): Promise<OSActionResult> {
    log.info(`Executing OS action: ${action.type}`, { action: action.type })

    switch (action.type) {
      case "gui":
        return this.executeGuiAction(action.payload)
      case "shell":
        return this.system.executeCommand(action.payload.command, action.payload.options)
      case "voice":
        return this.voice.speak(action.payload.text, action.payload.options)
      case "iot":
        return this.iot.execute(action.payload)
      case "screenshot":
        return this.vision.captureAndAnalyze(action.payload?.region)
      default:
        return { success: false, error: `Unknown action type: ${(action as any).type}` }
    }
  }

  /**
   * Graceful shutdown of all subsystems.
   */
  async shutdown(): Promise<void> {
    log.info("Shutting down OS-Agent layer...")
    this.running = false
    await this.perception.stopLoop()
    await Promise.allSettled([
      this.voice.shutdown(),
      this.vision.shutdown(),
      this.system.shutdown(),
      this.iot.shutdown(),
      this.gui.shutdown(),
    ])
    log.info("OS-Agent layer shut down")
  }

  private async executeGuiAction(payload: GUIActionPayload): Promise<OSActionResult> {
    let resolvedPayload: GUIActionPayload = { ...payload }
    let resolvedElement: UIElement | null = null

    if (payload.targetQuery && !payload.coordinates && this.actionSupportsGrounding(payload.action)) {
      if (!this.config.vision.enabled) {
        return {
          success: false,
          error: `Vision must be enabled to ground GUI target "${payload.targetQuery}"`,
        }
      }

      resolvedElement = await this.vision.findElement(payload.targetQuery)
      if (!resolvedElement) {
        return {
          success: false,
          error: `Could not find a UI element matching "${payload.targetQuery}"`,
        }
      }

      resolvedPayload = {
        ...resolvedPayload,
        coordinates: this.getElementCenter(resolvedElement),
      }
    }

    const shouldReflect = this.config.vision.enabled && payload.reflectAfterAction !== false
    const before = shouldReflect ? await this.captureVisionAnalysisForReflection() : null
    const result = await this.gui.execute(resolvedPayload)

    if (!shouldReflect) {
      return this.attachGuiMetadata(result, resolvedElement)
    }

    const after = await this.captureVisionAnalysisForReflection()
    const reflection = await this.vision.reflectOnGuiAction({
      userId: config.DEFAULT_USER_ID,
      action: resolvedPayload.action,
      success: result.success,
      targetQuery: payload.targetQuery,
      expectedOutcome: payload.expectedOutcome,
      resolvedElement,
      before,
      after,
      commandResult: typeof result.data === "string" ? result.data : undefined,
      error: result.error,
    })

    return this.attachGuiMetadata(result, resolvedElement, reflection)
  }

  private async captureVisionAnalysisForReflection(): Promise<VisionAnalysisResult | null> {
    try {
      const result = await this.vision.captureAndAnalyze()
      if (!result.success || !result.data) {
        return null
      }
      return result.data as VisionAnalysisResult
    } catch {
      return null
    }
  }

  private attachGuiMetadata(
    result: OSActionResult,
    resolvedElement?: UIElement | null,
    reflection?: GUIActionReflection,
  ): OSActionResult {
    if (!resolvedElement && !reflection) {
      return result
    }

    return {
      ...result,
      data: {
        result: result.data,
        resolvedElement: resolvedElement ?? undefined,
        reflection,
      },
    }
  }

  private actionSupportsGrounding(action: GUIActionPayload["action"]): boolean {
    return action === "click"
      || action === "double_click"
      || action === "right_click"
      || action === "move"
  }

  private getElementCenter(element: UIElement): { x: number; y: number } {
    return {
      x: Math.round(element.bounds.x + (element.bounds.width / 2)),
      y: Math.round(element.bounds.y + (element.bounds.height / 2)),
    }
  }
}

// ── Type Exports ──
export type { OSAgentConfig, OSAction, OSActionResult, PerceptionSnapshot } from "./types.js"
export { GUIAgent } from "./gui-agent.js"
export { VisionCortex } from "./vision-cortex.js"
export { VoiceIO } from "./voice-io.js"
export { SystemMonitor } from "./system-monitor.js"
export { IoTBridge } from "./iot-bridge.js"
export { PerceptionFusion } from "./perception-fusion.js"
