/**
 * @file manifest-registry.ts
 * @description Hook manifest registry — stores and retrieves hook manifests by event type.
 *
 * ARCHITECTURE:
 *   Singleton registry loaded at startup. HookLoader populates it.
 *   HookRunner queries it per event. Thread-safe (in-process single-threaded Node.js).
 *   Distinct from the plugin-sdk HookRegistry (registry.ts) which handles pre/post hooks.
 */
import type { HookEvent, HookManifest } from './types.js'
import { createLogger } from '../logger.js'

const log = createLogger('hooks.registry')

class ManifestHookRegistry {
  private hooks = new Map<string, HookManifest>()
  private byEvent = new Map<HookEvent, Set<string>>()

  /**
   * Register a hook manifest.
   * @param manifest - The hook manifest to register
   */
  register(manifest: HookManifest): void {
    this.hooks.set(manifest.id, manifest)
    for (const event of manifest.events) {
      if (!this.byEvent.has(event)) this.byEvent.set(event, new Set())
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.byEvent.get(event)!.add(manifest.id)
    }
    log.debug('hook registered', { id: manifest.id, events: manifest.events })
  }

  /**
   * Unregister a hook by ID.
   * @param id - Hook ID to remove
   */
  unregister(id: string): void {
    const manifest = this.hooks.get(id)
    if (!manifest) return
    for (const event of manifest.events) {
      this.byEvent.get(event)?.delete(id)
    }
    this.hooks.delete(id)
    log.debug('hook unregistered', { id })
  }

  /**
   * Get all enabled hooks for a given event, sorted by priority.
   * @param event - The event to get hooks for
   * @returns Array of enabled hooks sorted by priority (ascending)
   */
  getForEvent(event: HookEvent): HookManifest[] {
    const ids = this.byEvent.get(event) ?? new Set()
    return [...ids]
      .map(id => this.hooks.get(id))
      .filter((h): h is HookManifest => h !== undefined)
      .filter(h => h.enabled)
      .sort((a, b) => a.priority - b.priority)
  }

  /** List all registered hooks. */
  list(): HookManifest[] {
    return [...this.hooks.values()]
  }
}

export const manifestHookRegistry = new ManifestHookRegistry()
