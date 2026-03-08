/**
 * @file session-key.ts
 * @description Session key manager — maintains conversation continuity across channel hops.
 *
 * ARCHITECTURE / INTEGRATION:
 *   When a user hops from Telegram → Discord mid-conversation, the same session key
 *   ensures EDITH treats it as one continuous conversation.
 *   Key = HMAC(userId + channelId + timestamp) with 4-hour TTL.
 *   Used by ChannelManager to route cross-channel continuations to the same session.
 *
 *   Prune expired sessions periodically (call prune() every hour).
 */
import { createHmac, randomBytes } from 'node:crypto'
import { createLogger } from '../logger.js'

const log = createLogger('routing.session-key')

/** Session TTL — 4 hours of inactivity before expiry. */
const SESSION_TTL_MS = 4 * 60 * 60 * 1000

/** HMAC secret — generated fresh on process start (non-persistent by design). */
const SECRET = randomBytes(32).toString('hex')

/** In-memory session key entry. */
interface SessionKeyEntry {
  /** The HMAC-derived session key (32 hex chars). */
  key: string
  /** User this session belongs to. */
  userId: string
  /** All channels active in this session. */
  channels: Set<string>
  /** When the session key was created. */
  createdAt: number
  /** When the session was last touched. */
  lastActiveAt: number
}

/**
 * Manages cross-channel session keys for conversation continuity.
 * A user hopping channels within the TTL window reuses the same session key.
 */
class SessionKeyManager {
  private sessions = new Map<string, SessionKeyEntry>()

  /**
   * Get or create a session key for a user+channel combination.
   * Returns the same key if the user has an active session on any other channel.
   * @param userId - The authenticated user ID
   * @param channelId - The channel identifier (e.g. 'telegram', 'discord')
   * @returns 32-character session key
   */
  getOrCreate(userId: string, channelId: string): string {
    const existing = this.findActiveSession(userId)
    if (existing) {
      existing.channels.add(channelId)
      existing.lastActiveAt = Date.now()
      log.debug('session key reused for channel hop', {
        userId,
        channelId,
        key: existing.key.slice(0, 8),
      })
      return existing.key
    }

    const key = createHmac('sha256', SECRET)
      .update(`${userId}:${channelId}:${Date.now()}`)
      .digest('hex')
      .slice(0, 32)

    this.sessions.set(key, {
      key,
      userId,
      channels: new Set([channelId]),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    })

    log.debug('new session key created', { userId, channelId, key: key.slice(0, 8) })
    return key
  }

  /**
   * Touch a session (update lastActive).
   * @param key - The session key to touch
   * @returns False if session not found or expired
   */
  touch(key: string): boolean {
    const session = this.sessions.get(key)
    if (!session) return false
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(key)
      return false
    }
    session.lastActiveAt = Date.now()
    return true
  }

  /**
   * Get the userId for a session key.
   * @param key - The session key to look up
   * @returns userId or null if expired/not found
   */
  getUserId(key: string): string | null {
    const session = this.sessions.get(key)
    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) return null
    return session.userId
  }

  /**
   * Get channels active in this session (for cross-channel delivery).
   * @param key - The session key
   * @returns Array of channel identifiers
   */
  getChannels(key: string): string[] {
    return [...(this.sessions.get(key)?.channels ?? [])]
  }

  /** Find active session for a user across all channels. */
  private findActiveSession(userId: string): SessionKeyEntry | null {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (session.userId === userId && now - session.createdAt < SESSION_TTL_MS) {
        return session
      }
    }
    return null
  }

  /**
   * Prune expired sessions.
   * @returns Number of sessions removed
   */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(key)
        removed++
      }
    }
    if (removed > 0) log.debug('pruned expired session keys', { removed })
    return removed
  }

  /** Number of active sessions in memory. */
  get size(): number {
    return this.sessions.size
  }
}

/** Singleton session key manager. */
export const sessionKeyManager = new SessionKeyManager()
