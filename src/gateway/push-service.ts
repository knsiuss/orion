/**
 * @file push-service.ts
 * @description Server-side push notification delivery via Expo Push Service.
 *
 * ARCHITECTURE:
 *   Expo Push Service = unified gateway ke FCM (Android) + APNs (iOS).
 *   Kita pakai Expo Push API karena:
 *   1. Cross-platform: satu API untuk iOS dan Android
 *   2. No SDK dependency: cukup HTTP POST ke exp.host
 *   3. Delivery receipts: bisa track apakah notif terdeliver
 *   4. Free tier cukup untuk personal use
 *
 *   Jika perlu control lebih: ganti ke FCM V1 + APNs direct (config ada di Atom 0).
 *
 * PRIORITY SYSTEM:
 *   critical  → kirim segera, bypass DND, bypass rate limit
 *   high      → kirim segera, respect DND
 *   normal    → kirim segera, batched jika ada banyak dalam 5 menit
 *   low       → max MAX_DAILY_LOW_PRIORITY per hari, respect DND
 *
 * DIPANGGIL dari:
 *   - daemon.ts checkCalendarAlerts() → meeting reminders
 *   - daemon.ts checkProactiveSchedule() → proactive suggestions
 *   - channels/manager.ts broadcast() → cross-channel delivery (Phase 8)
 *   - Masa depan: mission updates (Phase 22), security alerts (Phase 17)
 *
 * REF: https://docs.expo.dev/push-notifications/sending-notifications/
 */

import config from "../config.js"
import { createLogger } from "../logger.js"
import { pushTokenStore } from "./push-tokens.js"

const log = createLogger("gateway.push-service")

// ── Types ────────────────────────────────────────────────────────────────────

/** Prioritas notifikasi — mempengaruhi delivery timing dan sound */
export type NotificationPriority = "critical" | "high" | "normal" | "low"

/** Kategori notifikasi — menentukan behavior dan action buttons */
export type NotificationCategory =
  | "chat_message"         // Pesan baru dari EDITH
  | "meeting_reminder"     // Reminder meeting dari calendar (Phase 14)
  | "proactive_suggestion" // Saran proaktif dari daemon
  | "mission_update"       // Update mission status (Phase 22)
  | "mission_approval"     // Butuh persetujuan user (Phase 22)
  | "security_alert"       // Alert keamanan (Phase 17)
  | "daily_brief"          // Morning brief harian

/** Action button pada notifikasi */
export interface NotificationAction {
  /** ID action — dikirim kembali ke gateway saat user tap */
  id: string
  /** Teks yang tampil di tombol */
  title: string
  /** Jika true, tampil merah (destructive action) */
  destructive?: boolean
}

/** Payload notifikasi yang dikirim ke PushService */
export interface PushNotification {
  /** Target user */
  userId: string
  /** Judul notifikasi */
  title: string
  /** Body teks notifikasi */
  body: string
  /** Prioritas — lihat NotificationPriority */
  priority: NotificationPriority
  /** Kategori — menentukan action buttons */
  category: NotificationCategory
  /** Data tambahan untuk deep linking di app */
  data?: Record<string, string>
  /** Action buttons (max 3 di iOS, 1 di Android) */
  actions?: NotificationAction[]
  /**
   * Collapse key: notifikasi dengan key yang sama akan replace yang lama.
   * Berguna untuk: "EDITH is thinking..." yang selalu replace sebelumnya.
   */
  collapseKey?: string
  /** TTL dalam detik — lewat TTL, notif tidak dikirim jika belum terdeliver */
  ttlSeconds?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Expo Push Service endpoint */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

/** Max notifikasi low-priority per user per hari */
const MAX_DAILY_LOW_PRIORITY = config.PUSH_MAX_DAILY_LOW_PRIORITY

/** In-memory daily counter untuk low-priority rate limiting */
const dailyLowPriorityCount = new Map<string, { count: number; date: string }>()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when the current local time falls inside the configured quiet window.
 * Supports overnight windows (e.g. 23:00–07:00).
 */
function isInQuietHours(): boolean {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const [startH, startM] = config.PUSH_QUIET_HOURS_START.split(":").map(Number)
  const [endH, endM] = config.PUSH_QUIET_HOURS_END.split(":").map(Number)
  const startMinutes = (startH ?? 23) * 60 + (startM ?? 0)
  const endMinutes = (endH ?? 7) * 60 + (endM ?? 0)

  // Overnight window (e.g. 23:00 → 07:00 next day)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

/**
 * Check and increment the daily low-priority counter for `userId`.
 * Resets automatically at midnight.
 *
 * @returns `true` if within limit (delivery allowed), `false` if exceeded
 */
function checkLowPriorityRateLimit(userId: string): boolean {
  const today = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
  const entry = dailyLowPriorityCount.get(userId)

  if (!entry || entry.date !== today) {
    dailyLowPriorityCount.set(userId, { count: 1, date: today })
    return true
  }

  if (entry.count >= MAX_DAILY_LOW_PRIORITY) {
    log.debug("low-priority rate limit exceeded", {
      userId,
      count: entry.count,
      limit: MAX_DAILY_LOW_PRIORITY,
    })
    return false
  }

  entry.count++
  return true
}

// ── PushService ───────────────────────────────────────────────────────────────

/** Server-side push notification delivery via Expo Push API. */
export class PushService {
  /**
   * Send a push notification to all registered devices for `userId`.
   *
   * Checks quiet hours and rate limits before dispatching.
   * Critical notifications always bypass quiet-hours and rate limits.
   *
   * @param notification - Full notification payload
   */
  async send(notification: PushNotification): Promise<void> {
    const { userId, priority, category } = notification

    // 1. Quiet hours check (critical bypasses DND)
    if (priority !== "critical" && isInQuietHours()) {
      log.debug("notification suppressed: quiet hours", { userId, category })
      return
    }

    // 2. Low-priority rate limit
    if (priority === "low" && !checkLowPriorityRateLimit(userId)) {
      return // silently drop
    }

    // 3. Resolve target tokens
    const tokens = await pushTokenStore.getTokens(userId)
    if (tokens.length === 0) {
      log.debug("no push tokens registered", { userId })
      return
    }

    // 4. Dry run mode for development/testing
    if (config.PUSH_DRY_RUN) {
      log.info("[DRY RUN] push notification", {
        userId,
        title: notification.title,
        category,
        tokenCount: tokens.length,
      })
      return
    }

    // 5. Dispatch via Expo Push API
    await this.dispatchToExpo(tokens, notification)
  }

  /**
   * Low-level dispatch to Expo Push Service.
   * Processes delivery tickets and auto-deregisters stale tokens.
   *
   * @param tokens - Array of Expo push tokens
   * @param notif  - Notification payload
   */
  private async dispatchToExpo(
    tokens: string[],
    notif: PushNotification,
  ): Promise<void> {
    const expoPriority =
      notif.priority === "critical" || notif.priority === "high" ? "high" : "normal"

    const messages = tokens.map((to) => ({
      to,
      title: notif.title,
      body: notif.body,
      priority: expoPriority,
      sound: "default" as const,
      badge: 1,
      data: {
        category: notif.category,
        ...(notif.data ?? {}),
      },
      ...(notif.collapseKey ? { collapseId: notif.collapseKey } : {}),
      ttl: notif.ttlSeconds ?? 86_400,
      channelId: notif.category, // Android notification channel
    }))

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(config.EXPO_PUSH_ACCESS_TOKEN
            ? { Authorization: `Bearer ${config.EXPO_PUSH_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(messages),
      })

      if (!response.ok) {
        log.error("expo push API error", {
          status: response.status,
          userId: notif.userId,
        })
        return
      }

      const result = (await response.json()) as {
        data: Array<{
          status: string
          id?: string
          message?: string
          details?: { error?: string }
        }>
      }

      // Process delivery tickets — deregister stale/invalid tokens
      for (let i = 0; i < result.data.length; i++) {
        const ticket = result.data[i]
        if (ticket?.status === "error") {
          const errorCode = ticket.details?.error
          if (errorCode === "DeviceNotRegistered") {
            const invalidToken = tokens[i]
            if (invalidToken) {
              void pushTokenStore
                .deregister(invalidToken)
                .catch((err) =>
                  log.warn("failed to deregister invalid token", { err }),
                )
            }
          } else {
            log.warn("push delivery error", {
              errorCode,
              message: ticket.message,
              userId: notif.userId,
            })
          }
        }
      }

      log.info("push notification sent", {
        userId: notif.userId,
        category: notif.category,
        tokenCount: tokens.length,
      })
    } catch (err) {
      log.error("expo push dispatch failed", {
        userId: notif.userId,
        err: String(err),
      })
    }
  }
}

/** Singleton push-service instance — import this everywhere. */
export const pushService = new PushService()
