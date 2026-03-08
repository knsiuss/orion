/**
 * @file legion-dashboard.ts
 * @description HTTP dashboard endpoints for Legion instance monitoring.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - registerRoutes() is called from gateway/server.ts during Fastify setup.
 *   - Exposes GET /legion/status and GET /legion/instances for monitoring.
 *   - Uses legionOrchestrator.ts for live instance status data.
 */

import { createLogger } from "../logger.js"
import { legionOrchestrator } from "../agents/legion/orchestrator.js"
import type { InstanceStatus } from "../agents/legion/types.js"
import type { FastifyInstance } from "fastify"

const log = createLogger("gateway.legion-dashboard")

/** Aggregated dashboard response payload. */
interface DashboardStatus {
  /** All registered instances and their status. */
  instances: InstanceStatus[]
  /** Total tokens consumed today across all instances. */
  totalTokensToday: number
  /** Number of active tasks across all instances. */
  activeTasks: number
}

/**
 * Provides dashboard views and HTTP routes for Legion instance monitoring.
 */
export class LegionDashboard {
  /**
   * Compute current Legion dashboard metrics.
   *
   * @returns Aggregated status across all registered instances.
   */
  getStatus(): DashboardStatus {
    const instances = legionOrchestrator.getStatus()
    const totalTokensToday = instances.reduce((sum, i) => sum + i.todayTokens, 0)
    const activeTasks = instances.reduce((sum, i) => sum + i.currentTasks, 0)

    return { instances, totalTokensToday, activeTasks }
  }

  /**
   * Register Legion monitoring routes on a Fastify instance.
   *
   * @param fastify - Fastify server instance.
   */
  registerRoutes(fastify: FastifyInstance): void {
    /**
     * GET /legion/status — aggregated dashboard metrics.
     */
    fastify.get("/legion/status", async (_request, reply) => {
      const status = this.getStatus()
      log.debug("legion dashboard status requested", { instances: status.instances.length })
      return reply.send(status)
    })

    /**
     * GET /legion/instances — list of all registered instances with their status.
     */
    fastify.get("/legion/instances", async (_request, reply) => {
      const instances = legionOrchestrator.getStatus()
      return reply.send({ instances })
    })

    log.info("legion dashboard routes registered")
  }
}

/** Singleton Legion dashboard. */
export const legionDashboard = new LegionDashboard()
