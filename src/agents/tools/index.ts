import { browserTool, getCurrentBrowserObservation, type BrowserObservation } from "./browser.js"
import { codeRunnerTool } from "./code-runner.js"
import { fileAgentTool } from "./file-agent.js"

export type ToolName = "browser" | "codeRunner" | "fileAgent"

export interface ToolMetadata {
  name: ToolName
  description: string
  requiredCapability: string | null
  dangerLevel: "low" | "medium" | "high"
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  observation?: BrowserObservation
}

interface ExecutableTool {
  execute: (params: Record<string, unknown>) => Promise<unknown>
}

const executableTools: Record<ToolName, ExecutableTool> = {
  browser: browserTool as unknown as ExecutableTool,
  codeRunner: codeRunnerTool as unknown as ExecutableTool,
  fileAgent: fileAgentTool as unknown as ExecutableTool,
}

/**
 * Tool metadata registry — deskripsi untuk LLM prompt injection.
 * LATS menggunakan ini untuk propose aksi yang valid.
 */
export const TOOL_REGISTRY: Record<ToolName, ToolMetadata> = {
  browser: {
    name: "browser",
    description:
      "Navigate and interact with websites via Playwright. Use for web research, form fill, and browser-based grounding.",
    requiredCapability: null,
    dangerLevel: "low",
  },
  codeRunner: {
    name: "codeRunner",
    description:
      "Execute Python or JavaScript in an isolated subprocess. Use for calculations, transformations, and controlled scripting.",
    requiredCapability: "code.execute",
    dangerLevel: "medium",
  },
  fileAgent: {
    name: "fileAgent",
    description:
      "Read and modify files inside allowed workspace roots. Use for saving results, reading configs, or listing project files.",
    requiredCapability: null,
    dangerLevel: "medium",
  },
}

function normalizeToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output
  }
  return JSON.stringify(output)
}

export async function executeToolByName(
  toolName: ToolName,
  params: Record<string, unknown>,
  options?: { actorId?: string },
): Promise<ToolResult> {
  const tool = executableTools[toolName]
  if (!tool) {
    return {
      success: false,
      output: "",
      error: `Unknown tool: ${toolName}`,
    }
  }

  const output = normalizeToolOutput(await tool.execute(params))
  const success = !/^.*failed:/i.test(output) && !/^.*error:/i.test(output)
  const observation = toolName === "browser" ? await getCurrentBrowserObservation().catch(() => null) : null

  return {
    success,
    output,
    error: success ? undefined : output,
    observation: observation ?? undefined,
  }
}

export async function getCurrentToolObservation(toolName: ToolName): Promise<BrowserObservation | null> {
  if (toolName !== "browser") {
    return null
  }
  return getCurrentBrowserObservation()
}

export function getToolDescriptions(): string {
  return [
    "Available tools:",
    ...Object.values(TOOL_REGISTRY).map(
      (tool) => `- ${tool.name}: ${tool.description} (danger=${tool.dangerLevel})`,
    ),
  ].join("\n")
}