/**
 * @file follow-up-tracker.ts
 * @description Tracks messages requiring follow-up — persisted to Prisma for durability.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Writes to FollowUpItem table via Prisma (falls back to in-memory if table unavailable).
 *   Provides pending/complete/overdue queries sorted by priority.
 *   Used by Gmail watch hook and daemon for proactive follow-up reminders.
 */
import { createLogger } from '../logger.js'
import { prisma } from '../database/index.js'

const log = createLogger('comm-intel.follow-up')

/** Priority levels for follow-up items. */
export type FollowUpPriority = 'high' | 'medium' | 'low'

/** A pending follow-up item. */
export interface FollowUpItem {
  id: string
  userId: string
  message: string
  dueAt?: Date
  priority: FollowUpPriority
  createdAt: Date
  completed: boolean
}

/** Priority order for sorting (lower = higher priority). */
const PRIORITY_ORDER: Record<FollowUpPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/** In-memory fallback store for when Prisma table is unavailable. */
const inMemoryItems = new Map<string, FollowUpItem>()

/** Map a Prisma FollowUpItem record to our FollowUpItem type. */
function mapRecord(r: {
  id: string
  userId: string
  message: string
  dueAt: Date | null
  priority: string
  createdAt: Date
  completed: boolean
}): FollowUpItem {
  return {
    id: r.id,
    userId: r.userId,
    message: r.message,
    dueAt: r.dueAt ?? undefined,
    priority: r.priority as FollowUpPriority,
    createdAt: r.createdAt,
    completed: r.completed,
  }
}

class FollowUpTracker {
  /**
   * Add a new follow-up item (persisted to Prisma, falls back to in-memory).
   * @param userId - Owner of the follow-up
   * @param message - Description of what needs to be followed up on
   * @param dueAt - Optional due date
   * @param priority - Priority level (default: medium)
   * @returns The created follow-up item
   */
  async add(
    userId: string,
    message: string,
    dueAt?: Date,
    priority: FollowUpPriority = 'medium',
  ): Promise<FollowUpItem> {
    try {
      const record = await prisma.followUpItem.create({
        data: { userId, message, dueAt, priority },
      })
      log.debug('follow-up added (db)', { userId, id: record.id, priority })
      return mapRecord(record)
    } catch (err) {
      log.warn('follow-up db write failed, using in-memory fallback', { userId, err })
      const item: FollowUpItem = {
        id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId,
        message,
        dueAt,
        priority,
        createdAt: new Date(),
        completed: false,
      }
      inMemoryItems.set(item.id, item)
      log.debug('follow-up added (memory)', { userId, id: item.id, priority })
      return item
    }
  }

  /**
   * Mark a follow-up item as completed.
   * @param id - Follow-up item ID
   */
  async complete(id: string): Promise<void> {
    try {
      await prisma.followUpItem.update({
        where: { id },
        data: { completed: true, completedAt: new Date() },
      })
      log.debug('follow-up completed (db)', { id })
    } catch {
      const item = inMemoryItems.get(id)
      if (item) {
        item.completed = true
        log.debug('follow-up completed (memory)', { id })
      }
    }
  }

  /**
   * Get pending (not completed) follow-ups for a user, sorted by priority.
   * @param userId - User to query
   * @returns Array of pending follow-ups sorted high → low priority
   */
  async getPending(userId: string): Promise<FollowUpItem[]> {
    try {
      const records = await prisma.followUpItem.findMany({
        where: { userId, completed: false },
        orderBy: { createdAt: 'asc' },
      })
      return (records as Parameters<typeof mapRecord>[0][]).map(mapRecord).sort(
        (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
      )
    } catch {
      return [...inMemoryItems.values()]
        .filter((item) => item.userId === userId && !item.completed)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    }
  }

  /**
   * Get overdue items (dueAt in the past, not yet completed).
   * @param userId - User to query
   * @returns Array of overdue follow-up items
   */
  async getOverdue(userId: string): Promise<FollowUpItem[]> {
    try {
      const records = await prisma.followUpItem.findMany({
        where: { userId, completed: false, dueAt: { lt: new Date() } },
      })
      return (records as Parameters<typeof mapRecord>[0][]).map(mapRecord)
    } catch {
      const now = new Date()
      return [...inMemoryItems.values()].filter(
        (item) => item.userId === userId && !item.completed && item.dueAt && item.dueAt < now,
      )
    }
  }
}

/** Singleton follow-up tracker. */
export const followUpTracker = new FollowUpTracker()
