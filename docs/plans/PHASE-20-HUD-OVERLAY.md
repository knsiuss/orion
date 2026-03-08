# Phase 20 — HUD Overlay & Ambient Display

> "JARVIS punya layar hologram di mana-mana. EDITH butuh wajah yang selalu terlihat."

**Prioritas:** 🟡 MEDIUM — Memberikan EDITH kehadiran visual yang persistent
**Depends on:** Phase 12 (desktop app), Phase 6 (proactive triggers), Phase 8 (channels)
**Status:** ❌ Not started

---

## 1. Tujuan

EDITH saat ini hanya muncul kalau user buka app Electron. Phase ini membuat EDITH
**selalu hadir** di layar dalam bentuk overlay transparan — minimal, non-intrusive,
tapi selalu siap. Seperti HUD di helm Iron Man: informasi kontekstual tanpa blocking workflow.

```mermaid
flowchart TD
    subgraph Desktop["💻 Desktop Environment"]
        direction TB
        App["Active App\n(VS Code, Browser, etc.)"]
        
        subgraph HUD["🔵 EDITH HUD Overlay (Always On Top)"]
            direction LR
            Status["⚡ Status Ring\n(listening/thinking/idle)"]
            Cards["📋 Context Cards\n(weather, calendar, tasks)"]
            Notif["🔔 Notification Stack\n(priority-sorted)"]
            Quick["⌨️ Quick Input\n(mini command bar)"]
        end
    end

    Gateway["🌐 Gateway\n(WebSocket)"] --> HUD
    Voice["🎤 Voice\n(Phase 1)"] --> Status
    Proactive["⚡ Proactive\n(Phase 6)"] --> Cards
    Channels["📡 Channels\n(Phase 8)"] --> Notif
    
    HUD --> |"Click / Voice\nExpand"| FullApp["🖥️ Full EDITH App"]
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | Ambient Notification Management (Microsoft Research) | MSR-TR-2020-07 | Priority-based notification interruption model — kapan boleh interrupt user |
| 2 | Attention-Aware Systems (CMU HCI) | doi:10.1145/3290605.3300275 | Gaze+activity → attention state → overlay visibility |
| 3 | Electron Transparent Windows (Electron docs) | electron.atom.io | `transparent: true`, `alwaysOnTop`, click-through overlay patterns |
| 4 | Framer Motion (open source) | framer.com/motion | Fluid animation primitives for card reveal/dismiss |
| 5 | The Costs of Interruption (CHI 2004) | doi:10.1145/985692.985715 | "Interupsi di momen yang salah = 23 menit recovery." Basis timing model |
| 6 | Designing Peripheral Displays (Ambient Devices) | doi:10.1145/642611.642695 | Peripheral awareness tanpa conscious attention — arc reactor indicator design |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: HUD TIDAK bypass message-pipeline.
        Semua input dari HUD → gateway → message-pipeline → response.
        HUD hanya render output, bukan process sendiri.

Rule 2: HUD = renderer-only process.
        Tidak boleh import src/core/, src/engines/, atau src/memory/.
        Komunikasi via WebSocket ke gateway yang sudah running.

Rule 3: Overlay data flow searah: Gateway → HUD.
        HUD kirim input via gateway WebSocket (sama seperti desktop app).
        HUD terima updates via dedicated 'hud_update' event channel.
```

### 3.2 System Architecture

```mermaid
flowchart LR
    subgraph Gateway["🌐 EDITH Gateway (existing)"]
        WS["WebSocket Server"]
        Pipeline["Message Pipeline"]
        Proactive["Proactive Engine\n(Phase 6)"]
    end

    subgraph HUDProcess["🖥️ HUD Overlay (Electron BrowserWindow)"]
        direction TB
        Renderer["HUD Renderer\n(React + Framer Motion)"]
        CardManager["Card Manager\n(priority queue)"]
        StatusRing["Status Ring\n(Canvas/WebGL)"]
        ThemeEngine["Theme Engine\n(arc-reactor / minimal / stealth)"]
    end

    subgraph DataSources["📊 Data Sources"]
        Calendar["Calendar API\n(Phase 14)"]
        Weather["Weather API"]
        Tasks["Task Memory\n(Phase 13)"]
        Channels["Channel Notifications\n(Phase 8)"]
    end

    WS <-->|"hud_update\nhud_input"| Renderer
    Proactive -->|"trigger events"| WS
    DataSources --> Proactive
    CardManager --> Renderer
    StatusRing --> Renderer
    ThemeEngine --> Renderer
```

### 3.3 Cross-Device Architecture (HP + Laptop)

```mermaid
flowchart TD
    subgraph Laptop["💻 Laptop"]
        HUD_Desktop["HUD Overlay\n(Electron transparent window)"]
    end

    subgraph Phone["📱 Phone"]
        HUD_Mobile["HUD Widget\n(React Native + Overlay API)"]
    end

    subgraph Server["🌐 EDITH Gateway"]
        WS_Server["WebSocket Server"]
        SessionSync["Session Sync\n(Phase 27)"]
        HUDState["HUD State\n(Redis/Memory)"]
    end

    HUD_Desktop <-->|"ws://gateway/hud"| WS_Server
    HUD_Mobile <-->|"ws://gateway/hud"| WS_Server
    WS_Server --> HUDState
    HUDState --> SessionSync

    Note["Card dismissed di laptop\n→ otomatis dismissed di HP\nvia HUD state sync"]
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["20A\nOverlay Engine\n(transparent window)"]
    B["20B\nStatus Ring\n(arc reactor indicator)"]
    C["20C\nContext Cards\n(calendar, weather, tasks)"]
    D["20D\nNotification Stack\n(priority-based)"]
    E["20E\nQuick Input Bar\n(mini command)"]
    F["20F\nMobile HUD Widget"]

    A --> B --> C --> D --> E
    A --> F
```

---

### Phase 20A — Transparent Overlay Engine

**Goal:** Electron BrowserWindow yang transparan, always-on-top, click-through.

```mermaid
sequenceDiagram
    participant Main as Electron Main
    participant HUD as HUD Window
    participant GW as Gateway WS

    Main->>HUD: createWindow({transparent, alwaysOnTop})
    HUD->>GW: connect ws://localhost:PORT/hud
    GW-->>HUD: hud_update {status: 'idle', cards: [...]}
    
    Note over HUD: Render overlay (transparent BG)
    Note over HUD: Mouse events pass through (click-through)
    
    HUD->>HUD: Hotkey Ctrl+Shift+E → toggle interaction mode
    Note over HUD: Interaction mode: click-through OFF, focus ON
```

**Implementation:**
```typescript
// apps/desktop/hud-window.ts
import { BrowserWindow } from 'electron';

export function createHUDWindow(): BrowserWindow {
  const hud = new BrowserWindow({
    width: 360,
    height: 800,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    // DECISION: click-through by default, toggle via hotkey
    // WHY: User shouldn't be interrupted unless they want to interact
    // ALTERNATIVES: Always interactive (rejected: blocks underlying apps)
    // REVISIT: When gaze tracking available (Phase 3 vision)
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'hud-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Platform-specific click-through
  hud.setIgnoreMouseEvents(true, { forward: true });
  
  return hud;
}
```

**Config:**
```json
{
  "hud": {
    "enabled": true,
    "position": "top-right",
    "width": 360,
    "opacity": 0.9,
    "clickThroughDefault": true,
    "hotkey": "Ctrl+Shift+E"
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/hud-window.ts` | CREATE | ~80 |
| `apps/desktop/hud-preload.js` | CREATE | ~30 |
| `apps/desktop/renderer/hud/` | CREATE | ~200 |
| `EDITH-ts/src/gateway/server.ts` | MODIFY | +40 (hud_update event channel) |

---

### Phase 20B — Status Ring (Arc Reactor Indicator)

**Goal:** Visual indicator animasi yang menunjukkan state EDITH: idle, listening, thinking, speaking.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Listening : voice_start
    Listening --> Thinking : voice_stop / text_input
    Thinking --> Speaking : response_start
    Speaking --> Idle : response_end
    
    Idle --> Alert : proactive_trigger
    Alert --> Idle : dismissed / timeout(5s)
    
    Thinking --> Error : engine_error
    Error --> Idle : auto_recovery(3s)
```

**Visual Design (CSS/Canvas):**
```
Idle:      Soft blue pulse (2s period)     — "EDITH is here"
Listening: Bright blue, expanding rings    — "I hear you"
Thinking:  Amber rotation, particles       — "Processing"
Speaking:  Green waveform animation         — "Talking"
Alert:     Red flash → amber steady        — "Attention needed"
Error:     Red blink 3x → fade to idle     — "Something went wrong"
```

**Implementation:**
```typescript
// apps/desktop/renderer/hud/StatusRing.tsx
interface StatusRingProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'alert' | 'error';
  theme: 'arc-reactor' | 'minimal' | 'stealth';
}

// Canvas-based rendering for 60fps animation
// DECISION: Canvas over CSS animation
// WHY: Need particle effects and smooth state transitions
// ALTERNATIVES: Lottie (heavier), CSS (limited effects)
// REVISIT: If performance issues on low-end machines
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/renderer/hud/StatusRing.tsx` | CREATE | ~150 |
| `apps/desktop/renderer/hud/themes/` | CREATE | ~100 |

---

### Phase 20C — Context Cards

**Goal:** Kartu informasi kontekstual yang muncul berdasarkan waktu, lokasi, dan aktivitas user.

```mermaid
flowchart TD
    subgraph Sources["Data Sources"]
        Cal["📅 Calendar\n(Phase 14)"]
        Weather["🌤️ Weather API"]
        Tasks["📋 Task Memory\n(Phase 13)"]
        Channels["💬 Unread Messages\n(Phase 8)"]
        Code["💻 Active Project\n(Phase 19)"]
    end

    subgraph CardEngine["Card Priority Engine"]
        Score["Score Calculator\nrelevance × urgency × freshness"]
        Queue["Priority Queue\nmax 3 visible"]
        Dedup["Deduplication\nhash-based"]
    end

    subgraph Display["HUD Cards"]
        C1["Card 1 (highest priority)"]
        C2["Card 2"]
        C3["Card 3"]
    end

    Sources --> Score --> Queue --> Dedup --> Display
```

**Card Types:**
| Card | Source | Trigger | Example |
|------|--------|---------|---------|
| Next Meeting | Phase 14 Calendar | 15 min before | "Meeting with Tim in 15m — Room 2B" |
| Weather | Weather API | Morning + before outdoor | "Hujan siang ini, bawa payung" |
| Unread Priority | Phase 8 Channels | Unread from VIP contact | "3 unread dari boss di Telegram" |
| Task Reminder | Phase 13 Knowledge | Approaching deadline | "Deadline PR review: 2 jam lagi" |
| Code Status | Phase 19 Dev Mode | Build fail / test fail | "Build failed: 2 type errors" |

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/renderer/hud/CardManager.tsx` | CREATE | ~120 |
| `apps/desktop/renderer/hud/cards/` | CREATE | ~200 |
| `EDITH-ts/src/core/hud-data-aggregator.ts` | CREATE | ~100 |

---

### Phase 20D — Notification Stack (Priority-Based)

**Goal:** Notifikasi dari semua channel ditampilkan di HUD dengan priority sorting.

Based on Microsoft Research interruption model:
```
Priority Levels:
  P0 (CRITICAL)  → Center screen, sound, stay until dismissed
  P1 (IMPORTANT) → Full card in HUD, persist 30s
  P2 (NORMAL)    → Small card in HUD, persist 10s, auto-dismiss
  P3 (LOW)       → Badge count only, no card
```

```mermaid
sequenceDiagram
    participant CH as Channel (Phase 8)
    participant GW as Gateway
    participant NE as Notification Engine
    participant HUD as HUD Overlay

    CH->>GW: incoming_message {from: "boss", channel: "telegram"}
    GW->>NE: classify_priority(message)
    NE->>NE: VIP sender? → P1\nKeyword "urgent"? → P0\nNewsletter? → P3
    NE->>HUD: hud_notification {priority: P1, card: {...}}
    HUD->>HUD: Insert card at position 1 (above P2, below P0)
    
    Note over HUD: Max 3 visible. P3 → badge only.
    Note over HUD: "Film mode" active? → queue all, show after.
```

**Film Mode Detection:**
```typescript
// Suppress overlay when user is in fullscreen app (gaming, presentation, movie)
// DECISION: Check foreground window + fullscreen state every 5s
// WHY: Don't interrupt immersive experiences
// ALTERNATIVES: Manual toggle only (rejected: user forgets)
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/renderer/hud/NotificationStack.tsx` | CREATE | ~100 |
| `EDITH-ts/src/core/notification-priority.ts` | CREATE | ~80 |

---

### Phase 20E — Quick Input Bar

**Goal:** Mini command bar di HUD — ketik perintah tanpa buka full app.

```mermaid
sequenceDiagram
    participant User
    participant HUD as HUD Quick Bar
    participant GW as Gateway

    User->>HUD: Hotkey: Ctrl+Shift+Space
    Note over HUD: Quick bar appears (like Spotlight/Alfred)
    User->>HUD: Type: "remind me to buy milk at 5pm"
    HUD->>GW: chat_message {text: "...", source: "hud_quick"}
    GW-->>HUD: response {text: "Reminder set for 5 PM", type: "confirmation"}
    Note over HUD: Show mini response card, auto-dismiss 5s
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/renderer/hud/QuickInput.tsx` | CREATE | ~80 |

---

### Phase 20F — Mobile HUD Widget

**Goal:** HUD equivalent di HP — Android overlay widget / iOS widget.

```mermaid
flowchart TD
    subgraph Android["📱 Android"]
        FloatWidget["Floating Widget\n(SYSTEM_ALERT_WINDOW permission)"]
        LockWidget["Lock Screen Widget"]
        NotifShade["Notification Shade\nPersistent notification"]
    end

    subgraph iOS["📱 iOS"]
        WidgetKit["WidgetKit\n(home screen + lock screen)"]
        LiveActivity["Live Activity\n(Dynamic Island)"]
        WatchCompl["Apple Watch\nComplication"]
    end

    subgraph Gateway["🌐 EDITH Gateway"]
        WS["WebSocket"]
        Push["Push Notifications\n(FCM / APNs)"]
    end

    Gateway --> Android
    Gateway --> iOS
```

**Cross-Device State Sync:**
- Dismissed card di laptop → sync via gateway → dismissed di HP juga
- State disimpan di gateway memory (bukan per-device)
- Reconnect → full state refresh dari gateway

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/mobile/widgets/HUDWidget.tsx` | CREATE | ~120 |
| `apps/mobile/widgets/StatusIndicator.tsx` | CREATE | ~60 |
| `EDITH-ts/src/gateway/hud-state.ts` | CREATE | ~80 |

---

## 5. Acceptance Gates

```
□ Transparent overlay visible di desktop tanpa blocking app di bawahnya
□ Status ring berubah sesuai EDITH state (idle → listening → thinking → speaking)
□ Context cards muncul berdasarkan waktu dan priority
□ Notification stack sorted by priority, max 3 visible
□ Quick input bar functional: ketik → response → auto-dismiss
□ Film mode: overlay hidden saat fullscreen app
□ Mobile widget menampilkan status + cards
□ Cross-device: dismiss di laptop → dismissed di HP
□ Hotkey Ctrl+Shift+E toggle overlay visibility
□ Performance: overlay < 2% CPU saat idle
```

---

## 6. Koneksi ke Phase Lain

| Phase | Koneksi | Data Flow |
|-------|---------|-----------|
| Phase 1 (Voice) | Status ring reflects voice state | voice_state → StatusRing |
| Phase 6 (Proactive) | Triggers create context cards | proactive_event → CardManager |
| Phase 8 (Channels) | Notifications from all channels | channel_message → NotificationStack |
| Phase 12 (Desktop) | HUD is secondary window in same Electron app | IPC main → hud-window |
| Phase 13 (Knowledge) | Task/deadline cards | knowledge_query → Cards |
| Phase 14 (Calendar) | Meeting cards | calendar_event → Cards |
| Phase 19 (Dev Mode) | Build/test status cards | dev_event → Cards |
| Phase 27 (Cross-Device) | HUD state sync across devices | hud_state → SessionSync |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `apps/desktop/hud-window.ts` | CREATE | ~80 |
| `apps/desktop/hud-preload.js` | CREATE | ~30 |
| `apps/desktop/renderer/hud/StatusRing.tsx` | CREATE | ~150 |
| `apps/desktop/renderer/hud/CardManager.tsx` | CREATE | ~120 |
| `apps/desktop/renderer/hud/NotificationStack.tsx` | CREATE | ~100 |
| `apps/desktop/renderer/hud/QuickInput.tsx` | CREATE | ~80 |
| `apps/desktop/renderer/hud/themes/` | CREATE | ~100 |
| `apps/desktop/renderer/hud/cards/` | CREATE | ~200 |
| `apps/mobile/widgets/HUDWidget.tsx` | CREATE | ~120 |
| `apps/mobile/widgets/StatusIndicator.tsx` | CREATE | ~60 |
| `EDITH-ts/src/gateway/server.ts` | MODIFY | +40 |
| `EDITH-ts/src/gateway/hud-state.ts` | CREATE | ~80 |
| `EDITH-ts/src/core/hud-data-aggregator.ts` | CREATE | ~100 |
| `EDITH-ts/src/core/notification-priority.ts` | CREATE | ~80 |
| **Total** | | **~1340** |

**New dependencies:** `framer-motion`, `@electron/remote` (desktop); WidgetKit (iOS), SYSTEM_ALERT_WINDOW (Android)
