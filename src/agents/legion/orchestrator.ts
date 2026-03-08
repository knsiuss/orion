/**
 * @file orchestrator.ts
 * @description Legion multi-instance orchestrator — routes tasks to specialized EDITH instances.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses task-router.ts for classification and protocol.ts for delegation.
 *   - Falls back to local processing if no suitable remote instance is available.
 *   - Separate from src/engines/orchestrator.ts (LLM routing).
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "../../logger.js"
import { taskRouter } from "./task-router.js"
import { legionProtocol } from "./protocol.js"
import type { InstanceRole, InstanceStatus, TaskAssignment, TaskResult } from "./types.js"

const log = createLogger("legion.orchestrator")

/** Registered instance entry. */
interface InstanceEntry {
  url: string
  role: InstanceRole
  status: InstanceStatus
}

/**
 * Orchestrates task delegation across multiple specialized EDITH instances.
 */
export class LegionOrchestrator {
  /** Registered instances keyed by instance ID. */
  private readonly instances = new Map<string, InstanceEntry>()

  /** Instance ID for this primary instance. */
  private readonly selfId = process.env.LEGION_INSTANCE_ID ?? "primary"

  /**
   * Register a remote instance for delegation.
   *
   * @param instanceId - Unique instance identifier.
   * @param url        - HTTP base URL of the instance.
   * @param role       - Role this instance specializes in.
   */
  registerInstance(instanceId: string, url: string, role: InstanceRole): void {
    this.instances.set(instanceId, {
      url,
      role,
      status: { instanceId, role, online: true, currentTasks: 0, todayTokens: 0 },
    })
    log.info("legion instance registered", { instanceId, role, url })
  }

  /**
   * Unregister a remote instance.
   *
   * @param instanceId - Instance to remove.
   */
  unregisterInstance(instanceId: string): void {
    this.instances.delete(instanceId)
    log.info("legion instance unregistered", { instanceId })
  }

  /**
   * Get all registered instances and their current status.
   *
   * @returns Map of instanceId → entry.
   */
  getInstances(): Map<string, InstanceEntry> {
    return new Map(this.instances)
  }

  /**
   * Route a user message to the most appropriate instance and return the result.
   * Falls back to a descriptive message if no remote instance is available.
   *
   * @param userId  - User who sent the message.
   * @param message - User message to process.
   * @returns Result string from the delegated instance.
   */
  async delegate(userId: string, message: string): Promise<string> {
    if (!taskRouter.shouldDelegate(message)) {
      return "" // Signal caller to handle locally
    }

    const role = taskRouter.classify(message)
    const task: TaskAssignment = {
      taskId: randomUUID(),
      description: message,
      context: `userId=${userId}`,
      tools: [],
      budget: { maxTokens: 4096, maxDurationMs: 30_000, maxApiCalls: 10 },
      priority: "normal",
    }

    const result = await this.delegateToRole(role, task)
    return result.result ?? result.error ?? ""
  }

  /**
   * Delegate a task to the first available instance of a given role.
   *
   * @param role - Target specialization role.
   * @param task - Task assignment payload.
   * @returns TaskResult from the delegate instance.
   */
  async delegateToRole(role: InstanceRole, task: TaskAssignment): Promise<TaskResult> {
    const candidates = [...this.instances.entries()]
      .filter(([, e]) => e.role === role && e.status.online)
      .sort(([, a], [, b]) => a.status.currentTasks - b.status.currentTasks)

    if (candidates.length === 0) {
      log.warn("no available instance for role", { role })
      return {
        taskId: task.taskId,
        success: false,
        error: `No available instance for role: ${role}`,
        tokensUsed: 0,
        durationMs: 0,
      }
    }

    const [instanceId, entry] = candidates[0]!
    const msg = legionProtocol.createMessage(this.selfId, instanceId, "task_assign", task)
    return legionProtocol.send(entry.url, msg)
  }

  /**
   * Get current status of all registered instances.
   *
   * @returns Array of InstanceStatus objects.
   */
  getStatus(): InstanceStatus[] {
    return [...this.instances.values()].map((e) => e.status)
  }
}

/** Singleton Legion orchestrator. */
export const legionOrchestrator = new LegionOrchestrator()
