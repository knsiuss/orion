# Phase 22 — Autonomous Mission Mode

> "Autopilot, JARVIS." — Tony Stark mulai tidur di suit sambil JARVIS terbang sendiri.

**Prioritas:** 🟡 MEDIUM — "Handle it while I sleep" = ultimate AI companion feature
**Depends on:** Phase 11 (multi-agent orchestration), Phase 6 (proactive), Phase 7 (computer use)
**Status:** ❌ Not started

---

## 1. Tujuan

User assign EDITH sebuah **mission** — goal besar multi-step — dan EDITH kerjakan
secara autonomous selama berjam-jam tanpa intervensi manusia. User bisa pergi tidur,
dan besok pagi dapat laporan lengkap.

Bedanya dengan Phase 11 (Multi-Agent): Phase 11 = user monitor, EDITH execute.
Phase 22 = **user PERGI**, EDITH plan + execute + recover + report sendiri.

```mermaid
flowchart TD
    User["🗣️ User: 'Research 10 EDITH competitors,\nbuat comparison table'"]
    
    subgraph MissionEngine["🚀 Mission Engine"]
        Planner["Mission Planner\nDecompose → DAG"]
        Executor["Autonomous Executor\nRun tasks per DAG"]
        Monitor["Self-Monitor\nDetect failures, retry"]
        Checkpoint["Checkpoint System\nSave progress every 15min"]
    end

    subgraph Safety["🛡️ Safety Layer"]
        Budget["Budget Limits\n(tokens, API calls, time)"]
        Scope["Scope Lock\n(no unauthorized expansion)"]
        Gate["Sensitive Action Gate\n(queue destructive ops)"]
        DeadMan["Dead Man's Switch\n(stop if no progress 30min)"]
    end

    subgraph Output["📋 Mission Report"]
        Steps["Step-by-step log"]
        Decisions["Decision rationale"]
        Results["Final deliverables"]
        Failures["Failure recovery log"]
    end

    User --> Planner --> Executor
    Executor --> Monitor --> Executor
    Executor --> Checkpoint
    Safety --> Executor
    Executor --> Output
    Output -->|"via Phase 8 channel"| User
```

---

## 2. Research References

| # | Paper | ID | Kontribusi ke EDITH |
|---|-------|-----|---------------------|
| 1 | AutoGen: Enabling Next-Gen LLM Applications (Microsoft) | arXiv:2308.08155 | Multi-agent autonomous conversation loops — basis executor pattern |
| 2 | SWE-agent: Agent-Computer Interfaces for Software Engineering | arXiv:2405.15793 | Autonomous SW engineering agent — longest-running autonomous AI |
| 3 | ADAS: Automated Design of Agentic Systems | arXiv:2408.13231 | Self-improving agent design — mission evolves approach |
| 4 | Voyager: An Open-Ended Embodied Agent with LLMs | arXiv:2305.16291 | Lifelong learning: discover skills, build library, reuse across missions |
| 5 | Language Agent Tree Search (LATS) | arXiv:2310.04406 | Tree search for planning — optimal path through task graph |
| 6 | Reflexion: Language Agents with Verbal Reinforcement | arXiv:2303.11366 | Self-reflection after failure → learn and retry differently |
| 7 | Plan-and-Solve Prompting | arXiv:2305.04091 | Structured decomposition of complex tasks → sub-task DAG |
| 8 | TaskWeaver: A Code-First Agent Framework (Microsoft) | arXiv:2311.17541 | Code-centric execution + stateful session for long-running tasks |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: Missions run THROUGH message-pipeline, not around it.
        Every sub-task = internal message to pipeline with mission context.
        Pipeline security, rate limits, and permissions still apply.

Rule 2: User authority > mission goals.
        "EDITH abort mission" = immediate stop, no questions.
        Sensitive actions (file delete, git push, send email) → queued for approval.
        If user unreachable + action is destructive → skip, log, continue.

Rule 3: Budget is HARD limit.
        Token budget, API call budget, time budget — all hard caps.
        Hit any limit → graceful wind-down → partial report.
        NEVER exceed budget "to finish one more step."

Rule 4: Every decision is logged with reasoning.
        No black-box execution. User should be able to audit
        WHY EDITH made every choice during the mission.
```

### 3.2 Mission Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Planning : user submits mission goal
    Planning --> Review : DAG generated
    Review --> Executing : user approves / auto-approve
    Review --> Cancelled : user rejects plan
    
    Executing --> Checkpointing : every N minutes
    Checkpointing --> Executing : checkpoint saved
    Executing --> Recovering : sub-task failed
    Recovering --> Executing : alternative approach found
    Recovering --> WindingDown : max retries exceeded
    
    Executing --> WindingDown : budget limit hit
    Executing --> WindingDown : user abort
    Executing --> WindingDown : dead man switch
    
    WindingDown --> Reporting : partial/full results
    Executing --> Reporting : all tasks complete
    
    Reporting --> Delivered : report sent via channel
    Delivered --> [*]
    Cancelled --> [*]
```

### 3.3 DAG Task Decomposition

```mermaid
flowchart TD
    Goal["🎯 Mission Goal:\n'Research 10 EDITH competitors,\nbuat comparison table,\nsimpan di Google Docs'"]

    subgraph DAG["📊 Task DAG"]
        T1["T1: Search for AI\nassistant projects"]
        T2["T2: Filter to top 10\nby GitHub stars/features"]
        T3a["T3a: Analyze\ncompetitor 1-5"]
        T3b["T3b: Analyze\ncompetitor 6-10"]
        T4["T4: Build comparison\ntable (features matrix)"]
        T5["T5: Write summary\nwith recommendations"]
        T6["T6: Create Google Doc\n+ paste results"]
    end

    Goal --> T1 --> T2
    T2 --> T3a & T3b
    T3a & T3b --> T4 --> T5 --> T6

    T3a -.->|"parallel"| T3b
```

### 3.4 Cross-Device Mission Control

```mermaid
flowchart LR
    subgraph Laptop["💻 Laptop (where mission runs)"]
        Engine["Mission Engine\n(attached to gateway)"]
    end

    subgraph Gateway["🌐 Gateway"]
        MissionState["Mission State\n(progress, logs, queue)"]
        WS["WebSocket Hub"]
    end

    subgraph Phone["📱 Phone"]
        Monitor["Mission Monitor UI\n(progress bar, live log)"]
        Approve["Approval Queue\n(swipe to approve/reject)"]
    end

    Engine <--> WS
    WS <--> Monitor
    WS <--> Approve
    
    Note["Start mission on laptop.\nMonitor + approve from phone.\nReport delivered via Telegram."]
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["22A\nMission Planner\n(NL → DAG)"]
    B["22B\nAutonomous Executor\n(run DAG)"]
    C["22C\nSelf-Recovery\n(Reflexion loop)"]
    D["22D\nSafety Guardrails\n(budget, scope, gate)"]
    E["22E\nMission Report\nGenerator"]
    F["22F\nMobile Mission\nControl"]

    A --> B --> C
    A --> D
    B --> E
    B --> F
```

---

### Phase 22A — Mission Planner

**Goal:** Natural language goal → structured DAG of sub-tasks.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Planner as Mission Planner
    participant LLM

    User->>EDITH: "Research 10 competitors, buat comparison table"
    EDITH->>Planner: plan_mission(goal)
    Planner->>LLM: decompose goal → sub-tasks
    LLM-->>Planner: [T1: search, T2: filter, T3: analyze, T4: table, T5: write]
    Planner->>Planner: Build DAG (detect parallelism, dependencies)
    Planner->>Planner: Estimate: 45min, ~50K tokens, 15 API calls
    Planner-->>EDITH: MissionPlan {dag, estimates, risks}
    
    EDITH-->>User: "Plan:\n1. Search projects (5min)\n2. Filter top 10 (3min)\n3. Analyze each (20min, parallel)\n4. Build table (5min)\n5. Write summary (5min)\n\nEstimated: 45min, ~50K tokens\nApprove?"
    
    User->>EDITH: "Go"
    EDITH->>Planner: execute(plan)
```

**Implementation:**
```typescript
interface MissionPlan {
  id: string;
  goal: string;
  dag: TaskNode[];
  estimatedDuration: number;    // minutes
  estimatedTokens: number;
  estimatedApiCalls: number;
  risks: string[];
  status: 'planning' | 'approved' | 'executing' | 'completed' | 'aborted';
}

interface TaskNode {
  id: string;
  description: string;
  dependencies: string[];       // task IDs that must complete first
  parallelGroup?: string;       // tasks in same group can run in parallel
  tools: string[];              // which tools/skills this task needs
  estimatedMinutes: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  retryCount: number;
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-planner.ts` | CREATE | ~150 |
| `EDITH-ts/src/agents/mission-types.ts` | CREATE | ~60 |

---

### Phase 22B — Autonomous Executor

**Goal:** Execute DAG tasks sequentially/parallel, with checkpointing.

```mermaid
flowchart TD
    Start["Mission Start"]
    ReadyTasks["Get Ready Tasks\n(all dependencies met)"]
    
    subgraph Parallel["⚡ Parallel Execution"]
        RunA["Execute Task A\n(via Phase 11 agent)"]
        RunB["Execute Task B\n(via Phase 11 agent)"]
    end
    
    Checkpoint["💾 Checkpoint\nSave progress to file"]
    
    NextBatch["More tasks?"]
    
    Start --> ReadyTasks
    ReadyTasks --> Parallel
    Parallel --> Checkpoint
    Checkpoint --> NextBatch
    NextBatch -->|"Yes"| ReadyTasks
    NextBatch -->|"No"| Complete["Mission Complete"]
```

```typescript
// DECISION: Checkpoint every task completion + every 15 minutes
// WHY: If EDITH crashes mid-mission, can resume from last checkpoint
// ALTERNATIVES: Checkpoint only on task complete (gaps during long tasks)
// REVISIT: If checkpoint I/O becomes bottleneck

interface MissionCheckpoint {
  missionId: string;
  timestamp: number;
  completedTasks: string[];
  runningTasks: string[];
  pendingTasks: string[];
  tokensBurned: number;
  apiCallsMade: number;
  partialResults: Record<string, unknown>;
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-executor.ts` | CREATE | ~200 |
| `EDITH-ts/src/agents/mission-checkpoint.ts` | CREATE | ~80 |

---

### Phase 22C — Self-Recovery (Reflexion Loop)

**Goal:** When a task fails, reflect on why and try a different approach.

Based on Reflexion (arXiv:2303.11366):
```mermaid
flowchart TD
    TaskFail["❌ Task Failed\n(e.g., API returned 404)"]
    Reflect["🪞 Reflect\nWhy did this fail?\nWhat can I try differently?"]
    NewApproach["💡 New Approach\n(different tool, different query,\ndifferent data source)"]
    Retry["🔄 Retry with\nnew approach"]
    
    MaxRetries{"Retries < 3?"}
    
    TaskFail --> Reflect --> NewApproach
    NewApproach --> MaxRetries
    MaxRetries -->|"Yes"| Retry
    MaxRetries -->|"No"| Skip["⏭️ Skip task\nLog failure\nContinue mission"]
    
    Retry --> Success["✅ Success"]
    Retry --> TaskFail
```

```typescript
interface ReflectionEntry {
  taskId: string;
  attempt: number;
  error: string;
  reflection: string;        // LLM-generated analysis of what went wrong
  newApproach: string;        // LLM-generated alternative strategy
  outcome: 'success' | 'failed_again';
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-recovery.ts` | CREATE | ~100 |

---

### Phase 22D — Safety Guardrails

**Goal:** Hard limits on budget, scope, and destructive actions.

```mermaid
flowchart TD
    subgraph Guards["🛡️ Safety Guardrails"]
        Budget["💰 Budget Guard\ntokens ≤ 500K\nAPI calls ≤ 200\ntime ≤ 8h"]
        Scope["🔒 Scope Guard\nTask not in original DAG?\n→ REJECT"]
        Sensitive["⚠️ Sensitive Action Gate\ngit push, file delete, send email\n→ QUEUE for user"]
        DeadMan["💀 Dead Man's Switch\nNo progress for 30min?\n→ AUTO-STOP"]
    end

    Action["Next Action"] --> Budget
    Budget -->|"within budget"| Scope
    Budget -->|"exceeded"| WindDown["Graceful Wind-Down"]
    
    Scope -->|"in scope"| Sensitive
    Scope -->|"out of scope"| Reject["Reject + Log"]
    
    Sensitive -->|"safe action"| Execute["Execute"]
    Sensitive -->|"destructive"| Queue["Queue for User\n(notify via push)"]
    
    DeadMan -->|"timeout"| WindDown
```

**Sensitive Action Whitelist/Blacklist:**
```typescript
const SENSITIVE_ACTIONS = [
  'git_push', 'git_force_push',
  'file_delete', 'file_overwrite',
  'email_send', 'message_send',
  'api_call_with_write',         // POST/PUT/DELETE to external APIs
  'payment_action',
  'credential_access',
];

// Auto-approved (safe during missions):
const SAFE_ACTIONS = [
  'file_read', 'web_search', 'api_call_read_only',
  'file_create_in_workspace', 'memory_write',
  'llm_query', 'tool_call_internal',
];
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-safety.ts` | CREATE | ~120 |
| `EDITH-ts/src/agents/__tests__/mission-safety.test.ts` | CREATE | ~100 |

---

### Phase 22E — Mission Report Generator

**Goal:** Generate detailed report setelah mission selesai.

```mermaid
flowchart LR
    subgraph MissionData["📊 Mission Data"]
        Plan["Original Plan"]
        Logs["Execution Logs\n(every step + timestamp)"]
        Decisions["Decision Log\n(every choice + reasoning)"]
        Results["Task Results\n(files, data, summaries)"]
        Failures["Failure + Recovery Log"]
    end

    Template["📝 Report Template"]
    LLM["🧠 LLM: Summarize\n+ format naturally"]

    subgraph Report["📋 Mission Report"]
        Exec["Executive Summary"]
        Detail["Step-by-Step Detail"]
        Deliverable["Deliverables"]
        Audit["Decision Audit Trail"]
        Stats["Stats: time, tokens, cost"]
    end

    MissionData --> Template --> LLM --> Report

    Report -->|"Phase 8 channel"| Delivery["📧 Email / 📱 Telegram\n/ 🔔 Push Notification"]
```

**Report Format:**
```markdown
# Mission Report: Research EDITH Competitors

**Started:** 2026-03-08 23:00
**Completed:** 2026-03-09 00:15
**Duration:** 1h 15m
**Tokens Used:** 42,500 / 500,000
**API Calls:** 23 / 200
**Status:** ✅ COMPLETED

## Executive Summary
Researched 10 AI assistant projects, created comparison table...

## Steps Completed
1. ✅ [23:00] Searched GitHub for AI assistant projects (found 47)
2. ✅ [23:05] Filtered to top 10 by stars + features
3. ✅ [23:08] Analyzed competitors 1-5 (parallel)
   ...

## Decisions Made
- Chose GitHub stars as primary ranking metric because...
- Excluded project X because it's archived since 2024...

## Deliverables
- Google Doc: [link]
- Local copy: workspace/missions/competitors-2026-03-09.md

## Failures & Recoveries
- T3b attempt 1: GitHub API rate limit → waited 60s → retry OK
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-report.ts` | CREATE | ~120 |

---

### Phase 22F — Mobile Mission Control

**Goal:** Monitor dan approve missions dari HP saat jauh dari laptop.

```mermaid
sequenceDiagram
    participant Phone as 📱 Phone
    participant GW as 🌐 Gateway
    participant Mission as 🚀 Mission Engine

    Phone->>GW: ws://gateway/mission (subscribe)
    
    loop Every checkpoint
        Mission->>GW: mission_progress {completed: 5/10, current: "analyzing competitor 6"}
        GW->>Phone: push mission_progress
        Phone->>Phone: Update progress bar UI
    end

    Mission->>GW: approval_needed {action: "send email to 10 contacts"}
    GW->>Phone: push approval_request
    Phone->>Phone: Show swipe-to-approve card
    Phone->>GW: mission_approve {actionId: "...", approved: true}
    GW->>Mission: continue with approved action
```

**Mobile UI Components:**
```
Mission Dashboard:
  ┌─ Active Mission ─────────────────┐
  │ "Research EDITH Competitors"      │
  │ ██████████░░░░░░░░░░ 50%          │
  │ Step 5/10: Analyzing competitor 6 │
  │ 42min elapsed | ~30min remaining  │
  │                                   │
  │ [Pause]  [View Log]  [Abort]     │
  └───────────────────────────────────┘

  ┌─ Approval Queue ──────────────────┐
  │ ⚠️ Send email to 10 contacts      │
  │ Subject: "Comparison results..."  │
  │                                   │
  │ ← Swipe left: Reject             │
  │ → Swipe right: Approve           │
  └───────────────────────────────────┘
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/mobile/screens/MissionScreen.tsx` | CREATE | ~150 |
| `apps/mobile/components/MissionProgress.tsx` | CREATE | ~80 |
| `apps/mobile/components/ApprovalCard.tsx` | CREATE | ~60 |
| `EDITH-ts/src/gateway/mission-ws.ts` | CREATE | ~80 |

---

## 5. Acceptance Gates

```
□ User can describe mission in natural language → EDITH generates DAG plan
□ User can approve/reject plan before execution starts
□ Parallel tasks execute concurrently (measurably faster than sequential)
□ Checkpoint saves every 15min + on every task completion
□ Mission resumes from checkpoint after EDITH restart
□ Self-recovery: at least 1 retry with different approach before skipping
□ Budget hard stop: mission stops when token/time limit hit
□ Scope lock: EDITH cannot add unplanned tasks without approval
□ Sensitive actions queued for user (never auto-executed)
□ Dead man's switch: auto-stop after 30min no progress
□ Report delivered via configured channel (email/telegram/push)
□ Mobile: progress visible + approval possible from phone
□ "EDITH abort mission" → immediate stop + partial report
```

---

## 6. Koneksi ke Phase Lain

| Phase | Koneksi | Data Flow |
|-------|---------|-----------|
| Phase 6 (Proactive) | Mission can be triggered by proactive suggestion | proactive → suggest_mission |
| Phase 7 (Computer Use) | Mission tasks can use computer (browse, fill, click) | task → computer_use_agent |
| Phase 8 (Channels) | Report delivery via email/telegram/push | report → channel |
| Phase 11 (Multi-Agent) | Sub-tasks executed by Phase 11 agents | task → spawn_agent |
| Phase 13 (Knowledge) | Mission results saved to knowledge base | deliverables → knowledge_ingest |
| Phase 17 (Privacy) | Sensitive data handling within missions | data → privacy_check |
| Phase 20 (HUD) | Mission progress card in HUD overlay | progress → hud_card |
| Phase 21 (Emotional) | Pause/slow mission if user is stressed | mood → mission_pacing |
| Phase 27 (Cross-Device) | Start on laptop, monitor from phone | mission_state → device_sync |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/agents/mission-planner.ts` | CREATE | ~150 |
| `EDITH-ts/src/agents/mission-executor.ts` | CREATE | ~200 |
| `EDITH-ts/src/agents/mission-checkpoint.ts` | CREATE | ~80 |
| `EDITH-ts/src/agents/mission-recovery.ts` | CREATE | ~100 |
| `EDITH-ts/src/agents/mission-safety.ts` | CREATE | ~120 |
| `EDITH-ts/src/agents/mission-report.ts` | CREATE | ~120 |
| `EDITH-ts/src/agents/mission-types.ts` | CREATE | ~60 |
| `EDITH-ts/src/gateway/mission-ws.ts` | CREATE | ~80 |
| `EDITH-ts/src/agents/__tests__/mission-safety.test.ts` | CREATE | ~100 |
| `apps/mobile/screens/MissionScreen.tsx` | CREATE | ~150 |
| `apps/mobile/components/MissionProgress.tsx` | CREATE | ~80 |
| `apps/mobile/components/ApprovalCard.tsx` | CREATE | ~60 |
| **Total** | | **~1300** |

**New dependencies:** None beyond Phase 11 multi-agent infrastructure
