/**
 * @file follow-up-tracker.ts
 * @description Tracks messages that require follow-up actions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   In-memory tracker with priority sorting.
 *   Items can be marked complete and queried by user.
 *   Extensible for Prisma persistence in future phases.
 */
import { createLogger } from '../logger.js'

const log = createLogger('comm-intel.follow-up')

/** A pending follow-up item. */
export interface FollowUpItem {
  id: string
  userId: string
  message: string
  dueAt?: Date
  priority: 'high' | 'medium' | 'low'
  createdAt: Date
  completed: boolean
}

/** Priority order for sorting (lower = higher priority). */
const PRIORITY_ORDER: Record<FollowUpItem['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

class FollowUpTracker {
  private items = new Map<string, FollowUpItem>()

  /**
   * Add a new follow-up item.
   * @param userId - Owner of the follow-up
   * @param message - Description of what needs to be followed up on
   * @param dueAt - Optional due date
   * @param priority - Priority level (default: medium)
   * @returns The created follow-up item
   */
  add(
    userId: string,
    message: string,
    dueAt?: Date,
    priority: FollowUpItem['priority'] = 'medium',
  ): FollowUpItem {
    const item: FollowUpItem = {
      id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId,
      message,
      dueAt,
      priority,
      createdAt: new Date(),
      completed: false,
    }
    this.items.set(item.id, item)
    log.debug('follow-up added', { userId, id: item.id, priority })
    return item
  }

  /**
   * Mark a follow-up item as completed.
   * @param id - Follow-up item ID
   */
  complete(id: string): void {
    const item = this.items.get(id)
    if (item) {
      item.completed = true
      log.debug('follow-up completed', { id })
    }
  }

  /**
   * Get pending (not completed) follow-ups for a user, sorted by priority.
   * @param userId - User to query
   * @returns Array of pending follow-ups sorted high → low priority
   */
  getPending(userId: string): FollowUpItem[] {
    return [...this.items.values()]
      .filter(item => item.userId === userId && !item.completed)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  }
}

/** Singleton follow-up tracker. */
export const followUpTracker = new FollowUpTracker()
