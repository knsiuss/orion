/**
 * @file lifecycle.ts
 * @description Hook lifecycle management — install and uninstall with event emission.
 *
 * ARCHITECTURE:
 *   Called by HookLoader when hooks are discovered or removed.
 *   Fires on_install / on_uninstall events via HookRunner.
 */
import { createLogger } from '../logger.js'
import { manifestHookRegistry } from './manifest-registry.js'
import { hookRunner } from './runner.js'
import type { HookManifest } from './types.js'

const log = createLogger('hooks.lifecycle')

class HookLifecycle {
  /**
   * Install a hook — register it and fire on_install event.
   * @param manifest - The hook manifest to install
   */
  async install(manifest: HookManifest): Promise<void> {
    manifestHookRegistry.register(manifest)
    log.info('hook installed', { id: manifest.id })
    void hookRunner.run('on_install', {
      userId: 'system',
      event: 'on_install',
      data: { hookId: manifest.id },
      timestamp: new Date(),
    }).catch(err => log.warn('on_install hook failed', { id: manifest.id, err }))
  }

  /**
   * Uninstall a hook — fire on_uninstall and deregister.
   * @param id - Hook ID to uninstall
   */
  async uninstall(id: string): Promise<void> {
    void hookRunner.run('on_uninstall', {
      userId: 'system',
      event: 'on_uninstall',
      data: { hookId: id },
      timestamp: new Date(),
    }).catch(err => log.warn('on_uninstall hook failed', { id, err }))
    manifestHookRegistry.unregister(id)
    log.info('hook uninstalled', { id })
  }
}

export const hookLifecycle = new HookLifecycle()
