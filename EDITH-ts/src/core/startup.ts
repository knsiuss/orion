/**
 * EDITH startup and dependency initialization.
 * Sets up all services and returns a configured MessagePipeline ready to use.
 * Separated from main.ts so startup can be tested and reused by gateway.
 */

import fs from "node:fs/promises"
import path from "node:path"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { daemon } from "../background/daemon.js"
import { agentRunner } from "../agents/runner.js"
import { registerOSAgentTool } from "../agents/tools.js"
import { skillLoader } from "../skills/loader.js"
import { causalGraph } from "../memory/causal-graph.js"
import { pluginLoader } from "../plugin-sdk/loader.js"
import { initializeTracing, shutdownTracing } from "../observability/tracing.js"
import { eventBus } from "./event-bus.js"
import { processMessage } from "./message-pipeline.js"
import { mcpClient, type MCPServerConfig } from "../mcp/client.js"
import { bootstrapLoader } from "./bootstrap.js"
// Phase H: OS-Agent layer
import { OSAgent } from "../os-agent/index.js"
import { getDefaultOSAgentConfig, getEdithOSConfig } from "../os-agent/defaults.js"
import type { OSAgentConfig } from "../os-agent/types.js"
import { loadEdithConfig } from "../config/edith-config.js"

const log = createLogger("startup")

export interface StartupResult {
  processMessage: typeof processMessage
  shutdown: () => Promise<void>
  osAgent: OSAgent | null
}

let eventHandlersInitialized = false

function initializeEventHandlers(): void {
  if (eventHandlersInitialized) return
  eventHandlersInitialized = true

  eventBus.on("memory.save.requested", async (data: { userId: string; content: string; metadata: Record<string, unknown> }) => {
    await memory.save(data.userId, data.content, data.metadata)
  })

  eventBus.on("causal.update.requested", async (data: { userId: string; content: string }) => {
    await causalGraph.extractAndUpdate(data.userId, data.content)
  })

  eventBus.on("memory.consolidate.requested", async (data: { userId: string }) => {
    await memory.compress(data.userId)
  })
}

async function ensureWorkspaceStructure(workspaceDir: string): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true })
}

export async function initialize(workspaceDir: string): Promise<StartupResult> {
  log.info("starting EDITH-ts")

  await ensureWorkspaceStructure(workspaceDir)
  await initializeTracing()

  try {
    await prisma.$connect()
    log.info("database connected")
  } catch (error: unknown) {
    log.error("database connection failed", error)
    throw new Error("Cannot start without database connection")
  }

  await memory.init()
  await orchestrator.init()
  await skillLoader.buildSnapshot()
  skillLoader.startWatching({ enabled: true, debounceMs: 1_500 })
  await pluginLoader.loadAllFromDefaultDir()
  void agentRunner
  initializeEventHandlers()

  // Initialize MCP Client with configuration from edith.json (T-2)
  try {
    const edithJsonPath = path.join(workspaceDir, "..", "edith.json")
    const edithJson = await fs.readFile(edithJsonPath, "utf-8").catch(() => "{}")
    const edithConfig = JSON.parse(edithJson) as Record<string, unknown>
    const mcpServers: MCPServerConfig[] = (edithConfig?.mcp as { servers?: MCPServerConfig[] })?.servers || []
    if (mcpServers.length > 0) {
      await mcpClient.init(mcpServers)
      log.info("MCP client initialized", { servers: mcpServers.length })
    }
  } catch (mcpError) {
    log.warn("MCP client initialization failed", { error: String(mcpError) })
  }

  const available = orchestrator.getAvailableEngines()
  if (available.length > 0) {
    log.info("engines loaded", { engines: available })
  } else {
    log.warn("no engines available")
  }

  // ── Phase H: Initialize OS-Agent layer ──
  let osAgent: OSAgent | null = null
  if (config.OS_AGENT_ENABLED || config.EDITH_MODE) {
    try {
      const edithConfig = await loadEdithConfig()
      const edithMode = config.EDITH_MODE

      // Build OS-Agent config from edith.json or EDITH preset
      // Note: osAgent is defined in EdithConfigSchema but z.infer
      // with deeply nested defaults can confuse TS — safe to cast.
      const edithOsAgent = (edithConfig as Record<string, unknown>).osAgent as
        | { enabled?: boolean; gui?: object; vision?: object; voice?: object; system?: object; iot?: object; perceptionIntervalMs?: number }
        | undefined

      let osAgentConfig: OSAgentConfig
      if (edithMode) {
        osAgentConfig = getEdithOSConfig()
        log.info("OS-Agent: EDITH mode enabled (all features ON)")
      } else if (edithOsAgent?.enabled) {
        // Merge edith.json osAgent config with defaults
        const defaults = getDefaultOSAgentConfig()
        osAgentConfig = {
          gui: { ...defaults.gui, ...(edithOsAgent.gui as object ?? {}) },
          vision: { ...defaults.vision, ...(edithOsAgent.vision as object ?? {}) },
          voice: { ...defaults.voice, ...(edithOsAgent.voice as object ?? {}) },
          system: { ...defaults.system, ...(edithOsAgent.system as object ?? {}) },
          iot: { ...defaults.iot, ...(edithOsAgent.iot as object ?? {}) },
          perceptionIntervalMs: edithOsAgent.perceptionIntervalMs ?? defaults.perceptionIntervalMs,
        }
      } else {
        osAgentConfig = getDefaultOSAgentConfig()
      }

      // Inject Home Assistant env vars into IoT config
      if (config.HOME_ASSISTANT_URL) {
        osAgentConfig.iot.homeAssistantUrl = config.HOME_ASSISTANT_URL
      }
      if (config.HOME_ASSISTANT_TOKEN) {
        osAgentConfig.iot.homeAssistantToken = config.HOME_ASSISTANT_TOKEN
      }

      osAgent = new OSAgent(osAgentConfig)
      await osAgent.initialize()

      // Store globally so tools.ts and pipeline can access it
      ;(globalThis as any).__edithOSAgent = osAgent

      // Register the OS-Agent tool into the live edithTools registry
      registerOSAgentTool(osAgent)

      log.info("OS-Agent layer initialized", {
        gui: osAgentConfig.gui.enabled,
        vision: osAgentConfig.vision.enabled,
        voice: osAgentConfig.voice.enabled,
        system: osAgentConfig.system.enabled,
        iot: osAgentConfig.iot.enabled,
      })
    } catch (osErr) {
      log.warn("OS-Agent initialization failed (non-fatal)", { error: String(osErr) })
    }
  }

  const shutdown = async (): Promise<void> => {
    log.info("shutting down")
    if (daemon.isRunning()) {
      daemon.stop()
    }
    // Shutdown OS-Agent
    if (osAgent) {
      await osAgent.shutdown().catch((err) => log.warn("OS-Agent shutdown error", err))
    }
    // Shutdown MCP clients
    await mcpClient.shutdown().catch((err) => log.warn("MCP shutdown error", err))
    await shutdownTracing().catch((err) => log.warn("tracing shutdown error", err))
    await prisma.$disconnect()
  }

  return {
    processMessage,
    shutdown,
    osAgent,
  }
}
