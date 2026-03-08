/**
 * @file mission-schema.ts
 * @description Zod schemas and TypeScript types for the Phase 22 Autonomous Mission module.
 *
 * ARCHITECTURE:
 *   Shared type contract used by mission-planner.ts, mission-executor.ts,
 *   mission-monitor.ts, safety-guardrails.ts, mission-reporter.ts, and mission-manager.ts.
 *
 * PAPER BASIS:
 *   - LATS: arXiv:2310.04406 — Language Agent Tree Search for task decomposition
 *   - ReAct: arXiv:2210.03629 — Reasoning + Acting in language model agents
 *   - CaMeL: arXiv:2503.18813 — capability token safety for autonomous actions
 */

import { z } from "zod"

/** Possible mission execution statuses. */
export type MissionStatus =
  | "pending"
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"

/** Task step within a mission DAG. */
export const MissionStepSchema = z.object({
  /** Unique step identifier within the mission. */
  id: z.string(),
  /** Human-readable step description. */
  description: z.string(),
  /** Tool or skill to invoke for this step. */
  toolName: z.string(),
  /** Input parameters for the tool call. */
  params: z.record(z.string(), z.unknown()),
  /** Step IDs that must complete before this step. */
  dependsOn: z.array(z.string()),
  /** Maximum number of retry attempts for this step. */
  maxRetries: z.number().int().min(0).default(2),
  /** Current retry count. */
  retryCount: z.number().int().min(0).default(0),
  /** Current step status. */
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]).default("pending"),
  /** Step output (populated on completion). */
  output: z.unknown().optional(),
  /** Error message if step failed. */
  error: z.string().optional(),
  /** Timestamp when step started. */
  startedAt: z.date().optional(),
  /** Timestamp when step completed or failed. */
  completedAt: z.date().optional(),
})

export type MissionStep = z.infer<typeof MissionStepSchema>

/** Resource budget constraints for a mission. */
export const MissionBudgetSchema = z.object({
  /** Maximum number of tool calls allowed across all steps. */
  maxToolCalls: z.number().int().min(1).default(20),
  /** Maximum wall-clock duration in milliseconds. */
  maxDurationMs: z.number().int().min(1000).default(5 * 60 * 1000),
  /** Maximum number of external HTTP requests. */
  maxNetworkRequests: z.number().int().min(0).default(10),
  /** Current counts (updated during execution). */
  usedToolCalls: z.number().int().min(0).default(0),
  usedNetworkRequests: z.number().int().min(0).default(0),
  startedAt: z.date().optional(),
})

export type MissionBudget = z.infer<typeof MissionBudgetSchema>

/** Full mission plan (DAG of steps + metadata). */
export const MissionPlanSchema = z.object({
  /** Unique mission identifier. */
  id: z.string(),
  /** User who requested the mission. */
  userId: z.string(),
  /** Short title for the mission. */
  title: z.string(),
  /** High-level goal text as provided by the user. */
  goal: z.string(),
  /** Ordered list of steps forming the execution DAG. */
  steps: z.array(MissionStepSchema),
  /** Resource budget constraints. */
  budget: MissionBudgetSchema,
  /** Overall mission status. */
  status: z.enum(["pending", "planning", "running", "paused", "completed", "failed", "cancelled"]).default("pending"),
  /** Human-readable status message. */
  statusMessage: z.string().optional(),
  /** Timestamp when the mission was created. */
  createdAt: z.date(),
  /** Timestamp when the mission was last updated. */
  updatedAt: z.date(),
  /** Timestamp when execution completed (success or failure). */
  completedAt: z.date().optional(),
})

export type MissionPlan = z.infer<typeof MissionPlanSchema>

/** Approval request for a high-risk step. */
export const ApprovalRequestSchema = z.object({
  /** Mission ID this approval belongs to. */
  missionId: z.string(),
  /** Step ID requiring approval. */
  stepId: z.string(),
  /** Risk category. */
  riskCategory: z.enum(["data_deletion", "financial", "external_comms", "system_config", "other"]),
  /** Human-readable description of what will happen. */
  description: z.string(),
  /** Risk level. */
  riskLevel: z.enum(["medium", "high", "critical"]),
  /** Whether the request has been approved. */
  approved: z.boolean().default(false),
  /** Timestamp when approval was requested. */
  requestedAt: z.date(),
})

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

/** Summary report produced after mission completion. */
export const MissionReportSchema = z.object({
  /** Mission ID. */
  missionId: z.string(),
  /** Mission title. */
  title: z.string(),
  /** Final status. */
  status: z.enum(["completed", "failed", "cancelled"]),
  /** Steps completed successfully. */
  stepsCompleted: z.number().int().min(0),
  /** Steps that failed. */
  stepsFailed: z.number().int().min(0),
  /** Total steps in the mission. */
  stepsTotal: z.number().int().min(0),
  /** Wall-clock duration in milliseconds. */
  durationMs: z.number().min(0),
  /** Budget usage summary. */
  budgetUsed: MissionBudgetSchema,
  /** Human-readable summary of outcomes. */
  summary: z.string(),
  /** Key outputs from completed steps. */
  outputs: z.array(z.object({
    stepId: z.string(),
    description: z.string(),
    output: z.unknown(),
  })),
  /** Generated at timestamp. */
  generatedAt: z.date(),
})

export type MissionReport = z.infer<typeof MissionReportSchema>
