/**
 * @file user-channel-prefs.ts
 * @description Per-user channel delivery preference store.
 *
 * ARCHITECTURE / INTEGRATION:
 *   ChannelManager.send() calls resolveChannelOrder(userId, globalOrder) to get
 *   the user-specific priority list before attempting delivery. This lets EDITH
 *   learn and respect which channel each user actually uses.
 *
 *   Preferences are persisted in the UserChannelPreference Prisma model and
 *   cached in-memory (LRU, 1000 users) to avoid a DB hit on every send.
 *
 *   Update path: any channel can call setChannelOrder() when a user sends a
 *   message — this implicitly teaches EDITH which channel that user is active on.
 *
 * @module channels/user-channel-prefs
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("channels.user-channel-prefs")

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of user preference entries to hold in the in-memory cache. */
const CACHE_MAX_SIZE = 1_000

// ─── Prisma shim ──────────────────────────────────────────────────────────────
//
// UserChannelPreference is declared in schema.prisma but the Prisma client
// cannot be regenerated at this time due to a Windows DLL file lock on the
// running process. We use a typed interface cast until the next fresh generate.

interface UserChannelPreferenceRow {
  userId: string
  channelOrder: unknown
  updatedAt: Date
}

interface UserChannelPreferenceDelegate {
  findUnique(args: { where: { userId: string } }): Promise<UserChannelPreferenceRow | null>
  upsert(args: {
    where: { userId: string }
    create: { userId: string; channelOrder: string[] }
    update: { channelOrder: string[] }
  }): Promise<UserChannelPreferenceRow>
}

/** Typed access to the UserChannelPreference table (pre-generate shim). */
const userChannelPreferenceTable = (prisma as unknown as Record<string, unknown>)[
  "userChannelPreference"
] as UserChannelPreferenceDelegate

// ─── Types ────────────────────────────────────────────────────────────────────

/** Cached preference entry. */
interface CacheEntry {
  channelOrder: string[]
  fetchedAt: number
}

// ─── UserChannelPrefs ─────────────────────────────────────────────────────────

/**
 * Manages per-user channel delivery order preferences.
 *
 * Usage:
 *   // On first message from a user via WhatsApp:
 *   await userChannelPrefs.promoteChannel(userId, "whatsapp")
 *
 *   // In ChannelManager.send():
 *   const order = await userChannelPrefs.resolveChannelOrder(userId, globalOrder)
 */
export class UserChannelPrefs {
  /** In-memory preference cache: userId → { channelOrder, fetchedAt }. */
  private readonly cache = new Map<string, CacheEntry>()

  /**
   * Resolve the channel send order for a specific user.
   *
   * The returned array contains all channel names from `globalOrder`, but
   * with the user's preferred channels moved to the front in the order they
   * specified. Channels the user has no preference for appear at the end in
   * their original global order.
   *
   * @param userId - The user to resolve preferences for
   * @param globalOrder - The system-default channel priority list
   * @returns Merged channel order: user preferred first, then global fallbacks
   */
  async resolveChannelOrder(userId: string, globalOrder: string[]): Promise<string[]> {
    const userOrder = await this.getChannelOrder(userId)
    return mergeChannelOrder(userOrder, globalOrder)
  }

  /**
   * Get the stored channel preference order for a user.
   * Returns an empty array if no preference has been set.
   *
   * @param userId - The user to look up
   */
  async getChannelOrder(userId: string): Promise<string[]> {
    const cached = this.cache.get(userId)
    if (cached) return cached.channelOrder

    try {
      const row = await userChannelPreferenceTable.findUnique({ where: { userId } })
      const order = (row?.channelOrder as string[] | null) ?? []
      this.setCacheEntry(userId, order)
      return order
    } catch (err) {
      log.warn("failed to load channel preference", { userId, err: String(err) })
      return []
    }
  }

  /**
   * Overwrite the user's full channel preference order.
   *
   * @param userId - Target user
   * @param channelOrder - Ordered channel names (most preferred first)
   */
  async setChannelOrder(userId: string, channelOrder: string[]): Promise<void> {
    try {
      await userChannelPreferenceTable.upsert({
        where: { userId },
        create: { userId, channelOrder },
        update: { channelOrder },
      })
      this.setCacheEntry(userId, channelOrder)
      log.info("channel preference saved", { userId, channelOrder })
    } catch (err) {
      log.warn("failed to save channel preference", { userId, err: String(err) })
    }
  }

  /**
   * Promote a channel to the front of a user's preference list.
   * Called automatically when EDITH receives a message from a user on a channel.
   *
   * If the channel is already first, this is a no-op (no DB write).
   *
   * @param userId - Target user
   * @param channelName - Channel to promote (e.g. "telegram")
   */
  async promoteChannel(userId: string, channelName: string): Promise<void> {
    const current = await this.getChannelOrder(userId)

    // Already first — skip DB write
    if (current[0] === channelName) return

    // Remove any existing occurrence, then prepend
    const updated = [channelName, ...current.filter((c) => c !== channelName)]
    await this.setChannelOrder(userId, updated)
    log.debug("channel promoted", { userId, channelName })
  }

  /**
   * Clear the in-memory cache for a user (forces next read from DB).
   * Useful after external preference updates.
   *
   * @param userId - Target user
   */
  invalidateCache(userId: string): void {
    this.cache.delete(userId)
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Write a preference entry into the in-memory cache.
   * Evicts the oldest entry if the cache is at capacity.
   *
   * @param userId - Cache key
   * @param channelOrder - Order to store
   */
  private setCacheEntry(userId: string, channelOrder: string[]): void {
    if (this.cache.size >= CACHE_MAX_SIZE && !this.cache.has(userId)) {
      // Evict the first (oldest) key
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(userId, { channelOrder, fetchedAt: Date.now() })
  }
}

/**
 * Merge a user's preferred channel order with the global fallback order.
 *
 * The result contains every channel from `globalOrder` exactly once:
 *   - Channels in `userOrder` appear first, in the user's preferred sequence.
 *   - Remaining channels from `globalOrder` appear after, in their original order.
 *
 * Example:
 *   userOrder   = ["whatsapp", "discord"]
 *   globalOrder = ["telegram", "discord", "whatsapp", "sms", "email"]
 *   result      = ["whatsapp", "discord", "telegram", "sms", "email"]
 *
 * @param userOrder - User's preferred channels (subset of globalOrder)
 * @param globalOrder - Full system-default channel priority list
 * @returns Merged order with user preferences first
 */
export function mergeChannelOrder(userOrder: string[], globalOrder: string[]): string[] {
  // TODO: Implement this function.
  //
  // What it should do:
  //   1. Start with the user's preferred channels that actually exist in globalOrder.
  //   2. Append any remaining globalOrder channels that weren't in userOrder.
  //
  // Constraints:
  //   - Every channel in globalOrder must appear exactly once in the result.
  //   - Channels from userOrder that don't exist in globalOrder should be ignored
  //     (the channel may not be registered on this instance).
  //   - If userOrder is empty, the result equals globalOrder unchanged.
  //
  // The example in the JSDoc above shows the expected behavior.
  // This is ~5 lines of code. Consider: Set for O(1) lookups, filter, spread.

  const inGlobal = new Set(globalOrder)
  const front = userOrder.filter(ch => inGlobal.has(ch))
  const frontSet = new Set(front)
  return [...front, ...globalOrder.filter(ch => !frontSet.has(ch))]
}

/** Singleton instance. */
export const userChannelPrefs = new UserChannelPrefs()
