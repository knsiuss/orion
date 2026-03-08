/**
 * @file types.ts
 * @description Type definitions for the Phase 26 Iron Legion multi-instance system.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Shared by instance-auth, protocol, task-router, orchestrator, and crdt-store.
 *   - LegionMessage is the wire format for all inter-instance communication.
 */

/** Role specialization for a Legion instance. */
export type InstanceRole = "primary" | "research" | "code" | "communication" | "general"

/** Wire message types for inter-instance communication. */
export type LegionMessageType =
  | "task_assign"
  | "task_result"
  | "memory_sync"
  | "heartbeat"
  | "status"

/** Signed inter-instance message envelope. */
export interface LegionMessage {
  /** Protocol version. */
  version: "1.0"
  /** Sending instance ID. */
  from: string
  /** Receiving instance ID or 'broadcast'. */
  to: string
  /** Message category. */
  type: LegionMessageType
  /** Message-specific payload. */
  payload: unknown
  /** HMAC-SHA256 signature of (from + to + type + payload). */
  signature: string
  /** Unix timestamp of message creation. */
  timestamp: number
  /** Time-to-live in seconds. */
  ttl: number
}

/** Task assignment sent to a specialized instance. */
export interface TaskAssignment {
  /** Unique task identifier. */
  taskId: string
  /** Natural-language task description. */
  description: string
  /** Additional context for the task. */
  context: string
  /** Allowed tools for this task. */
  tools: string[]
  /** Resource budget constraints. */
  budget: {
    /** Maximum tokens to consume. */
    maxTokens: number
    /** Maximum wall-clock time in ms. */
    maxDurationMs: number
    /** Maximum API calls allowed. */
    maxApiCalls: number
  }
  /** Task priority level. */
  priority: "low" | "normal" | "high" | "critical"
}

/** Result returned by an instance after completing a task. */
export interface TaskResult {
  /** Task identifier this result corresponds to. */
  taskId: string
  /** Whether the task completed successfully. */
  success: boolean
  /** Task output or answer. */
  result?: string
  /** Error message if success is false. */
  error?: string
  /** Actual tokens consumed. */
  tokensUsed: number
  /** Actual wall-clock time in ms. */
  durationMs: number
}

/** Configuration for a specialized instance role. */
export interface InstanceSpecialization {
  /** Human-readable name. */
  name: string
  /** Instance role. */
  role: InstanceRole
  /** LLM engine configuration. */
  engine: {
    /** Provider name (anthropic, groq, etc.). */
    provider: string
    /** Model identifier. */
    model: string
    /** Sampling temperature. */
    temperature: number
    /** Maximum token budget. */
    maxTokens: number
  }
  /** Allowed tool names. */
  tools: string[]
  /** Extra system prompt additions. */
  systemPromptOverrides: string[]
  /** Resource limits. */
  resourceLimits: {
    /** Max concurrent tasks. */
    maxConcurrentTasks: number
    /** Daily token budget. */
    dailyTokenBudget: number
  }
}

/** Runtime status of a Legion instance. */
export interface InstanceStatus {
  /** Instance ID. */
  instanceId: string
  /** Instance role. */
  role: InstanceRole
  /** Whether the instance is reachable. */
  online: boolean
  /** Number of tasks currently running. */
  currentTasks: number
  /** CPU usage percentage (if available). */
  cpuPercent?: number
  /** Total tokens consumed today. */
  todayTokens: number
}

/** A team member with role-based access. */
export interface TeamMember {
  /** User identifier. */
  userId: string
  /** Access role. */
  role: "admin" | "member" | "guest"
  /** Display name. */
  name: string
}

/** A knowledge entry shared across instances or team members. */
export interface SharedKnowledgeEntry {
  /** Unique entry ID. */
  id: string
  /** Topic or category. */
  topic: string
  /** Knowledge content. */
  content: string
  /** User or instance that published this. */
  publishedBy: string
  /** User IDs that have access (empty = all team members). */
  access: string[]
  /** ISO timestamp of creation. */
  createdAt: string
}
