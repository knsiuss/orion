/**
 * @file App.tsx
 * @description EDITH Mobile — Full companion app (Phase 16).
 *
 * ARCHITECTURE:
 *   Existing: WebSocket chat (connect → send → receive → display)
 *   Phase 16 additions:
 *   - Push notification registration (PushHandler)
 *   - Notification routing (NotificationRouter)
 *   - Background sync registration (BackgroundSyncTask)
 *   - Offline queue (OfflineQueue)
 *   - Deep link handling (DeepLinkRouter)
 *
 * STARTUP SEQUENCE:
 *   1. BackgroundSyncTask.ts define task (global scope — sebelum component)
 *   2. App mounts → registerForPushNotifications()
 *   3. App mounts → registerBackgroundSync()
 *   4. App mounts → setup Linking + notification listeners
 *   5. WS connected → flush OfflineQueue
 */

// ── GLOBAL SCOPE: background task definition ──────────────────────────────────
// HARUS import di global scope agar task terdefinisi sebelum app mount
import "./services/BackgroundSyncTask" // Side effect: defineTask() dipanggil

import React, { useEffect, useRef, useState, useCallback } from "react"
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
  AppState,
} from "react-native"
import * as Linking from "expo-linking"
import {
  registerForPushNotifications,
  setupNotificationListeners,
} from "./services/PushHandler"
import { routeNotification } from "./services/NotificationRouter"
import { registerBackgroundSync, syncNow } from "./services/BackgroundSyncTask"
import { offlineQueue } from "./services/OfflineQueue"
import { parseDeepLink } from "./services/DeepLinkRouter"
import NetInfo from "@react-native-community/netinfo"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  /** true while the message is queued offline and not yet delivered */
  pending?: boolean
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [connected, setConnected] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [gatewayUrl] = useState("ws://192.168.1.1:18789/ws")
  const ws = useRef<WebSocket | null>(null)
  const listRef = useRef<FlatList>(null)

  // ── Lifecycle listeners ───────────────────────────────────────────────────
  useEffect(() => {
    // 1. Network state listener
    const unsubNet = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false)
    })

    // 2. Push notification setup
    void registerForPushNotifications()
    const cleanupNotif = setupNotificationListeners((response) => {
      const action = routeNotification(response)
      // Phase 16F: navigate(action.screen, action.params)
      if (action.autoMessage) {
        setInput(action.autoMessage)
      }
    })

    // 3. Background sync registration
    void registerBackgroundSync()

    // 4. Deep link listener (while app is foregrounded)
    const deepLinkSub = Linking.addEventListener("url", ({ url }) => {
      const action = parseDeepLink(url)
      if (action?.autoMessage) setInput(action.autoMessage)
    })

    // 5. Sync when app returns to foreground
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncNow()
      }
    })

    return () => {
      unsubNet()
      cleanupNotif()
      deepLinkSub.remove()
      appStateSub.remove()
    }
  }, [])

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    connect()
    return () => ws.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl])

  function connect() {
    ws.current = new WebSocket(gatewayUrl)

    ws.current.onopen = async () => {
      setConnected(true)
      // Flush offline queue — messages queued while disconnected
      const flushed = await offlineQueue.flush(
        (msg) => ws.current?.send(msg),
        "owner",
      )
      if (flushed > 0) {
        console.log(`[App] Flushed ${flushed} queued messages`)
      }
    }

    ws.current.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as {
        type: string
        content?: string
      }
      if (msg.type === "response" && msg.content) {
        setThinking(false)
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: msg.content ?? "",
            timestamp: new Date(),
          },
        ])
      }
    }

    ws.current.onclose = () => {
      setConnected(false)
      setTimeout(connect, 3000) // reconnect after 3 s
    }

    ws.current.onerror = () => {
      setConnected(false)
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!input.trim()) return
    const content = input.trim()
    setInput("")

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setTimeout(() => listRef.current?.scrollToEnd(), 100)

    if (connected && ws.current?.readyState === WebSocket.OPEN) {
      // Online: send immediately
      setThinking(true)
      ws.current.send(
        JSON.stringify({ type: "message", content, userId: "owner" }),
      )
    } else {
      // Offline: persist to queue and mark pending
      await offlineQueue.enqueue({
        content,
        timestamp: new Date().toISOString(),
        userId: "owner",
      })
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMsg.id ? { ...m, pending: true } : m,
        ),
      )
    }
  }, [input, connected])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" />

      <View style={s.header}>
        <Text style={s.headerTitle}>EDITH</Text>
        <View style={s.statusRow}>
          {!isOnline && <Text style={s.offlineTag}>OFFLINE</Text>}
          <View
            style={[
              s.dot,
              { backgroundColor: connected ? "#22c55e" : "#ef4444" },
            ]}
          />
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        style={s.list}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View
            style={[
              s.bubble,
              item.role === "user" ? s.userBubble : s.aiBubble,
            ]}
          >
            <Text
              style={[
                s.bubbleText,
                item.role === "user" ? s.userText : s.aiText,
              ]}
            >
              {item.content}
            </Text>
            {item.pending === true && (
              <Text style={s.pendingTag}>⏳ akan dikirim saat online</Text>
            )}
          </View>
        )}
        ListFooterComponent={
          thinking ? (
            <Text style={s.thinking}>EDITH sedang berpikir...</Text>
          ) : null
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Pesan EDITH..."
            placeholderTextColor="#555"
            multiline
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <TouchableOpacity style={s.sendBtn} onPress={send}>
            <Text style={s.sendText}>{"→"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  offlineTag: { color: "#f59e0b", fontSize: 11, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  bubble: {
    maxWidth: "80%",
    marginVertical: 4,
    padding: 12,
    borderRadius: 16,
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1d4ed8" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#1a1a1a" },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  aiText: { color: "#e5e5e5" },
  pendingTag: { color: "#f59e0b", fontSize: 11, marginTop: 4 },
  thinking: {
    color: "#555",
    fontSize: 13,
    paddingLeft: 12,
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
  },
  input: {
    flex: 1,
    color: "#fff",
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: "#1d4ed8",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 18 },
})
