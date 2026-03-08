/**
 * @file channels.ts
 * @description CLI channel status commands.
 *
 * ARCHITECTURE:
 *   Queries channelManager for registered channels and their health.
 */
import { createLogger } from '../../logger.js'

const log = createLogger('cli.channels')

/**
 * Prints status of all registered channels.
 * @param probe - If true, actively probes each channel for liveness
 */
export async function channelsStatus(probe = false): Promise<void> {
  try {
    const { channelManager } = await import('../../channels/manager.js')
    const channels = (channelManager as { list?: () => unknown[] }).list?.() ?? []
    if (channels.length === 0) { console.log('No channels registered.'); return }
    console.log('\nChannel Status:')
    for (const ch of channels) {
      const c = ch as { name?: string; channelId?: string; probe?: () => Promise<string>; status?: string }
      const status = probe && c.probe ? await c.probe() : c.status ?? 'unknown'
      const icon = status === 'ok' ? '✓' : status === 'error' ? '✗' : '?'
      console.log(`  ${icon} ${(c.name ?? c.channelId ?? 'unknown').padEnd(15)} ${status}`)
    }
  } catch (err) {
    log.warn('channels status failed', { err })
    console.log('Could not retrieve channel status.')
  }
}
