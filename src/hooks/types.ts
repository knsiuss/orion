/**
 * @file types.ts
 * @description Hook system type definitions — lifecycle hooks for EDITH's pipeline.
 *
 * ARCHITECTURE:
 *   Hooks are loaded from workspace/hooks/ and extensions/{name}/hooks/.
 *   Each hook subscribes to one or more HookEvents.
 *   HookRunner executes hooks with timeout isolation.
 */

/** All lifecycle events that can trigger a hook. */
export type HookEvent =
  | 'before_message'
  | 'after_message'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'on_error'
  | 'on_session_start'
  | 'on_session_end'
  | 'on_memory_write'
  | 'on_channel_message'
  | 'on_install'
  | 'on_uninstall'
  | 'on_cron'

/** A single hook manifest parsed from YAML frontmatter. */
export interface HookManifest {
  /** Unique hook identifier. */
  id: string
  /** Human-readable name. */
  name: string
  /** Which events this hook listens to. */
  events: HookEvent[]
  /** Optional cron schedule (for 'on_cron' event). */
  schedule?: string
  /** Whether hook is enabled. */
  enabled: boolean
  /** Hook priority — lower fires first. */
  priority: number
  /** Path to hook implementation file. */
  path: string
}

/** Context passed to hook execution. */
export interface HookContext {
  userId: string
  event: HookEvent
  data: Record<string, unknown>
  timestamp: Date
}

/** Result from hook execution. */
export interface HookResult {
  hookId: string
  success: boolean
  /** If hook modifies data, return modified version. */
  data?: Record<string, unknown>
  error?: string
  durationMs: number
}
