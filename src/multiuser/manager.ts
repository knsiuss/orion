/**
 * @file manager.ts
 * @description Multi-user management with database persistence via Prisma.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses an in-memory cache backed by a Map for fast lookups, with Prisma
 *   UserProfile as the persistence layer. Falls back gracefully when the
 *   database is unavailable (e.g. during tests).
 */
import { createLogger } from "../logger.js"
import config from "../config.js"
import { prisma } from "../database/index.js"

const logger = createLogger("multiuser")

export interface UserProfile {
  userId: string
  displayName: string
  channel: string
  createdAt: Date
  lastSeen: Date
}

export class MultiUserManager {
  /** Hot cache — avoids hitting the DB on every message. */
  private cache = new Map<string, UserProfile>()

  async registerUser(
    userId: string,
    displayName: string,
    channel: string
  ): Promise<UserProfile> {
    const now = new Date()
    const profile: UserProfile = {
      userId,
      displayName,
      channel,
      createdAt: now,
      lastSeen: now
    }
    this.cache.set(userId, profile)

    // Persist to DB — upsert so we don't crash on duplicate keys
    try {
      await prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          facts: JSON.stringify({ displayName, channel }),
          opinions: "{}",
          topics: "[]",
        },
        update: {
          facts: JSON.stringify({ displayName, channel }),
        },
      })
    } catch (err) {
      logger.warn("failed to persist user registration", { userId, err })
    }

    logger.info("user registered", { userId, channel })
    return profile
  }

  async getOrCreate(
    userId: string,
    channel: string
  ): Promise<UserProfile> {
    if (this.cache.has(userId)) {
      const user = this.cache.get(userId)!
      user.lastSeen = new Date()
      return user
    }

    // Try loading from DB
    try {
      const row = await prisma.userProfile.findUnique({ where: { userId } })
      if (row) {
        const facts = typeof row.facts === "string" ? JSON.parse(row.facts as string) : (row.facts as Record<string, unknown>)
        const profile: UserProfile = {
          userId: row.userId,
          displayName: (facts.displayName as string) ?? userId,
          channel: (facts.channel as string) ?? channel,
          createdAt: row.updatedAt,
          lastSeen: new Date(),
        }
        this.cache.set(userId, profile)
        return profile
      }
    } catch (err) {
      logger.warn("failed to load user from DB, creating in-memory", { userId, err })
    }

    return this.registerUser(userId, userId, channel)
  }

  getUser(userId: string): UserProfile | undefined {
    return this.cache.get(userId)
  }

  listUsers(): UserProfile[] {
    return Array.from(this.cache.values())
  }

  isOwner(userId: string): boolean {
    return userId === config.DEFAULT_USER_ID
  }

  async removeUser(userId: string): Promise<void> {
    if (this.isOwner(userId)) {
      throw new Error("Cannot remove owner")
    }
    this.cache.delete(userId)

    try {
      await prisma.userProfile.delete({ where: { userId } })
    } catch {
      // Ignore if not found
    }

    logger.info("user removed", { userId })
  }
}

export const multiUser = new MultiUserManager()
