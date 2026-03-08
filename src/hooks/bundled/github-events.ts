/**
 * @file github-events.ts
 * @description Bundled hook — GitHub event processor for PRs, issues, CI failures.
 * Fires on 'on_channel_message' when channel is 'github'.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered automatically by hookLoader.loadBundled() at startup.
 *   Classifies GitHub webhook payloads into typed events.
 *   Marks CI failures and review requests as high priority for immediate action.
 */
import { createLogger } from '../../logger.js'
import type { HookContext } from '../types.js'

const log = createLogger('hooks.bundled.github-events')

/** Supported GitHub event types. */
type GitHubEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'issue_opened'
  | 'ci_failed'
  | 'review_requested'
  | 'unknown'

/** GitHub webhook payload shape (minimal). */
interface GitHubPayload {
  action?: string
  merged?: boolean
  pull_request?: unknown
  issue?: unknown
  workflow_run?: { conclusion?: string }
  requested_reviewers?: unknown[]
}

/**
 * Classify a GitHub webhook payload into a typed event.
 * @param payload - Raw webhook payload object
 * @returns Classified event type string
 */
function classifyGitHubEvent(payload: GitHubPayload): GitHubEventType {
  if (payload.pull_request && payload.action === 'opened') return 'pr_opened'
  if (payload.pull_request && payload.action === 'closed' && payload.merged) return 'pr_merged'
  if (payload.issue && payload.action === 'opened') return 'issue_opened'
  if (payload.workflow_run?.conclusion === 'failure') return 'ci_failed'
  if (payload.requested_reviewers && payload.requested_reviewers.length > 0)
    return 'review_requested'
  return 'unknown'
}

/**
 * GitHub events hook — classifies and prioritizes GitHub webhooks.
 * @param ctx - Hook context with userId and payload data
 * @returns Modified data with githubEventType and priority
 */
export default async function githubEventsHook(
  ctx: HookContext,
): Promise<Record<string, unknown>> {
  const { userId, data } = ctx

  if (data['channel'] !== 'github') return data

  const payload = data['payload'] as GitHubPayload | undefined
  if (!payload) return data

  const eventType = classifyGitHubEvent(payload)
  const isUrgent = eventType === 'ci_failed' || eventType === 'review_requested'

  log.debug('github event classified', { userId, eventType, isUrgent })

  return {
    ...data,
    githubEventType: eventType,
    priority: isUrgent ? 'high' : 'normal',
    requiresAction: isUrgent,
    badge: isUrgent ? 'urgent' : 'info',
  }
}

/** Hook manifest for auto-registration. */
export const manifest = {
  id: 'github-events',
  name: 'GitHub Events',
  events: ['on_channel_message'] as string[],
  enabled: true,
  priority: 15,
  path: 'src/hooks/bundled/github-events.ts',
}
