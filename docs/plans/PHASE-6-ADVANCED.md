# Phase 6 — Advanced EDITH Features (Proactive + Automation + Security)

**Durasi Estimasi:** 3–4 minggu  
**Prioritas:** 🟢 ENHANCEMENT — Fitur yang membuat EDITH benar-benar seperti EDITH  
**Status Saat Ini:** Daemon ✅ | Triggers YAML ✅ | File Watcher ❌ | Notifications ❌ | Macros ❌ | CaMeL ❌  

---

## 1. Landasan Riset (Academic Papers)

| # | Paper | arXiv / Venue | Kontribusi ke EDITH |
|---|-------|--------------|---------------------|
| 1 | **CaMeL: Defeating Prompt Injections by Design** | arXiv:2503.18813 | Taint tracking + capability tokens: untrusted data cannot trigger tool calls |
| 2 | **MemGPT: LLMs as Operating Systems** | arXiv:2310.08560 | Proactive intelligence: interrupt-driven notifications, hierarchical context |
| 3 | **OSWorld: OS-Level Agent Benchmark** | arXiv:2404.07972 | File system operations, system state monitoring, multi-app workflows |
| 4 | **CodeAct: Executable Code Actions** | arXiv:2402.01030 | Macro execution: code-as-action for multi-step workflows with self-debugging |
| 5 | **AgentDojo: Prompt Injection Benchmark** | arXiv 2024 | CaMeL evaluation: 67% tasks solved with provable security |
| 6 | **HA NLP Research** | arXiv 2024 | Scene/automation: NL → multi-action sequence with conditional steps |

### Core Principles

```
┌─────────────────────────────────────────────────────────────────┐
│          First Principles dari Advanced Feature Papers           │
│                                                                   │
│  1. PROACTIVE > REACTIVE (MemGPT)                                │
│     Don't wait for user commands — anticipate needs               │
│     Interrupt-driven: battery/meeting/security → notify          │
│     Value of Information (VoI) gating prevents noise             │
│                                                                   │
│  2. MULTI-STEP AUTOMATION (CodeAct)                              │
│     Macros = executable multi-step code actions                  │
│     Template substitution: {{step[N].result}}                    │
│     Error handling: continue | abort | retry per step            │
│                                                                   │
│  3. SECURITY BY DESIGN (CaMeL)                                  │
│     Control flow (user intentions) ≠ Data flow (untrusted)      │
│     Capability tokens: tool calls require explicit permission    │
│     Taint tracking: data from memory/web/email = "tainted"      │
│     Tainted data CANNOT be used as tool arguments                │
│                                                                   │
│  4. FILE AWARENESS (OSWorld)                                     │
│     Monitor file system changes → classify importance            │
│     .env/credentials = HIGH (immediate notify)                   │
│     Code/documents = MEDIUM (batch summary)                      │
│     Logs/temp = LOW (silent log)                                 │
│                                                                   │
│  5. CROSS-CHANNEL DELIVERY (MemGPT interrupts)                  │
│     Desktop toast + mobile push + voice TTS                      │
│     Priority-based routing + quiet hours                         │
│     Cooldown prevents notification flooding                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Arsitektur Sistem

### 2.1 Proactive Intelligence Architecture (MemGPT-inspired)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Proactive Intelligence Layer                   │
│                                                                   │
│  Event Sources:                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐      │
│  │ System   │ │ Calendar │ │ File     │ │ IoT State    │      │
│  │ Monitor  │ │ (ICS/    │ │ Watcher  │ │ Changes      │      │
│  │(CPU,RAM, │ │  Google) │ │(chokidar)│ │ (HA/MQTT)    │      │
│  │ battery) │ │          │ │          │ │              │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘      │
│       └─────────────┴────────────┴───────────────┘              │
│                             │                                     │
│                             ▼                                     │
│  ┌──────────────────────────────────────────────────┐           │
│  │   Trigger Evaluator (Daemon — MemGPT interrupts) │           │
│  │   1. Check conditions against current state      │           │
│  │   2. VoI (Value of Information) gating           │           │
│  │   3. Cooldown check (prevent flooding)           │           │
│  │   4. Quiet hours check (user sleep mode)         │           │
│  └──────────────────────┬───────────────────────────┘           │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────┐           │
│  │         Notification Dispatcher                    │           │
│  │                                                    │           │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │           │
│  │  │ Desktop  │  │ Mobile   │  │ Voice (TTS)  │  │           │
│  │  │ Toast    │  │ Push     │  │ Speak aloud  │  │           │
│  │  │(Win/Mac) │  │ (Expo)   │  │ (Edge TTS)   │  │           │
│  │  └──────────┘  └──────────┘  └──────────────┘  │           │
│  └──────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 File Watcher Architecture (OSWorld-inspired)

```
┌───────────────────────────────────────────────┐
│             File Watcher System                │
│                                                │
│  chokidar → Events:                           │
│  ├── add    → "New file: report.pdf"          │
│  ├── change → "Modified: budget.xlsx"         │
│  └── unlink → "Deleted: old-draft.docx"       │
│                                                │
│  Event Processor:                              │
│  1. Debounce (500ms)                          │
│  2. Filter (.git, node_modules)               │
│  3. Classify importance:                      │
│     HIGH   → .env, credentials, .key, .pem    │
│     MEDIUM → .ts, .py, .md, .docx, .xlsx      │
│     LOW    → .log, .tmp, .cache               │
│  4. Route:                                     │
│     HIGH   → immediate notify all channels    │
│     MEDIUM → batch summary (5min buffer)      │
│     LOW    → silent log only                  │
└───────────────────────────────────────────────┘
```

### 2.3 Macro & Workflow Engine (CodeAct-inspired)

```
┌───────────────────────────────────────────────────────────┐
│              Macro / Workflow Engine (CodeAct)              │
│                                                            │
│  Definition Sources:                                       │
│  1. macros.yaml (config file)                             │
│  2. Chat: "EDITH, buat macro 'deploy': ..."              │
│  3. Voice: "Hey EDITH, save this as a macro"              │
│                                                            │
│  Step Types:       │  Execution (CodeAct pattern):        │
│  • run_command     │  1. Parse trigger keyword             │
│  • notify          │  2. Load macro definition             │
│  • speak           │  3. Execute steps sequentially        │
│  • iot_scene       │  4. Template: {{step[N].result}}     │
│  • generate (LLM)  │  5. Conditional: if/then/else        │
│  • conditional     │  6. Error: continue | abort | retry   │
│  • wait/delay      │  7. Result summary to user            │
│                    │                                       │
│  Schedule: cron syntax (e.g. "0 7 * * 1-5")              │
└───────────────────────────────────────────────────────────┘
```

### 2.4 CaMeL Security Architecture (arXiv:2503.18813)

```
┌───────────────────────────────────────────────────────────────┐
│              CaMeL Security Layer                               │
│              (CApabilities for MachinE Learning)                │
│                                                                 │
│  Existing Security:                                            │
│  • prompt-filter.ts → injection detection ✅                  │
│  • affordance-checker.ts → risk scoring ✅                    │
│  • tool-guard.ts → dangerous commands ✅                      │
│  • dual-agent-reviewer.ts → two-agent review ✅               │
│                                                                 │
│  CaMeL Addition (arXiv:2503.18813):                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  1. TAINT TRACKING                                        │ │
│  │     Mark data from untrusted sources as "tainted"        │ │
│  │     Sources: memory, web content, email, file content    │ │
│  │     Tainted data CANNOT be used as tool arguments        │ │
│  │                                                           │ │
│  │  2. CAPABILITY TOKENS                                     │ │
│  │     Each tool call needs valid capability token           │ │
│  │     Tokens granted by control flow (user intent)          │ │
│  │     Untrusted data cannot forge capability tokens         │ │
│  │                                                           │ │
│  │  3. CONTROL / DATA SEPARATION                             │ │
│  │     ┌─────────────┐    ┌─────────────────┐              │ │
│  │     │ Control LLM │    │ Data LLM        │              │ │
│  │     │ (planning,  │    │ (reading email,  │              │ │
│  │     │  tool calls)│    │  summarizing)    │              │ │
│  │     └──────┬──────┘    └────────┬────────┘              │ │
│  │            │ (grants caps)      │ (returns data)         │ │
│  │            ▼                    ▼                         │ │
│  │     ┌──────────────────────────────────┐                │ │
│  │     │ Tool Executor (with CaMeL gate) │                │ │
│  │     │ Checks: valid token? args not   │                │ │
│  │     │ tainted? scope matches?         │                │ │
│  │     └──────────────────────────────────┘                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  AgentDojo Evaluation: 67% tasks solved with provable security  │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Komponen yang Harus Dibangun

### 3.1 NotificationDispatcher

**File:** NEW `src/os-agent/notification.ts` (~200 lines)  
Cross-platform: Windows toast (PowerShell) | macOS (osascript) | Linux (notify-send) | mobile (WS push) | voice (TTS)

### 3.2 FileWatcher

**File:** NEW `src/os-agent/file-watcher.ts` (~180 lines)  
chokidar-based with debounce, filtering, importance classification, and batched summaries.

### 3.3 MacroEngine

**File:** NEW `src/os-agent/macro-engine.ts` (~350 lines)  
YAML loader, step executor, template substitution, conditional steps, cron scheduler, voice trigger matching.

### 3.4 CaMeL Guard

**File:** NEW `src/security/camel-guard.ts` (~300 lines)  
Taint tracking system, capability token generator/validator, control/data LLM separation.

### 3.5 Mobile Screens

- `Notifications.tsx` (~200 lines) — real-time notification list
- `MacroBuilder.tsx` (~250 lines) — visual macro builder with quick-launch grid

---

## 4. Proactive Trigger Examples (MemGPT-inspired)

| Trigger | Condition | Action | Cooldown |
|---------|-----------|--------|----------|
| Battery Low | `battery < 20%` | All channels | 30min |
| Meeting Reminder | `calendar.next < 15min` | Voice + mobile | Per event |
| High CPU | `cpu > 90% for 5min` | Desktop toast | 15min |
| Disk Almost Full | `disk > 90%` | Desktop + mobile | 2hr |
| Door Unlocked Late | `lock == "unlocked" && time > 22:00` | Voice + mobile | 30min |
| File Modified (.env) | `file.change on *.env` | Immediate all | Per event |
| Long Idle | `idle > 90min && activity == "coding"` | Voice: "istirahat?" | 2hr |

---

## 5. Implementation Roadmap

### Week 1: Notifications + File Watcher

| Task | File | Paper Basis |
|------|------|-------------|
| NotificationDispatcher class | notification.ts | MemGPT: interrupts |
| Install chokidar | package.json | — |
| FileWatcher class | file-watcher.ts | OSWorld: file ops |
| Wire into SystemMonitor | system-monitor.ts | — |
| Daemon trigger → notification | daemon.ts | MemGPT: VoI gating |
| Mobile notification display | App.tsx | — |
| Tests: notification dispatch | __tests__/ | — |
| Tests: file watcher events | __tests__/ | — |

### Week 2: Macro Engine

| Task | File | Paper Basis |
|------|------|-------------|
| Macro definition types | types.ts | CodeAct: action schema |
| YAML loader | macro-engine.ts | — |
| Step executor | macro-engine.ts | CodeAct: sequential exec |
| Template substitution | macro-engine.ts | CodeAct: result chaining |
| Conditional steps | macro-engine.ts | CodeAct: self-debugging |
| Cron scheduler | macro-engine.ts | — |
| Voice trigger matching | macro-engine.ts | — |
| Mobile MacroBuilder | MacroBuilder.tsx | — |
| Tests: macro execution | __tests__/ | — |

### Week 3: CaMeL Security

| Task | File | Paper Basis |
|------|------|-------------|
| Taint tracking system | camel-guard.ts | CaMeL: taint propagation |
| Capability token generator | camel-guard.ts | CaMeL: capability model |
| Tool executor CaMeL gate | tool-guard.ts | CaMeL: policy enforcement |
| Control/Data LLM separation | camel-guard.ts | CaMeL: dual LLM |
| Integration with pipeline | incoming-message.ts | — |
| Tests: taint propagation | __tests__/ | CaMeL: AgentDojo eval |
| Tests: capability tokens | __tests__/ | CaMeL |
| Security audit | manual | AgentDojo: injection attempts |

### Week 4: Polish + Integration

| Task | File | Paper Basis |
|------|------|-------------|
| End-to-end testing | __tests__/ | — |
| Performance optimization | all | — |
| Documentation | docs/ | — |
| Mobile polish | apps/mobile/ | — |
| Load testing | manual | OSWorld: scalability |

---

## 6. Testing Strategy (Paper-Grounded)

**Unit Tests (15):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | NotificationDispatcher: desktop toast (Win) | MemGPT |
| 2 | NotificationDispatcher: mobile push via WS | MemGPT |
| 3 | NotificationDispatcher: voice TTS | MemGPT |
| 4 | FileWatcher: HIGH file → immediate notify | OSWorld |
| 5 | FileWatcher: MEDIUM file → buffered summary | OSWorld |
| 6 | FileWatcher: ignored patterns (.git, node_modules) | OSWorld |
| 7 | MacroEngine: load from YAML | CodeAct |
| 8 | MacroEngine: sequential step execution | CodeAct |
| 9 | MacroEngine: template `{{step[N].result}}` | CodeAct |
| 10 | MacroEngine: conditional step evaluation | CodeAct |
| 11 | MacroEngine: error on step → abort/continue | CodeAct |
| 12 | MacroEngine: voice trigger matching | — |
| 13 | CaMeL: tainted data blocked from tool args | CaMeL |
| 14 | CaMeL: valid capability token allows execution | CaMeL |
| 15 | CaMeL: expired/forged token rejected | CaMeL |

**Integration Tests (5):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | Daemon trigger → NotificationDispatcher → desktop + mobile | MemGPT |
| 2 | File change → FileWatcher → NotificationDispatcher | OSWorld |
| 3 | Voice trigger → MacroEngine → multi-step execution | CodeAct |
| 4 | Schedule → MacroEngine → IoT scene + notify | CodeAct + HA NLP |
| 5 | Injected memory content cannot trigger tool execution | CaMeL/AgentDojo |

---

## 7. References

| # | Paper | ID | Relevansi |
|---|-------|----|-----------|
| 1 | CaMeL: Defeating Prompt Injections by Design | arXiv:2503.18813 | Taint tracking, capability tokens |
| 2 | MemGPT: LLMs as Operating Systems | arXiv:2310.08560 | Proactive interrupts, notifications |
| 3 | OSWorld: Benchmarking Multimodal Agents | arXiv:2404.07972 | File ops, system monitoring |
| 4 | CodeAct: Executable Code Actions | arXiv:2402.01030 | Macro execution, self-debugging |
| 5 | AgentDojo: Prompt Injection Benchmark | arXiv 2024 | CaMeL evaluation framework |
| 6 | HA NLP Research | arXiv 2024 | Automation/scene sequences |

---

## 8. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/notification.ts` | NEW: Multi-channel dispatcher | +200 |
| `src/os-agent/file-watcher.ts` | NEW: File watcher + classification | +180 |
| `src/os-agent/macro-engine.ts` | NEW: Macro loader + executor | +350 |
| `src/os-agent/types.ts` | MacroDef, NotificationPayload types | +40 |
| `src/security/camel-guard.ts` | NEW: Taint tracking + capabilities | +300 |
| `src/security/tool-guard.ts` | Wire CaMeL gate | +30 |
| `src/background/daemon.ts` | Wire triggers → NotificationDispatcher | +20 |
| `src/gateway/server.ts` | Notification + macro WS handlers | +40 |
| `apps/mobile/screens/Notifications.tsx` | NEW: History screen | +200 |
| `apps/mobile/screens/MacroBuilder.tsx` | NEW: Visual builder | +250 |
| `macros.yaml` | NEW: Default macro definitions | +50 |
| Tests (4 files) | NEW: notification, file-watcher, macro, camel | +380 |
| `EDITH-ts/package.json` | Add chokidar, node-cron | +2 |
| **Total** | | **~2042 lines** |

---

## 9. Total Project Summary (All 6 Phases)

| Phase | Focus | Lines | Duration | Papers |
|-------|-------|-------|----------|--------|
| 1 | Voice Input Pipeline | ~1015 | 2-3 weeks | 3 |
| 2 | OS-Agent Test Suite | ~1620 | 1-2 weeks | 10 |
| 3 | Vision Intelligence | ~670 | 2 weeks | 7 |
| 4 | IoT & Smart Home | ~1071 | 1-2 weeks | 7 |
| 5 | Critical Bug Fixes | ~181 | 3-5 days | 8 |
| 6 | Advanced Features | ~2042 | 3-4 weeks | 6 |
| **Total** | | **~6599** | **~12-15 weeks** | **41 references** |

**Recommended Execution Order:**
1. **Phase 5** (Bug Fixes) — fastest, most critical security
2. **Phase 2** (Tests) — foundation untuk safe development
3. **Phase 1** (Voice) — core EDITH feature
4. **Phase 3** (Vision) — enables smart GUI automation
5. **Phase 4** (IoT) — smart home completion
6. **Phase 6** (Advanced) — proactive + security + automation
