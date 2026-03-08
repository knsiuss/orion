/**
 * @file PushHandler.ts
 * @description Mobile push notification registration and handler.
 *
 * ARCHITECTURE:
 *   Dipanggil dari App.tsx saat startup (useEffect on mount).
 *   Register Expo push token ke gateway → tersimpan di PushTokenStore.
 *   Handle incoming notifications: foreground (show alert) + background (route deep link).
 *
 * SECURITY:
 *   Token disimpan ke expo-secure-store (encrypted, bukan AsyncStorage).
 *   Token hanya dikirim ke gateway kita sendiri (bukan third party).
 *
 * PERMISSIONS:
 *   iOS: minta permission di sini (requestPermissionsAsync).
 *   Android: permission otomatis jika minSdk >= 33, minta manual jika belum.
 *
 * DIPANGGIL dari: App.tsx useEffect on mount
 * NOTIFY ke: NotificationRouter saat ada incoming notif
 */

import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

/** Konfigurasi bagaimana notif ditampilkan saat app di foreground */
Notifications.setNotificationHandler({
  handleNotification: async (notif) => {
    return {
      shouldShowBanner: true,
      shouldPlaySound:
        notif.request.content.data?.["category"] !== "proactive_suggestion",
      shouldSetBadge: true,
      shouldShowList: true,
    }
  },
})

/** Key untuk expo-secure-store */
const PUSH_TOKEN_STORE_KEY = "edith_push_token"

/** URL gateway dari secure store atau default lokal */
async function getGatewayUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync("edith_gateway_url")
  return stored ?? "http://192.168.1.1:18789"
}

/** Auth token dari secure store */
async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync("edith_auth_token")
}

/**
 * Register device untuk push notifications.
 * Minta permission → get Expo token → simpan ke gateway.
 *
 * @returns Expo push token atau null jika gagal/tidak punya permission
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Cek physical device (emulator tidak support push)
  if (!Device.isDevice) {
    console.warn("[PushHandler] Push notifications only work on physical devices")
    return null
  }

  // Cek dan minta permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== "granted") {
    console.warn("[PushHandler] Push notification permission denied")
    return null
  }

  // Setup Android notification channels
  if (Platform.OS === "android") {
    await setupAndroidChannels()
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: undefined, // Uses app.json projectId
    })
    const token = tokenData.data

    // Cache token locally
    await SecureStore.setItemAsync(PUSH_TOKEN_STORE_KEY, token)

    // Register token ke gateway
    await registerTokenToGateway(token)

    return token
  } catch (err) {
    console.error("[PushHandler] Failed to get push token:", err)
    return null
  }
}

/**
 * Register Expo push token ke EDITH gateway.
 * Gateway akan simpan ke PushTokenStore → dipakai saat send notif.
 *
 * @param token - Expo push token `ExponentPushToken[…]`
 */
async function registerTokenToGateway(token: string): Promise<void> {
  const gatewayUrl = await getGatewayUrl()
  const authToken = await getAuthToken()

  if (!authToken) {
    console.warn("[PushHandler] No auth token — skip gateway registration")
    return
  }

  const httpUrl = gatewayUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
  const baseUrl = httpUrl.replace("/ws", "")

  try {
    const resp = await fetch(`${baseUrl}/api/mobile/register-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS as "ios" | "android",
        appVersion: "0.1.0",
      }),
    })

    if (!resp.ok) {
      console.error("[PushHandler] Gateway token registration failed:", resp.status)
    }
  } catch (err) {
    console.warn("[PushHandler] Failed to register token to gateway:", err)
    // Tidak throw — app tetap jalan meski registrasi gagal
  }
}

/**
 * Setup Android notification channels (required for API 26+).
 * Channel menentukan sound, importance, dan vibration pattern.
 */
async function setupAndroidChannels(): Promise<void> {
  const channels = [
    {
      id: "chat_message",
      name: "Messages",
      importance: Notifications.AndroidImportance.HIGH,
    },
    {
      id: "meeting_reminder",
      name: "Meeting Reminders",
      importance: Notifications.AndroidImportance.HIGH,
    },
    {
      id: "proactive_suggestion",
      name: "EDITH Suggestions",
      importance: Notifications.AndroidImportance.DEFAULT,
    },
    {
      id: "mission_update",
      name: "Mission Updates",
      importance: Notifications.AndroidImportance.HIGH,
    },
    {
      id: "security_alert",
      name: "Security Alerts",
      importance: Notifications.AndroidImportance.MAX,
    },
    {
      id: "daily_brief",
      name: "Daily Brief",
      importance: Notifications.AndroidImportance.DEFAULT,
    },
  ]

  await Promise.all(
    channels.map((ch) =>
      Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        importance: ch.importance,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#1d4ed8",
      }),
    ),
  )
}

/**
 * Setup notification response listener (user tap).
 *
 * @param onNotificationResponse - Called when user taps a notification
 * @returns Cleanup function — call in useEffect return
 */
export function setupNotificationListeners(
  onNotificationResponse: (
    response: Notifications.NotificationResponse,
  ) => void,
): () => void {
  const tapSub = Notifications.addNotificationResponseReceivedListener(
    onNotificationResponse,
  )
  return () => tapSub.remove()
}
