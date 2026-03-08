/**
 * @file types.ts
 * @description Type definitions for the Phase 25 Digital Twin & Simulation system.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Shared by action-classifier, preview-engine, sandbox-engine,
 *     snapshot-manager, rollback-engine, and what-if-engine.
 */

/** Risk level of an action based on reversibility and blast radius. */
export type ActionImpact = "low" | "medium" | "high" | "critical"

/** Category that determines whether preview/sandbox is triggered. */
export type ActionCategory = "read" | "write" | "destructive" | "external"

/** Human-readable preview of what an action will do before execution. */
export interface ActionPreview {
  /** Unique ID for this preview instance. */
  actionId: string
  /** Tool name or action type. */
  type: string
  /** Human-readable description of what will happen. */
  description: string
  /** Impact severity of the action. */
  impact: ActionImpact
  /** Resources (files, endpoints, etc.) that will be affected. */
  affectedResources: string[]
  /** Unified diff string for file changes, if applicable. */
  diff?: string
  /** Whether this action can be undone via rollback. */
  reversible: boolean
  /** Estimated time to execute in milliseconds. */
  estimatedDurationMs: number
}

/** Point-in-time snapshot of system state before an action. */
export interface ActionSnapshot {
  /** Unique snapshot identifier. */
  id: string
  /** Action this snapshot was created for. */
  actionId: string
  /** Unix timestamp when snapshot was taken. */
  timestamp: number
  /** Type of action (tool name). */
  type: string
  /** Target resource path or identifier. */
  target: string
  /** Serialized state before the action. */
  preState: string
  /** Serialized state after the action (null until action completes). */
  postState?: string
  /** IDs of child action snapshots (for compound operations). */
  childSnapshots: string[]
  /** Whether this snapshot supports rollback. */
  reversible: boolean
}

/** Result of running an action in the sandbox. */
export interface SandboxResult {
  /** Whether the sandbox execution succeeded. */
  success: boolean
  /** Output text from the sandbox execution. */
  output: string
  /** List of side effects that would occur in the real environment. */
  sideEffects: string[]
  /** Wall-clock time in milliseconds. */
  durationMs: number
}

/** Result of a rollback operation. */
export interface RollbackResult {
  /** Whether the rollback succeeded. */
  success: boolean
  /** Number of snapshots successfully restored. */
  restoredCount: number
  /** Non-fatal warnings (e.g., external systems cannot be reversed). */
  warnings: string[]
}
