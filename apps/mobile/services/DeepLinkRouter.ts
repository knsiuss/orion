/**
 * @file DeepLinkRouter.ts
 * @description Handle edith:// deep link scheme for external navigation.
 *
 * SUPPORTED DEEP LINKS:
 *   edith://chat              → Open chat screen
 *   edith://chat?msg=xxx      → Open chat + pre-fill message
 *   edith://voice             → Open voice screen
 *   edith://settings          → Open settings
 *   edith://meeting?id=xxx    → Open chat + query meeting brief
 *
 * SETUP di app.json:
 *   "scheme": "edith"
 *   expo-linking handles the URL parsing
 *
 * DIPANGGIL dari:
 *   App.tsx Linking.addEventListener
 *   NotificationRouter (saat notification tap dengan deep link)
 */

import * as Linking from "expo-linking"

/** Navigation action resolved from a deep link URL */
export interface ParsedDeepLink {
  /** Target screen */
  screen: "Chat" | "Voice" | "Settings"
  /** Optional navigation params */
  params?: Record<string, string>
  /** If set, automatically pre-fill and send this message */
  autoMessage?: string
}

/**
 * Parse a deep link URL into a navigation action.
 *
 * @param url - `edith://…` URL string
 * @returns Parsed action, or `null` if the URL is not recognised
 */
export function parseDeepLink(url: string): ParsedDeepLink | null {
  const parsed = Linking.parse(url)
  const path = parsed.path ?? ""
  const params = (parsed.queryParams ?? {}) as Record<string, string>

  if (path.startsWith("chat") || path === "") {
    return {
      screen: "Chat",
      params,
      autoMessage: params["msg"],
    }
  }

  if (path.startsWith("voice")) {
    return { screen: "Voice" }
  }

  if (path.startsWith("settings")) {
    return { screen: "Settings", params }
  }

  if (path.startsWith("meeting")) {
    return {
      screen: "Chat",
      autoMessage: `Brief saya tentang meeting ${params["id"] ?? "berikutnya"}`,
    }
  }

  return null
}
