/**
 * @file runner.ts
 * @description Executes hooks safely with timeout and error isolation.
 *
 * ARCHITECTURE:
 *   Each hook runs in Promise.race with a 5-second timeout.
 *   A failing hook does not block subsequent hooks.
 *   Results are merged into the context data for pipeline propagation.
 */
import { createLogger } from '../logger.js'
import { manifestHookRegistry } from './manifest-registry.js'
import type { HookContext, HookEvent, HookResult } from './types.js'

const log = createLogger('hooks.runner')

/** Max time a single hook is allowed to run. */
const HOOK_TIMEOUT_MS = 5000

class HookRunner {
  /**
   * Execute all hooks for a given event. Returns merged data.
   * @param event - The lifecycle event that fired
   * @param context - Context to pass to hooks
   * @returns Merged data from all successful hooks
   */
  async run(event: HookEvent, context: HookContext): Promise<Record<string, unknown>> {
    const hooks = manifestHookRegistry.getForEvent(event)
    if (hooks.length === 0) return context.data

    let merged = { ...context.data }

    for (const hook of hooks) {
      const result = await this.runOne(hook.id, hook.path, { ...context, data: merged })
      if (result.success && result.data) {
        merged = { ...merged, ...result.data }
      }
    }

    return merged
  }

  private async runOne(hookId: string, hookPath: string, context: HookContext): Promise<HookResult> {
    const start = Date.now()
    try {
      const mod = await import(hookPath) as { default?: unknown; handler?: unknown }
      const fn = mod.default ?? mod.handler
      if (typeof fn !== 'function') {
        return { hookId, success: false, error: 'No default export function', durationMs: 0 }
      }

      const result = await Promise.race([
        (fn as (ctx: HookContext) => Promise<Record<string, unknown>>)(context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Hook timeout')), HOOK_TIMEOUT_MS)
        ),
      ])

      return { hookId, success: true, data: result as Record<string, unknown>, durationMs: Date.now() - start }
    } catch (err) {
      log.warn('hook execution failed', { hookId, err })
      return { hookId, success: false, error: String(err), durationMs: Date.now() - start }
    }
  }
}

export const hookRunner = new HookRunner()
