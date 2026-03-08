/**
 * @file gmail-watch.ts
 * @description Bundled hook — Gmail new message watcher.
 * Fires on 'on_channel_message' from the email channel.
 * Screens priority and routes to follow-up tracker.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered automatically by hookLoader.loadBundled() at startup.
 *   Attaches priority metadata to email channel messages so the pipeline
 *   can route urgent emails to high-priority processing.
 */
import { createLogger } from '../../logger.js'
import type { HookContext } from '../types.js'

const log = createLogger('hooks.bundled.gmail')

/**
 * Gmail watch hook — screens incoming emails for priority.
 * @param ctx - Hook context with userId and message data
 * @returns Modified data with priority, screened flag, and follow-up hint
 */
export default async function gmailWatchHook(
  ctx: HookContext,
): Promise<Record<string, unknown>> {
  const { userId, data } = ctx
  const message = data['message'] as string | undefined
  const sender = data['sender'] as string | undefined

  if (!message) return data

  const isUrgent = /urgent|asap|deadline|critical/i.test(message)
  const isFromKnownContact = data['knownContact'] === true

  log.debug('gmail hook processing', { userId, isUrgent, hasMessage: !!message })

  return {
    ...data,
    priority: isUrgent ? 'high' : isFromKnownContact ? 'medium' : 'normal',
    screened: true,
    screenedAt: new Date().toISOString(),
    screenedBy: 'gmail-watch-hook',
    requiresFollowUp: isUrgent,
    summary: sender ? `From: ${sender}` : undefined,
  }
}

/** Hook manifest for auto-registration. */
export const manifest = {
  id: 'gmail-watch',
  name: 'Gmail Watch',
  events: ['on_channel_message'] as string[],
  enabled: true,
  priority: 10,
  path: 'src/hooks/bundled/gmail-watch.ts',
}
