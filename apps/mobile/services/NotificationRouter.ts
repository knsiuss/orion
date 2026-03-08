/**
 * @file NotificationRouter.ts
 * @description Route push notifications to correct app screens.
 *
 * ARCHITECTURE:
 *   Setiap notifikasi punya `category` di data payload.
 *   NotificationRouter maps category → navigation action.
 *   Mendukung deep links dan screen navigation.
 *
 * CATEGORIES:
 *   chat_message      → Chat screen (dengan highlightMessageId jika ada)
 *   meeting_reminder  → Chat screen + auto-send "brief my next meeting"
 *   proactive_suggestion → Chat screen
 *   mission_update    → Chat screen
 *   security_alert    → Settings screen
 *   daily_brief       → Chat screen
 *
 * DIPANGGIL dari:
 *   App.tsx → setupNotificationListeners callback
 */

import type { NotificationResponse } from "expo-notifications"

/** Action yang akan dilakukan setelah user tap notif */
export interface NotifAction {
  /** Target screen to navigate to */
  screen: "Chat" | "Settings" | "Voice"
  /** Additional navigation params */
  params?: Record<string, string>
  /** If set, automatically send this message to EDITH */
  autoMessage?: string
}

/**
 * Route notification response ke navigation action.
 *
 * @param response - Expo notification response (dari user tap)
 * @returns Action yang harus dilakukan navigator
 */
export function routeNotification(response: NotificationResponse): NotifAction {
  const data =
    (response.notification.request.content.data as Record<string, string> | null) ??
    {}
  const category = data["category"] ?? "chat_message"
  const actionId = response.actionIdentifier

  // Handle action buttons (e.g., "snooze", "join")
  if (actionId && actionId !== "default") {
    return handleAction(actionId, data)
  }

  // Route by category
  switch (category) {
    case "meeting_reminder":
      return {
        screen: "Chat",
        params: { from: "meeting_reminder" },
        autoMessage: "Brief saya tentang meeting berikutnya",
      }
    case "security_alert":
      return {
        screen: "Settings",
        params: { highlight: "security" },
      }
    case "voice_request":
      return { screen: "Voice" }
    case "chat_message":
    case "proactive_suggestion":
    case "mission_update":
    case "mission_approval":
    case "daily_brief":
    default:
      return {
        screen: "Chat",
        params:
          Object.keys(data).length > 0
            ? { notifData: JSON.stringify(data) }
            : undefined,
      }
  }
}

/**
 * Handle action button taps from notification banner.
 *
 * @param actionId - The action identifier string
 * @param data     - Notification payload data
 */
function handleAction(
  actionId: string,
  data: Record<string, string>,
): NotifAction {
  switch (actionId) {
    case "join_meeting":
      return {
        screen: "Chat",
        autoMessage: `Join meeting: ${data["meetingUrl"] ?? ""}`,
      }
    case "snooze_5min":
      return {
        screen: "Chat",
        autoMessage: "Snooze reminder 5 menit",
      }
    case "dismiss":
    default:
      return { screen: "Chat" }
  }
}
