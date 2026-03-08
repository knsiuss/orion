# Phase 27 — Cross-Device Mesh & Unified Gateway

> "Tony pakai suit di mana aja — lab, udara, bawah laut — JARVIS selalu connected. EDITH harus sama."

**Prioritas:** 🔴 HIGH — Ini lem yang menyatukan semua phase di HP dan laptop
**Depends on:** Phase 1 (voice), Phase 8 (channels), Phase 12 (desktop + mobile apps)
**Status:** ❌ Not started

---

## 1. Tujuan

EDITH harus jalan **seamless** di HP dan laptop — bahkan ketika keduanya di **network berbeda
dan gateway berbeda**. User mulai ngobrol di laptop, lanjut di HP sambil jalan, balik ke
laptop — tanpa kehilangan konteks.

Ini bukan sekedar sync. Ini **device mesh**: setiap device jadi node, gateway jadi hub,
dan user experience tetap satu EDITH yang sama di mana-mana.

### Problem Statement

```
Skenario saat ini (BROKEN tanpa Phase 27):

  Laptop ──ws://─→ Gateway A (localhost:3000)
  Phone  ──ws://─→ Gateway B (cloud.edith.ai:443)

  ❌ Conversation di laptop ga muncul di HP
  ❌ Memory di HP ga ke-sync ke laptop
  ❌ Voice session di HP ga bisa hand-off ke laptop
  ❌ Proactive trigger di laptop ga kirim notif ke HP
  ❌ HUD state beda-beda per device
```

```
Target (SETELAH Phase 27):

  Laptop ──ws://─→ Gateway A (localhost:3000) ──sync──→ Sync Layer
  Phone  ──ws://─→ Gateway B (cloud.edith.ai:443) ──sync──→ Sync Layer

  ✅ Satu conversation, multi-device
  ✅ Memory terpusat, semua device baca yang sama
  ✅ Voice hand-off: mulai di HP, lanjut di laptop
  ✅ Notifications follow the user, not the device
  ✅ HUD state synced across devices
```

```mermaid
flowchart TD
    subgraph Devices["📱💻 User Devices"]
        Phone["📱 Phone\n(React Native app)"]
        Laptop["💻 Laptop\n(Electron app)"]
        Tablet["📒 Tablet\n(PWA / browser)"]
        Watch["⌚ Watch\n(companion app)"]
    end

    subgraph Mesh["🌐 Device Mesh Layer"]
        SyncHub["Sync Hub\n(conversation, memory, HUD state)"]
        Presence["Presence Manager\n(which device is active?)"]
        Router["Message Router\n(route to active device)"]
    end

    subgraph Gateways["🔄 Gateways"]
        GW_Local["Gateway A\n(localhost, home network)"]
        GW_Cloud["Gateway B\n(cloud/VPS, public)"]
    end

    Phone <--> GW_Cloud
    Laptop <--> GW_Local
    Tablet <--> GW_Cloud
    Watch <--> GW_Cloud

    GW_Local <-->|"gateway-to-gateway\nsync protocol"| SyncHub
    GW_Cloud <-->|"gateway-to-gateway\nsync protocol"| SyncHub
    SyncHub <--> Presence
    SyncHub <--> Router
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | CRDTs: Conflict-free Replicated Data Types | arXiv:1805.06358 | Eventually consistent sync tanpa central authority — handles network partitions |
| 2 | Yjs: Shared Editing Framework | github.com/yjs/yjs | Production CRDT implementation for real-time sync — basis shared state |
| 3 | Matrix Protocol (Element) | spec.matrix.org | Decentralized communication protocol — room-based message sync across servers |
| 4 | WebRTC for Direct Device Communication | webrtc.org | P2P connection between devices on same network — lowest latency sync |
| 5 | Handoff (Apple Continuity) | developer.apple.com/handoff | Device-to-device task handoff UX patterns — "start here, continue there" |
| 6 | Android Nearby Connections | developers.google.com/nearby | Cross-device discovery + connection on local network |
| 7 | MQTT with QoS Levels | mqtt.org/mqtt-specification | Reliable IoT messaging: QoS 0 (fire-forget), 1 (at-least-once), 2 (exactly-once) |
| 8 | Raft Consensus Algorithm | raft.github.io | Leader election for gateway-to-gateway sync coordination |
| 9 | WireGuard VPN | wireguard.com | Lightweight VPN tunnel — connect gateways across different networks |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: ONE user identity, many devices.
        User authenticates once per device (pairing flow).
        All devices share same user_id, different device_id.
        Auth token = {user_id, device_id, gateway_id}.

Rule 2: Conversation is device-agnostic.
        Messages belong to user, not device.
        Any device can see full conversation history.
        Active device = where user is typing/speaking RIGHT NOW.

Rule 3: Gateway-to-gateway sync via CRDT.
        No "master" gateway. Both gateways hold full state.
        Sync happens asynchronously (eventual consistency).
        Network partition → both continue working → merge when reconnected.

Rule 4: Notification follows the active device.
        If user is on phone → notifications go to phone.
        If user is on laptop → notifications go to laptop.
        If user inactive everywhere → push to all devices.

Rule 5: Sensitive data transit is end-to-end encrypted.
        Gateway-to-gateway sync encrypted with user's key.
        Even if sync layer is cloud-hosted, it cannot read content.
```

### 3.2 Three Architecture Modes

EDITH supports 3 deployment modes for cross-device:

```mermaid
flowchart TD
    subgraph ModeA["Mode A: Single Gateway (Simplest)"]
        Phone_A["📱 Phone"] & Laptop_A["💻 Laptop"] --> GW_A["🌐 Single Gateway\n(cloud/VPS)"]
        Note_A["Both devices connect to\nsame gateway. No sync needed.\nJust session sharing."]
    end

    subgraph ModeB["Mode B: Local + Cloud Gateway"]
        Laptop_B["💻 Laptop"] --> GW_Local_B["🏠 Local Gateway\n(localhost)"]
        Phone_B["📱 Phone"] --> GW_Cloud_B["☁️ Cloud Gateway\n(VPS/Cloudflare Tunnel)"]
        GW_Local_B <-->|"sync"| GW_Cloud_B
        Note_B["Laptop uses local (fast).\nPhone uses cloud (accessible).\nGateways sync."]
    end

    subgraph ModeC["Mode C: Mesh (Advanced)"]
        Laptop_C["💻 Laptop"] --> GW_L["🏠 GW-Home"]
        Phone_C["📱 Phone"] --> GW_C["☁️ GW-Cloud"]
        Work_C["💼 Work PC"] --> GW_W["🏢 GW-Work"]
        GW_L & GW_C & GW_W <-->|"mesh sync"| Mesh["🔄 Sync Mesh"]
        Note_C["Multiple gateways,\nall sync via mesh.\nMost flexible."]
    end
```

### 3.3 Gateway-to-Gateway Sync Protocol

```mermaid
sequenceDiagram
    participant GW_A as Gateway A (Laptop)
    participant Sync as Sync Layer
    participant GW_B as Gateway B (Phone)

    Note over GW_A,GW_B: Initial state: both gateways have conversation up to msg #42

    GW_A->>GW_A: User types message #43 on laptop
    GW_A->>Sync: sync_push {type: "message", id: 43, content: "...", vector_clock: [A:43, B:42]}
    Sync->>GW_B: sync_push {type: "message", id: 43, ...}
    GW_B->>GW_B: Apply message #43 to local state
    GW_B->>GW_B: Phone UI updates with new message

    Note over GW_A,GW_B: User picks up phone, types message #44

    GW_B->>GW_B: User types message #44 on phone
    GW_B->>Sync: sync_push {type: "message", id: 44, vector_clock: [A:43, B:44]}
    Sync->>GW_A: sync_push {type: "message", id: 44, ...}
    GW_A->>GW_A: Apply message #44 to local state
    GW_A->>GW_A: Laptop UI updates with new message
```

### 3.4 Detailed Data Sync Model

```mermaid
flowchart TD
    subgraph SyncedData["📊 What Gets Synced"]
        Conv["💬 Conversation\n(messages, responses)"]
        Memory["🧠 Memory\n(episodic, semantic)"]
        Sessions["📋 Session State\n(active session, HUD state)"]
        Prefs["⚙️ User Preferences\n(settings, identity config)"]
        Mood["🎭 Mood Profile\n(Phase 21 emotion state)"]
        Mission["🚀 Mission State\n(Phase 22 progress)"]
        HUD["📺 HUD State\n(Phase 20 cards, dismissed)"]
    end

    subgraph NotSynced["🚫 NOT Synced (device-local)"]
        Audio["🎤 Raw audio streams"]
        Cache["💾 Model cache / temp files"]
        HW["🔧 Hardware state\n(device-specific peripherals)"]
        Tokens["🔑 Auth tokens\n(per-device)"]
    end
```

### 3.5 Network Topology Options

```mermaid
flowchart LR
    subgraph Option1["Option 1: Cloud Relay"]
        D1_1["📱 Phone"] --> Cloud1["☁️ Cloud Relay\n(Cloudflare Tunnel\nor VPS)"] --> D2_1["💻 Laptop"]
        Note1["Pro: Works anywhere\nCon: Latency, needs server"]
    end

    subgraph Option2["Option 2: Local P2P"]
        D1_2["📱 Phone"] <-->|"WebRTC / mDNS"| D2_2["💻 Laptop"]
        Note2["Pro: Zero latency, no server\nCon: Same network only"]
    end

    subgraph Option3["Option 3: VPN Tunnel"]
        D1_3["📱 Phone"] -->|"WireGuard"| VPN["🔒 WireGuard\nTunnel"] --> D2_3["💻 Laptop"]
        Note3["Pro: Secure, works across networks\nCon: Setup complexity"]
    end

    subgraph Option4["Option 4: Hybrid (Recommended)"]
        D1_4["📱 Phone"] -->|"Same network?\nP2P via WebRTC"| D2_4["💻 Laptop"]
        D1_4 -->|"Different network?\nCloud relay"| Cloud4["☁️ Cloud Relay"]
        Cloud4 --> D2_4
        Note4["Auto-detect: P2P when possible,\ncloud fallback otherwise"]
    end
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["27A\nDevice Pairing\n& Identity"]
    B["27B\nConversation Sync\n(CRDT-based)"]
    C["27C\nMemory Sync\n(selective replication)"]
    D["27D\nPresence & Active\nDevice Detection"]
    E["27E\nGateway-to-Gateway\nSync Protocol"]
    F["27F\nSession Handoff\n(start here, continue there)"]
    G["27G\nNetwork Discovery\n(P2P + Cloud fallback)"]
    H["27H\nMobile Companion\nDeep Integration"]

    A --> B --> C
    A --> D --> F
    A --> E --> G
    D --> H
```

---

### Phase 27A — Device Pairing & Identity

**Goal:** One user, many devices — secure pairing flow.

```mermaid
sequenceDiagram
    participant Phone as 📱 Phone (new device)
    participant Laptop as 💻 Laptop (existing)
    participant QR as QR Code
    participant GW as Gateway

    Note over Laptop: Laptop already paired with EDITH
    
    Laptop->>QR: Generate pairing QR code\n(contains: gateway_url, pairing_token, user_id)
    QR-->>Phone: User scans QR with phone camera
    
    Phone->>GW: pair_device({pairing_token, device_info: {name: "iPhone", os: "iOS"}})
    GW->>GW: Validate pairing token (one-time use, 5min expiry)
    GW->>GW: Register device: {device_id: "phone-1", user_id: "user-1"}
    GW-->>Phone: pair_success({device_id, auth_token, ws_url})
    GW-->>Laptop: device_paired({name: "iPhone", device_id: "phone-1"})
    
    Laptop-->>Laptop: Show: "📱 iPhone connected to EDITH"
    Phone-->>Phone: Show: "✅ Connected! EDITH is ready."
```

```typescript
interface DeviceRegistration {
  deviceId: string;           // UUID generated at pairing
  userId: string;             // owner
  name: string;               // "iPhone 15", "Work Laptop"
  os: 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'web';
  type: 'phone' | 'laptop' | 'tablet' | 'watch' | 'browser';
  gatewayId: string;          // which gateway this device connects to
  capabilities: string[];     // ['voice', 'camera', 'notifications', 'overlay']
  lastSeen: number;
  paired: number;             // when paired
  authToken: string;          // device-specific auth token (hashed)
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/pairing/device-pairing.ts` | MODIFY | +100 |
| `EDITH-ts/src/pairing/device-registry.ts` | CREATE | ~80 |
| `EDITH-ts/src/pairing/qr-generator.ts` | CREATE | ~60 |
| `apps/mobile/screens/PairScreen.tsx` | CREATE | ~80 |

---

### Phase 27B — Conversation Sync (CRDT-based)

**Goal:** Conversations stay in sync across devices in real-time.

```mermaid
flowchart TD
    subgraph CRDT["Conversation CRDT"]
        Messages["Messages\n(append-only log\n+ vector clock)"]
        Responses["Responses\n(append-only log)"]
        Metadata["Metadata\n(last-writer-wins register:\nread_cursor, typing_state)"]
    end

    subgraph Sync["Sync Engine"]
        Delta["Delta Calculator\n(what changed since last sync?)"]
        Merge["CRDT Merge\n(automatic conflict resolution)"]
        Push["Push to Peer\n(WebSocket / HTTP)"]
    end

    Messages & Responses & Metadata --> Delta --> Merge --> Push
```

**How sync works:**
```
1. User types message on laptop → append to local CRDT log
2. CRDT generates delta (just the new message)
3. Delta pushed to connected peer gateways
4. Peer applies delta to its CRDT (automatic merge, no conflicts possible)
5. Peer's connected devices receive update via WebSocket
6. UI updates on phone showing new message
```

**Vector Clock Example:**
```
Laptop sends: "hello"     → vector_clock: {laptop: 1, phone: 0}
Phone sends: "hi there"   → vector_clock: {laptop: 0, phone: 1}

After sync merge:
Both have: ["hello", "hi there"] → vector_clock: {laptop: 1, phone: 1}
Order determined by timestamp (LWW) or causal order (vector clock)
```

**Implementation:**
```typescript
import * as Y from 'yjs';

class ConversationSync {
  private doc: Y.Doc;
  private messages: Y.Array<ConversationMessage>;
  
  constructor(userId: string) {
    this.doc = new Y.Doc();
    this.messages = this.doc.getArray('messages');
    
    // Listen for remote changes
    this.doc.on('update', (update: Uint8Array) => {
      // Broadcast to connected devices
      this.broadcastToDevices(update);
    });
  }
  
  addMessage(msg: ConversationMessage): void {
    this.messages.push([msg]);
    // CRDT automatically generates delta for sync
  }
  
  applyRemoteUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    // Automatic merge — no conflicts possible with Yjs
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/sessions/conversation-sync.ts` | CREATE | ~120 |
| `EDITH-ts/src/sessions/crdt-adapter.ts` | CREATE | ~80 |
| `EDITH-ts/src/sessions/__tests__/conversation-sync.test.ts` | CREATE | ~100 |

---

### Phase 27C — Memory Sync (Selective Replication)

**Goal:** User's memory consistent across gateways, with selective sync.

```mermaid
flowchart TD
    subgraph MemoryTiers["💾 Memory Sync Tiers"]
        Hot["🔥 Hot Memory\n(last 24h, current session)\nSync: REAL-TIME"]
        Warm["♨️ Warm Memory\n(last 30 days, frequent access)\nSync: EVERY 5 MIN"]
        Cold["❄️ Cold Memory\n(older, rare access)\nSync: ON-DEMAND"]
    end

    subgraph SyncStrategy["🔄 Sync Strategy"]
        Realtime["Real-time (WebSocket)\nFor: active conversation,\nmood, HUD state"]
        Periodic["Periodic (HTTP batch)\nFor: episodic memory,\nuser facts, skills"]
        OnDemand["On-demand (manual/trigger)\nFor: old conversations,\narchived knowledge"]
    end

    Hot --> Realtime
    Warm --> Periodic
    Cold --> OnDemand
```

```typescript
// DECISION: Tiered sync instead of full replication
// WHY: Full memory sync is too heavy (could be GBs of vectors)
// ALTERNATIVES: Full sync (bandwidth), no sync (bad UX)
// REVISIT: If memory size stays small (<100MB) → could full-sync

interface MemorySyncPolicy {
  tier: 'hot' | 'warm' | 'cold';
  syncMethod: 'realtime' | 'periodic' | 'on-demand';
  interval?: number;         // ms (for periodic)
  maxPayloadSize: number;    // bytes per sync batch
  conflictResolution: 'lww' | 'merge' | 'ask-user';
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/memory/memory-sync.ts` | CREATE | ~120 |
| `EDITH-ts/src/memory/sync-tiers.ts` | CREATE | ~80 |

---

### Phase 27D — Presence & Active Device Detection

**Goal:** Know which device the user is currently using → route interactions correctly.

```mermaid
sequenceDiagram
    participant Phone as 📱 Phone
    participant GW as 🌐 Gateway
    participant Laptop as 💻 Laptop

    loop Every 10s
        Phone->>GW: heartbeat {device_id, is_active: false, battery: 85%}
        Laptop->>GW: heartbeat {device_id, is_active: true, last_input: 2s_ago}
    end

    GW->>GW: Active device = Laptop\n(last_input < 60s)
    
    Note over GW: Proactive notification arrives
    GW->>Laptop: notification (active device → direct push)
    
    Note over GW: User locks laptop, picks up phone
    Phone->>GW: heartbeat {is_active: true, last_input: 0s}
    Laptop->>GW: heartbeat {is_active: false, last_input: 120s}
    
    GW->>GW: Active device = Phone
    
    Note over GW: Next notification → goes to phone
```

**Presence States:**
```
active       — user interacting right now (typing, speaking, tapping)
idle         — device on, no input for 60s
background   — app in background (phone in pocket)
offline      — no heartbeat for 30s
dnd          — user set do-not-disturb
```

**Routing Logic:**
```typescript
function getTargetDevice(devices: DevicePresence[]): string | 'all' {
  const active = devices.filter(d => d.state === 'active');
  
  if (active.length === 1) return active[0].deviceId;      // Clear winner
  if (active.length > 1) return mostRecentInput(active);    // Most recent input
  
  const idle = devices.filter(d => d.state === 'idle');
  if (idle.length > 0) return idle[0].deviceId;             // Idle but awake
  
  return 'all';  // Everyone offline → push to all, someone will see it
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/sessions/presence-manager.ts` | CREATE | ~100 |
| `EDITH-ts/src/sessions/device-router.ts` | CREATE | ~80 |

---

### Phase 27E — Gateway-to-Gateway Sync Protocol

**Goal:** Two separate EDITH gateways (local + cloud) stay synchronized.

```mermaid
flowchart TD
    subgraph GW_Local["🏠 Gateway A (Laptop, localhost:3000)"]
        State_A["Full State\n(conversations, memory, settings)"]
        Sync_A["Sync Engine\n(Yjs provider)"]
    end

    subgraph GW_Cloud["☁️ Gateway B (Cloud, edith.vpn:443)"]
        State_B["Full State\n(conversations, memory, settings)"]
        Sync_B["Sync Engine\n(Yjs provider)"]
    end

    subgraph Transport["🔗 Transport Layer"]
        WS["WebSocket\n(persistent connection)"]
        HTTP["HTTP Batch\n(fallback if WS breaks)"]
        MQTT["MQTT\n(lightweight IoT option)"]
    end

    Sync_A <-->|"CRDT deltas"| Transport <-->|"CRDT deltas"| Sync_B

    Note["Both gateways hold FULL state.\nEither can work offline.\nResync when reconnected."]
```

**Gateway Discovery:**
```mermaid
sequenceDiagram
    participant GW_A as Gateway A (just started)
    participant Discovery as Discovery Service
    participant GW_B as Gateway B (already running)

    GW_A->>Discovery: register({gateway_id: "A", url: "localhost:3000", user_id: "user-1"})
    Discovery-->>GW_A: peers: [{gateway_id: "B", url: "edith.vpn:443"}]
    
    GW_A->>GW_B: sync_handshake({gateway_id: "A", vector_clock: [A:100, B:0]})
    GW_B-->>GW_A: sync_handshake_ack({vector_clock: [A:50, B:200]})
    
    Note over GW_A,GW_B: GW_A needs B:51-200, GW_B needs A:51-100
    
    par Bidirectional sync
        GW_B->>GW_A: sync_batch(deltas: B:51-200)
        GW_A->>GW_B: sync_batch(deltas: A:51-100)
    end
    
    Note over GW_A,GW_B: Both now at [A:100, B:200] — fully synced
```

**Config:**
```json
{
  "crossDevice": {
    "enabled": true,
    "mode": "hybrid",
    "gateways": [
      {
        "id": "local",
        "url": "ws://localhost:3000",
        "role": "primary",
        "network": "home"
      },
      {
        "id": "cloud",
        "url": "wss://edith.myserver.com",
        "role": "replica",
        "network": "public"
      }
    ],
    "syncInterval": 5000,
    "encryption": "aes-256-gcm",
    "discovery": "mdns+cloud"
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/gateway/gateway-sync.ts` | CREATE | ~150 |
| `EDITH-ts/src/gateway/sync-transport.ts` | CREATE | ~100 |
| `EDITH-ts/src/gateway/gateway-discovery.ts` | CREATE | ~80 |
| `EDITH-ts/src/gateway/__tests__/gateway-sync.test.ts` | CREATE | ~100 |

---

### Phase 27F — Session Handoff

**Goal:** Start conversation on one device, continue seamlessly on another.

```mermaid
sequenceDiagram
    participant Laptop as 💻 Laptop
    participant GW as 🌐 Gateway
    participant Phone as 📱 Phone

    Note over Laptop: User chatting with EDITH on laptop

    Laptop->>GW: chat: "Research best TypeScript frameworks"
    GW-->>Laptop: "I found 5 options..."
    
    Note over Laptop: User locks laptop, picks up phone
    
    Laptop->>GW: presence: {state: "idle"}
    Phone->>GW: presence: {state: "active"}
    
    GW->>GW: Active device changed: laptop → phone
    GW->>Phone: session_handoff {\n  conversation: [last 10 messages],\n  context: "researching TypeScript frameworks",\n  scroll_position: 3\n}
    
    Phone->>Phone: UI shows conversation at same point
    
    Phone->>GW: chat: "Which one is best for EDITH?"
    Note over GW: Seamless continuation — same conversation, same context
    GW-->>Phone: "Based on what I found, Fastify is..."
    
    Note over GW: Laptop comes back online later
    GW->>Laptop: sync new messages (#44, #45)
    Laptop->>Laptop: UI updated with phone conversation
```

**Voice Handoff (advanced):**
```mermaid
sequenceDiagram
    participant Phone as 📱 Phone (voice active)
    participant GW as 🌐 Gateway
    participant Laptop as 💻 Laptop (voice available)

    Phone->>GW: voice: "EDITH, switch to laptop"
    GW->>GW: Check: laptop online + voice capable?
    GW->>Laptop: voice_handoff_request
    Laptop-->>GW: voice_handoff_accept (mic + speaker ready)
    
    GW->>Phone: voice_session_end
    GW->>Laptop: voice_session_start (resume context)
    
    Laptop-->>GW: "I've switched to your laptop, sir. Continuing."
    Note over Laptop: Voice session continues on laptop
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/sessions/session-handoff.ts` | CREATE | ~120 |
| `EDITH-ts/src/voice/voice-handoff.ts` | CREATE | ~80 |

---

### Phase 27G — Network Discovery (P2P + Cloud Fallback)

**Goal:** Auto-detect best connection: direct P2P (fast) or cloud relay (always works).

```mermaid
flowchart TD
    Start["Device connects"]
    
    SameNetwork{"Same network?\n(mDNS / Bonjour\ndiscovery)"}
    
    SameNetwork -->|"Yes"| P2P["Connect P2P\n(WebRTC / direct WebSocket)\n~1ms latency"]
    SameNetwork -->|"No"| Cloud["Connect via Cloud Relay\n(Cloudflare Tunnel / VPS)\n~50-200ms latency"]
    SameNetwork -->|"No, but VPN"| VPN["Connect via WireGuard\n~10-30ms latency"]

    P2P --> Monitor["Monitor connection quality"]
    Cloud --> Monitor
    VPN --> Monitor

    Monitor -->|"P2P drops"| Fallback["Fallback to cloud relay"]
    Monitor -->|"Cloud drops"| Retry["Retry with backoff"]
```

**mDNS Discovery (same network only):**
```typescript
// DECISION: Use mDNS for local network discovery, cloud registry for remote
// WHY: mDNS is zero-config, instant, works offline
// ALTERNATIVES: Manual IP entry (bad UX), always cloud (unnecessary latency)
// REVISIT: If mDNS blocked by corporate networks → fallback to cloud only

import { Bonjour } from 'bonjour-service';

class LocalDiscovery {
  private bonjour = new Bonjour();
  
  advertise(port: number): void {
    this.bonjour.publish({
      name: 'edith-gateway',
      type: 'edith-sync',
      port,
      txt: { userId: 'user-1', gatewayId: 'gw-local' }
    });
  }
  
  discover(): Promise<GatewayPeer[]> {
    return new Promise((resolve) => {
      const peers: GatewayPeer[] = [];
      const browser = this.bonjour.find({ type: 'edith-sync' });
      browser.on('up', (service) => peers.push(serviceToGateway(service)));
      setTimeout(() => { browser.stop(); resolve(peers); }, 3000);
    });
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/gateway/network-discovery.ts` | CREATE | ~100 |
| `EDITH-ts/src/gateway/p2p-connector.ts` | CREATE | ~80 |
| `EDITH-ts/src/gateway/cloud-relay.ts` | CREATE | ~80 |

---

### Phase 27H — Mobile Companion Deep Integration

**Goal:** Phone app sebagai full companion, bukan sekedar remote.

```mermaid
flowchart TD
    subgraph PhoneApp["📱 EDITH Mobile App"]
        Chat["💬 Full Chat\n(synced conversations)"]
        Voice["🎤 Voice I/O\n(push-to-talk + always-on)"]
        Camera["📸 Vision\n(take photo → EDITH analyzes)"]
        Notif["🔔 Smart Notifications\n(priority-sorted)"]
        Quick["⚡ Quick Actions\n(widgets, shortcuts)"]
        Offline["📴 Offline Mode\n(cached responses)"]
    end

    subgraph PhoneUnique["Phone-Unique Features"]
        ShareSheet["📤 Share Sheet\n(share anything → EDITH)"]
        Clipboard["📋 Clipboard Sync\n(copy on phone, paste on laptop)"]
        Location["📍 Location Context\n(proactive based on where you are)"]
        Health["❤️ Health Integration\n(Apple Health / Google Fit)"]
    end

    subgraph Wearable["⌚ Watch Companion"]
        WatchVoice["🎤 Voice Quick Command"]
        WatchNotif["🔔 Wrist Notification"]
        WatchHaptic["📳 Haptic Alert"]
    end

    PhoneApp --> PhoneUnique
    PhoneApp --> Wearable
```

**Share Sheet Integration:**
```
User shares URL from Chrome → EDITH: "Summarize this article"
User shares photo from Gallery → EDITH: "What's in this image?"
User shares text from Notes → EDITH: "Remember this for later"
```

**Clipboard Sync:**
```mermaid
sequenceDiagram
    participant Phone as 📱 Phone
    participant GW as 🌐 Gateway
    participant Laptop as 💻 Laptop

    Phone->>Phone: User copies text on phone
    Phone->>GW: clipboard_sync {content: "https://...", type: "url"}
    GW->>Laptop: clipboard_update {content: "https://...", type: "url"}
    Laptop->>Laptop: Clipboard updated silently
    Note over Laptop: User can Ctrl+V on laptop → gets phone clipboard
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/mobile/services/ShareExtension.ts` | CREATE | ~80 |
| `apps/mobile/services/ClipboardSync.ts` | CREATE | ~60 |
| `apps/mobile/services/LocationContext.ts` | CREATE | ~60 |
| `apps/mobile/services/HealthIntegration.ts` | CREATE | ~60 |
| `apps/mobile/screens/OfflineScreen.tsx` | CREATE | ~80 |

---

## 5. Acceptance Gates

```
□ Device pairing via QR code works (laptop → phone)
□ Conversation appears on both devices simultaneously
□ Type on laptop → phone shows message within 2 seconds
□ Switch active device (laptop → phone) → conversation continues seamlessly
□ Voice handoff: "EDITH, switch to laptop" → voice session moves
□ Two gateways (local + cloud) sync conversations bidirectionally
□ Network partition → both gateways continue working → resync on reconnect
□ Gateway discovery via mDNS (same network) works
□ Cloud relay works when devices are on different networks
□ Memory sync: fact learned on phone → available on laptop
□ Notification routes to active device only
□ Clipboard sync: copy on phone → paste on laptop
□ Share sheet: share URL from phone → EDITH summarizes
□ Offline mode: phone works with cached data when disconnected
□ All cross-device data encrypted in transit
```

---

## 6. Koneksi ke Phase Lain (MASTER INTEGRATION TABLE)

Phase 27 is the **glue** connecting all other phases across devices.

| Phase | What Syncs Across Devices | Protocol |
|-------|---------------------------|----------|
| Phase 1 (Voice) | Voice session handoff (phone ↔ laptop) | voice_handoff event |
| Phase 6 (Proactive) | Proactive triggers route to active device | presence → notification_router |
| Phase 8 (Channels) | Channel notifications follow user | channel_msg → device_router |
| Phase 10 (Personalization) | User preferences sync | prefs → crdt_sync |
| Phase 13 (Knowledge) | Knowledge base accessible from any device | knowledge_query → gateway |
| Phase 14 (Calendar) | Calendar alerts go to active device | calendar_alert → device_router |
| Phase 20 (HUD) | HUD state sync (dismiss on laptop → dismissed on phone) | hud_state → crdt_sync |
| Phase 21 (Emotional) | Mood profile follows user across devices | mood_update → session_sync |
| Phase 22 (Mission) | Start mission on laptop, monitor from phone | mission_state → gateway_sync |
| Phase 23 (Hardware) | Control desk hardware from phone | hw_command → gateway → hardware |
| Phase 24 (Self-Improve) | Feedback aggregated from all devices | feedback → central_store |
| Phase 25 (Simulation) | Approve simulated actions from phone | preview → approval_queue |
| Phase 26 (Legion) | Dashboard accessible from any device | dashboard → cross_device |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/pairing/device-pairing.ts` | MODIFY | +100 |
| `EDITH-ts/src/pairing/device-registry.ts` | CREATE | ~80 |
| `EDITH-ts/src/pairing/qr-generator.ts` | CREATE | ~60 |
| `EDITH-ts/src/sessions/conversation-sync.ts` | CREATE | ~120 |
| `EDITH-ts/src/sessions/crdt-adapter.ts` | CREATE | ~80 |
| `EDITH-ts/src/sessions/presence-manager.ts` | CREATE | ~100 |
| `EDITH-ts/src/sessions/device-router.ts` | CREATE | ~80 |
| `EDITH-ts/src/sessions/session-handoff.ts` | CREATE | ~120 |
| `EDITH-ts/src/voice/voice-handoff.ts` | CREATE | ~80 |
| `EDITH-ts/src/memory/memory-sync.ts` | CREATE | ~120 |
| `EDITH-ts/src/memory/sync-tiers.ts` | CREATE | ~80 |
| `EDITH-ts/src/gateway/gateway-sync.ts` | CREATE | ~150 |
| `EDITH-ts/src/gateway/sync-transport.ts` | CREATE | ~100 |
| `EDITH-ts/src/gateway/gateway-discovery.ts` | CREATE | ~80 |
| `EDITH-ts/src/gateway/network-discovery.ts` | CREATE | ~100 |
| `EDITH-ts/src/gateway/p2p-connector.ts` | CREATE | ~80 |
| `EDITH-ts/src/gateway/cloud-relay.ts` | CREATE | ~80 |
| `EDITH-ts/src/sessions/__tests__/conversation-sync.test.ts` | CREATE | ~100 |
| `EDITH-ts/src/gateway/__tests__/gateway-sync.test.ts` | CREATE | ~100 |
| `apps/mobile/screens/PairScreen.tsx` | CREATE | ~80 |
| `apps/mobile/screens/OfflineScreen.tsx` | CREATE | ~80 |
| `apps/mobile/services/ShareExtension.ts` | CREATE | ~80 |
| `apps/mobile/services/ClipboardSync.ts` | CREATE | ~60 |
| `apps/mobile/services/LocationContext.ts` | CREATE | ~60 |
| `apps/mobile/services/HealthIntegration.ts` | CREATE | ~60 |
| **Total** | | **~2430** |

**New dependencies:** `yjs` (CRDT), `y-websocket` (Yjs WebSocket provider), `bonjour-service` (mDNS), `wrtc` (WebRTC for Node)
