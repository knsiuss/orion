/**
 * @file os-agent/os-agent-tool.ts — Agent Tool for OS-Level Operations
 * @description Exposes OS-Agent capabilities as an agent tool that can be used
 * by the EDITH agent runner. This is the bridge between the LLM agent layer
 * and the OS-Agent infrastructure.
 *
 * This tool replaces/extends the existing system.ts tool with full EDITH
 * capabilities: GUI automation, screen reading, voice, and IoT control.
 *
 * Based on:
 * - CodeAct (arXiv:2402.01030) — Executable code actions
 * - CaMeL (arXiv:2503.18813) — Capability-based security for OS agents
 *
 * @module os-agent/os-agent-tool
 */

import { tool } from "ai"
import { z } from "zod"
import { createLogger } from "../logger.js"
import type { OSAgent } from "./index.js"

const log = createLogger("tools.os-agent")

function formatGuiActionResult(result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) {
    return `Failed: ${result.error}`
  }

  const payload = (result.data ?? {}) as {
    result?: unknown
    resolvedElement?: { text?: string }
    reflection?: { summary?: string }
  }

  const lines: string[] = []
  const baseResult = typeof payload.result === "string"
    ? payload.result
    : typeof result.data === "string"
      ? result.data
      : "Action completed"
  lines.push(baseResult)

  if (payload.resolvedElement?.text) {
    lines.push(`Grounded target: ${payload.resolvedElement.text}`)
  }

  if (payload.reflection?.summary) {
    lines.push(`Reflect: ${payload.reflection.summary}`)
  }

  return lines.join("\n")
}

/**
 * Create the OS-Agent tool for use in the agent runner.
 * Requires an initialized OSAgent instance.
 */
export function createOSAgentTool(osAgent: OSAgent) {
  return tool({
    description: `EDITH-level OS control. Actions:
- screenshot: Capture & analyze the current screen (OCR + element detection)
- click(x, y) or click(target): Click at screen coordinates or a grounded natural-language target
- type(text): Type text at current cursor position
- hotkey(keys): Press keyboard shortcut (e.g. ["ctrl", "c"])
- scroll(direction, amount): Scroll up/down
- open_app(name): Open an application
- focus_window(title): Focus a window by title
- list_windows: List all open windows
- visual_memory(query): Recall past visual contexts and reflected GUI outcomes
- shell(command): Execute a shell command
- system_info: Get CPU, RAM, disk, battery info
- active_context: Get what the user is currently doing
- iot(command): Control smart home devices
- speak(text): Speak text aloud via TTS`,

    inputSchema: z.object({
      action: z.enum([
        "screenshot",
        "click",
        "double_click",
        "right_click",
        "type",
        "hotkey",
        "scroll",
        "open_app",
        "focus_window",
        "close_window",
        "list_windows",
        "visual_memory",
        "shell",
        "system_info",
        "active_context",
        "clipboard_read",
        "clipboard_write",
        "iot",
        "speak",
        "perception",
      ]),
      // Coordinates for click actions
      x: z.number().optional().describe("X coordinate for click/drag"),
      y: z.number().optional().describe("Y coordinate for click/drag"),
      // Text for type/speak/clipboard
      text: z.string().optional().describe("Text to type, speak, or write to clipboard"),
      target: z.string().optional().describe("Natural-language UI target, e.g. 'Save button'"),
      expectedOutcome: z.string().optional().describe("Expected visual outcome to verify after a GUI action"),
      // Keys for hotkey
      keys: z.array(z.string()).optional().describe("Keys for hotkey, e.g. ['ctrl', 'c']"),
      // Scroll
      direction: z.enum(["up", "down"]).optional(),
      amount: z.number().optional().describe("Scroll amount (default: 3)"),
      limit: z.number().int().min(1).max(10).optional().describe("Recall result limit"),
      // App/window
      name: z.string().optional().describe("App name or window title"),
      // Shell
      command: z.string().optional().describe("Shell command to execute"),
      // IoT
      iotCommand: z.string().optional().describe("Natural language IoT command"),
    }),

    execute: async (input) => {
      try {
        switch (input.action) {
          case "screenshot": {
            const result = await osAgent.vision.captureAndAnalyze()
            if (result.success) {
              const data = result.data as { ocrText: string; elements: any[]; screenshotSize: number }
              return `Screen captured (${data.screenshotSize} bytes). OCR text:\n${data.ocrText?.slice(0, 3000) || "(no text detected)"}\n\nDetected ${data.elements?.length ?? 0} UI elements.`
            }
            return `Screenshot failed: ${result.error}`
          }

          case "click":
          case "double_click":
          case "right_click": {
            if ((input.x === undefined || input.y === undefined) && !input.target) {
              return "Error: x and y coordinates required unless a target query is provided"
            }
            const result = await osAgent.execute({
              type: "gui",
              payload: {
                action: input.action,
                coordinates: input.x !== undefined && input.y !== undefined
                  ? { x: input.x, y: input.y }
                  : undefined,
                targetQuery: input.target,
                expectedOutcome: input.expectedOutcome,
              },
            })
            return formatGuiActionResult(result)
          }

          case "type": {
            if (!input.text) return "Error: text required"
            const result = await osAgent.execute({ type: "gui", payload: { action: "type", text: input.text } })
            return formatGuiActionResult(result)
          }

          case "hotkey": {
            if (!input.keys?.length) return "Error: keys array required"
            const result = await osAgent.execute({ type: "gui", payload: { action: "hotkey", keys: input.keys } })
            return formatGuiActionResult(result)
          }

          case "scroll": {
            const result = await osAgent.execute({
              type: "gui",
              payload: {
                action: "scroll",
                direction: input.direction ?? "down",
                amount: input.amount ?? 3,
              },
            })
            return formatGuiActionResult(result)
          }

          case "open_app": {
            if (!input.name) return "Error: app name required"
            const result = await osAgent.execute({ type: "gui", payload: { action: "open_app", appName: input.name } })
            return formatGuiActionResult(result)
          }

          case "focus_window": {
            if (!input.name) return "Error: window title required"
            const result = await osAgent.execute({ type: "gui", payload: { action: "focus_window", windowTitle: input.name } })
            return formatGuiActionResult(result)
          }

          case "close_window": {
            const result = await osAgent.execute({ type: "gui", payload: { action: "close_window", windowTitle: input.name } })
            return formatGuiActionResult(result)
          }

          case "list_windows": {
            const windows = await osAgent.gui.listWindows()
            if (windows.length === 0) return "No windows found"
            return windows.map((w) => `• [${w.processName}] ${w.title}`).join("\n")
          }

          case "visual_memory": {
            const query = input.text ?? input.target ?? input.name
            if (!query) return "Error: query required"
            const recall = await osAgent.recallVisualMemory(query, input.limit ?? 5)
            if (recall.matches.length === 0) {
              return `No visual memories found for "${query}".`
            }
            return recall.summary.join("\n")
          }

          case "shell": {
            if (!input.command) return "Error: command required"
            const result = await osAgent.system.executeCommand(input.command)
            if (result.success) {
              const data = result.data as { stdout: string; stderr: string }
              return data.stdout || data.stderr || "(no output)"
            }
            return `Command failed: ${result.error}`
          }

          case "system_info": {
            const state = osAgent.system.state
            return JSON.stringify(state, null, 2)
          }

          case "active_context": {
            // Ensure we have a fresh snapshot, then summarize
            await osAgent.getContextSnapshot()
            return osAgent.perception.summarize()
          }

          case "clipboard_read": {
            const result = await osAgent.system.executeCommand(
              process.platform === "win32"
                ? "Get-Clipboard"
                : process.platform === "darwin"
                  ? "pbpaste"
                  : "xclip -selection clipboard -o",
            )
            return result.success ? ((result.data as any).stdout?.slice(0, 2000) ?? "") : `Failed: ${result.error}`
          }

          case "clipboard_write": {
            if (!input.text) return "Error: text required"
            const escapedText = input.text.replace(/'/g, "''")
            const cmd =
              process.platform === "win32"
                ? `Set-Clipboard -Value '${escapedText}'`
                : process.platform === "darwin"
                  ? `pbcopy`
                  : `xclip -selection clipboard`
            // Use stdin piping for macOS/Linux to avoid shell injection
            if (process.platform === "win32") {
              const result = await osAgent.system.executeCommand(cmd)
              return result.success ? `Clipboard updated (${input.text.length} chars)` : `Failed: ${result.error}`
            }
            // For non-Windows, pipe via stdin is handled by executeCommand with shell=true
            const result = await osAgent.system.executeCommand(`echo ${JSON.stringify(input.text)} | ${cmd}`)
            return result.success ? `Clipboard updated (${input.text.length} chars)` : `Failed: ${result.error}`
          }

          case "iot": {
            if (!input.iotCommand) return "Error: iotCommand required"
            const commands = osAgent.iot.parseNaturalLanguage(input.iotCommand)
            if (commands.length === 0) return "Could not parse IoT command"
            const results = await Promise.all(
              commands.map((cmd) =>
                osAgent.iot.execute({
                  target: "home_assistant",
                  domain: cmd.domain,
                  service: cmd.service,
                  entityId: cmd.entityId,
                  data: cmd.data as any,
                }),
              ),
            )
            return results.map((r, i) => `${commands[i].entityId}: ${r.success ? "OK" : r.error}`).join("\n")
          }

          case "speak": {
            if (!input.text) return "Error: text required"
            const result = await osAgent.voice.speak(input.text)
            return result.success ? `Spoke: "${input.text.slice(0, 100)}"` : `TTS failed: ${result.error}`
          }

          case "perception": {
            return osAgent.perception.summarize()
          }

          default:
            return `Unknown action: ${input.action}`
        }
      } catch (err) {
        log.error("OS-Agent tool error", { action: input.action, error: String(err) })
        return `OS-Agent error: ${String(err)}`
      }
    },
  })
}
