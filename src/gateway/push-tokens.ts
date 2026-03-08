/**
 * @file push-tokens.ts
 * @description Expo push-token registry — persist, retrieve, and deregister
 * device tokens for mobile push notification delivery.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by `push-service.ts` to fan-out notifications to all user devices.
 *   - Routes in `server.ts` call `pushTokenStore.register()` on app start-up.
 *   - On Expo `DeviceNotRegistered` ticket, `push-service.ts` calls `deregister()`.
 *
 * TOKEN FORMAT:
 *   Expo tokens have the form  ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxx]
 *   We validate with a dedicated regex before persisting.
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.push-tokens")

/** Regex that matches a valid Expo push token. */
const EXPO_TOKEN_RE = /^ExponentPushToken\[[\w-]+\]$/

/**
 * Returns true when `token` is a syntactically valid Expo push token.
 * Does NOT verify whether the token is currently registered with Expo servers.
 *
 * @param token - Raw token string received from the mobile client
 */
export function isValidExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_RE.test(token)
}

/**
 * Persistent store for Expo push tokens backed by the `PushToken` Prisma model.
 *
 * One user can own many tokens (phone + tablet + multiple installs).
 */
export class PushTokenStore {
  /**
   * Register or refresh a push token for a user.
   *
   * If the token already exists the `lastSeenAt` timestamp and `appVersion`
   * are updated in-place (upsert semantics).
   *
   * @param userId     - Canonical user identifier
   * @param token      - Expo push token  `ExponentPushToken[…]`
   * @param platform   - `"ios"` or `"android"`
   * @param appVersion - Semver string from the app bundle (default `""`)
   * @throws When `token` is not a valid Expo token format
   */
  async register(
    userId: string,
    token: string,
    platform: "ios" | "android",
    appVersion: string = "",
  ): Promise<void> {
    if (!isValidExpoPushToken(token)) {
      throw new Error(`Invalid Expo push token: ${token}`)
    }

    await prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform, appVersion, lastSeenAt: new Date() },
      update: { userId, platform, appVersion, lastSeenAt: new Date() },
    })

    log.debug("push token registered", { userId, platform, appVersion })
  }

  /**
   * Return all active push tokens for a user.
   *
   * @param userId - Canonical user identifier
   * @returns Array of raw Expo token strings (may be empty)
   */
  async getTokens(userId: string): Promise<string[]> {
    const rows = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    })
    return rows.map((r) => r.token)
  }

  /**
   * Deregister a single token.
   *
   * Called automatically when Expo returns a `DeviceNotRegistered` delivery
   * receipt.  A missing token is silently ignored.
   *
   * @param token - The token to deregister
   */
  async deregister(token: string): Promise<void> {
    try {
      await prisma.pushToken.delete({ where: { token } })
      log.debug("push token deregistered", { token: token.slice(-8) })
    } catch {
      // Record already gone — no-op
    }
  }

  /**
   * Remove every push token belonging to `userId`.
   *
   * Used when a user signs out of all devices or deletes their account.
   *
   * @param userId - Canonical user identifier
   */
  async clearAll(userId: string): Promise<void> {
    await prisma.pushToken.deleteMany({ where: { userId } })
    log.info("all push tokens cleared", { userId })
  }
}

/** Singleton push-token store — import this everywhere. */
export const pushTokenStore = new PushTokenStore()
