/**
 * @file daemon.ts
 * @description CLI daemon management commands.
 *
 * ARCHITECTURE:
 *   Delegates to daemonManager for platform-specific service management.
 */
import { createLogger } from '../../logger.js'

const log = createLogger('cli.daemon')

/** Installs EDITH as a system daemon/service. */
export async function daemonInstall(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — daemon/service.ts is a planned module (Phase 9 auto-start)
    const { daemonManager } = await import('../../daemon/service.js') as { daemonManager: { install: () => Promise<void> } }
    await daemonManager.install()
    console.log('✓ EDITH daemon installed.')
  } catch (err) {
    log.error('daemon install failed', { err })
    console.error(`✗ Install failed: ${String(err)}`)
  }
}

/** Prints current daemon running status and platform. */
export async function daemonStatus(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — daemon/service.ts is a planned module (Phase 9 auto-start)
    const { daemonManager } = await import('../../daemon/service.js') as { daemonManager: { status: () => Promise<{ running: boolean; platform: string }> } }
    const status = await daemonManager.status()
    console.log(`${status.running ? '✓' : '✗'} EDITH daemon: ${status.running ? 'running' : 'stopped'} (${status.platform})`)
  } catch (err) {
    log.warn('daemon status check failed', { err })
    console.log('? Could not check daemon status')
  }
}

/** Uninstalls the EDITH system daemon/service. */
export async function daemonUninstall(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — daemon/service.ts is a planned module (Phase 9 auto-start)
    const { daemonManager } = await import('../../daemon/service.js') as { daemonManager: { uninstall: () => Promise<void> } }
    await daemonManager.uninstall()
    console.log('✓ EDITH daemon uninstalled.')
  } catch (err) {
    log.error('daemon uninstall failed', { err })
    console.error(`✗ Uninstall failed: ${String(err)}`)
  }
}
