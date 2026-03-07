# Phase 4 — IoT & Smart Home Completion (MQTT + Extended NL + Scenes)

**Durasi Estimasi:** 1–2 minggu  
**Prioritas:** 🟡 MEDIUM — Fitur EDITH smart home  
**Status Saat Ini:** HA REST API ✅ | HA Rate Limiting ✅ | NL Parser (basic) ✅ | MQTT ❌ | Scenes ❌ | Mobile Control ❌  

---

## 1. Landasan Riset (Academic Papers)

| # | Paper | ID / Venue | Kontribusi ke EDITH |
|---|-------|-----------|---------------------|
| 1 | **LLM-based Home Automation for HA** | arXiv 2024 | NL → HA service call validation: intent detection + slot filling accuracy |
| 2 | **On-Device LLMs for Smart Home** | OpenReview 2024 | Edge inference: quantized models maintain accuracy for IoT commands |
| 3 | **Synthetic Home Integration** | home-assistant.io | Reproducible YAML benchmarks for HA testing — EDITH adopt: fixtures |
| 4 | **MQTT-SN PUF Authentication** | MDPI Sensors 2024 | Secure MQTT auth: PUF + timestamps + shared keys for broker auth |
| 5 | **Time-Specific Integrity (TSSC)** | IPSN 2024 | Temporal message integrity for time-sensitive MQTT messages |
| 6 | **Energy Consumption Attack Detection** | arXiv:2410.x | Lightweight DDoS/F-AP detection on smart devices via packet analysis |
| 7 | **Genie: Semantic Parser Generator** | arXiv | NL command → structured virtual assistant commands at scale |

### Core Principles

```
┌─────────────────────────────────────────────────────────────┐
│           First Principles dari IoT Research Papers           │
│                                                               │
│  1. DUAL PROTOCOL (MQTT + REST)                              │
│     HA REST for stateful queries, MQTT for real-time push     │
│     → Device registry unifies both sources                    │
│                                                               │
│  2. HYBRID NL PARSING (HA NLP + Genie)                       │
│     Rule-based regex for known patterns (fast, reliable)      │
│     LLM fallback for freeform commands (flexible, slower)    │
│     → Combined: 95%+ intent accuracy                          │
│                                                               │
│  3. SECURE CONNECTIVITY (MQTT-SN PUF)                        │
│     Auto-reconnect, QoS 1, client ID rotation                │
│     → Prevent replay attacks on device commands               │
│                                                               │
│  4. SCENE ORCHESTRATION (HA NLP Research)                    │
│     Multi-action sequences with delay and conditional         │
│     → "Good night" = lights off + lock + AC 25° + alarm on   │
│                                                               │
│  5. REPRODUCIBLE TESTING (Synthetic Home)                    │
│     YAML-defined home states for deterministic tests          │
│     → Mock HA entities from fixture files                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Arsitektur Sistem

### 2.1 Full IoT Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       IoT Bridge (EDITH)                         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Natural Language Parser (Hybrid)               │  │
│  │  User: "matikan semua lampu dan kunci pintu"               │  │
│  │       │                                                     │  │
│  │  ┌────┴───────┐  ┌──────────┐  ┌──────────────┐          │  │
│  │  │ Rule-based │──│ LLM-based│──│ Hybrid       │          │  │
│  │  │ Regex      │  │ Fallback │  │ (Genie-style)│          │  │
│  │  └────────────┘  └──────────┘  └──────────────┘          │  │
│  │       → [ { domain: "light", service: "turn_off" },       │  │
│  │           { domain: "lock", service: "lock" } ]            │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │                                         │
│           ┌─────────────┴─────────────┐                          │
│           ▼                           ▼                           │
│  ┌──────────────────┐       ┌──────────────────┐                │
│  │  Home Assistant   │       │  MQTT Direct      │                │
│  │  REST API         │       │  (Zigbee2MQTT,    │                │
│  │  /api/services/   │       │   Tasmota,        │                │
│  │  /api/states      │       │   ESPHome)        │                │
│  │  WebSocket (push) │       │  QoS 1, auto-     │                │
│  └──────────────────┘       │  reconnect        │                │
│                              └──────────────────┘                │
│           └─────────────┬─────────────┘                          │
│                         ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Device Registry (unified)                                  │  │
│  │  { entityId, friendlyName, domain, room, state,            │  │
│  │    lastChanged, source: "ha" | "mqtt" }                    │  │
│  │  Auto-refresh: 60s (HA) + subscription (MQTT push)         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Scene Manager (HA NLP Research-inspired)                   │  │
│  │  "Good Night" → lights off + lock + AC 25° + alarm on      │  │
│  │  "Movie Time" → dim lights + curtain close + TV on          │  │
│  │  Custom scenes via YAML or chat                             │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 MQTT Architecture (Paper: MQTT-SN PUF Auth)

```
┌───────────────────────────────────────────────┐
│            MQTT Broker (Mosquitto)              │
│            mqtt://192.168.1.x:1883              │
│                                                  │
│  Topics:                                         │
│  ├── zigbee2mqtt/+/set       (command)          │
│  ├── zigbee2mqtt/+/state     (state update)     │
│  ├── tasmota/+/cmnd/#        (command)          │
│  ├── homeassistant/+/+/state (HA discovery)     │
│  └── edith/iot/#              (EDITH custom)     │
└───────────────┬───────────────────────────────┘
                │ mqtt.js client
                ▼
┌───────────────────────────────────────────────┐
│  IoTBridge MQTT Module                         │
│  subscribe("zigbee2mqtt/+/state")             │
│  on("message") → update device registry       │
│  publish("zigbee2mqtt/lamp/set", {state:"ON"})│
│  Connection: auto-reconnect, QoS 1            │
│  Security: clientId rotation (MQTT-SN paper)   │
└───────────────────────────────────────────────┘
```

### 2.3 Extended NL Parser — Command Patterns

**Paper basis:** HA NLP Research (intent detection + slot filling), Genie (semantic parser generation)

| Pattern (ID/EN) | Parsed Action | Status |
|-----------------|---------------|--------|
| "nyalakan/matikan lampu {room}" | `light.turn_on/off` | ✅ |
| "atur suhu {N} derajat" | `climate.set_temperature` | ✅ |
| "kunci/buka pintu" | `lock.lock/unlock` | ✅ |
| "buka/tutup tirai {room}" | `cover.open/close_cover` | ❌ NEW |
| "setel kecerahan {N}%" | `light.turn_on { brightness }` | ❌ NEW |
| "warna lampu {color}" | `light.turn_on { rgb_color }` | ❌ NEW |
| "play/pause music" | `media_player.play/pause` | ❌ NEW |
| "volume {N}%" | `media_player.volume_set` | ❌ NEW |
| "good night / selamat malam" | Scene: goodnight | ❌ NEW |
| "berapa suhu {room}?" | Read sensor state | ❌ NEW |
| "vacuum clean {room}" | `vacuum.start` | ❌ NEW |

---

## 3. Implementation Roadmap

### Week 1: MQTT + Extended NL + Scenes

| Task | File | Paper Basis |
|------|------|-------------|
| Install mqtt package | package.json | — |
| MQTT connect + subscribe | iot-bridge.ts | MQTT-SN PUF: secure connect |
| MQTT publish (Zigbee2MQTT/Tasmota) | iot-bridge.ts | TSSC: message integrity |
| Extend NL parser (12 new patterns) | iot-bridge.ts | Genie: semantic parsing |
| Create SceneManager | scene-manager.ts | HA NLP: multi-action scenes |
| LLM fallback parser | iot-bridge.ts | HA NLP: intent detection |
| Tests: MQTT + NL patterns | __tests__/ | Synthetic Home: reproducible |

### Week 2: Gateway + Mobile Dashboard

| Task | File | Paper Basis |
|------|------|-------------|
| Gateway iot_states/control/scene handlers | server.ts | — |
| Mobile IoTDashboard screen | IoTDashboard.tsx | — |
| Device toggle + scene buttons | components/ | — |
| Integration tests | __tests__/ | Synthetic Home fixtures |

---

## 4. Testing Strategy (Paper-Grounded)

**Unit Tests (10 — Synthetic Home approach):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | MQTT connect + subscribe with mock broker | MQTT-SN PUF |
| 2 | MQTT publish Zigbee2MQTT topic | TSSC |
| 3 | MQTT publish Tasmota topic | TSSC |
| 4 | MQTT state update → device registry | Synthetic Home |
| 5 | NL: "buka tirai kamar" → cover.open | Genie |
| 6 | NL: "setel kecerahan 50%" → light | Genie |
| 7 | NL: "good night" → scene trigger | HA NLP |
| 8 | Scene execution: all actions in sequence | HA NLP |
| 9 | Scene execution: partial failure resilient | HA NLP |
| 10 | LLM fallback parser: freeform → structured | HA NLP |

**Integration Tests (4):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | HA + MQTT combined device listing | Synthetic Home |
| 2 | Mobile → WS iot_control → HA execution | — |
| 3 | Scene trigger → multiple HA service calls | HA NLP |
| 4 | MQTT state change → WS push to mobile | — |

---

## 5. References

| # | Paper | Venue | Relevansi |
|---|-------|-------|-----------|
| 1 | LLM-based Home Automation Generation for HA | arXiv 2024 | NL → service call |
| 2 | On-Device LLMs for Smart Home | OpenReview 2024 | Edge IoT inference |
| 3 | Synthetic Home Integration | home-assistant.io | Reproducible test fixtures |
| 4 | MQTT-SN PUF Authentication | MDPI 2024 | Secure MQTT auth scheme |
| 5 | Time-Specific Signcryption (TSSC) | IPSN 2024 | Temporal message integrity |
| 6 | Lightweight Energy Consumption Attack Detection | arXiv:2410.x | Smart device security |
| 7 | Genie: Semantic Parser Generator | arXiv | NL command parsing |

---

## 6. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/iot-bridge.ts` | MQTT client, extended NL parser, device registry | +250 |
| `src/os-agent/scene-manager.ts` | NEW: Scene definitions + execution | +150 |
| `src/os-agent/types.ts` | Extended IoTConfig + Scene types | +40 |
| `src/gateway/server.ts` | iot_states, iot_control, iot_scene handlers | +60 |
| `apps/mobile/screens/IoTDashboard.tsx` | NEW: IoT dashboard screen | +300 |
| `apps/mobile/components/DeviceCard.tsx` | NEW: Device control card | +120 |
| `src/os-agent/__tests__/iot-bridge.test.ts` | Extended tests | +150 |
| `EDITH-ts/package.json` | Add mqtt dependency | +1 |
| **Total** | | **~1071 lines** |
