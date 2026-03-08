# Phase 25 — Digital Twin & Simulation Mode

> "Tony simulasi suit di hologram sebelum build. EDITH simulasi aksi sebelum execute."

**Prioritas:** 🟢 LOW-MEDIUM — Safety net yang mencegah mistakes mahal
**Depends on:** Phase 7 (computer use), Phase 17 (privacy vault), Phase 11 (multi-agent)
**Status:** ❌ Not started

---

## 1. Tujuan

Sebelum menjalankan aksi yang berisiko (deploy code, kirim email massal, edit file penting),
EDITH bisa **simulate** hasilnya di sandbox. User review preview → approve → execute.
Plus: full undo/rollback engine untuk setiap aksi EDITH.

Ini "simulation chamber" Tony Stark — test di virtual dulu, baru execute di real world.

```mermaid
flowchart TD
    User["🗣️ 'EDITH, merge PR ini\nke production'"]
    
    subgraph Simulation["🔮 Simulation Mode"]
        Preview["Preview Engine\nGenerate diff/impact\nwithout executing"]
        Sandbox["Sandbox Execute\nRun in isolated container"]
        WhatIf["What-If Analysis\n'Kalau merge, apa yang break?'"]
    end

    subgraph Decision["✅ Decision Point"]
        Show["Show results to user"]
        Approve{{"Approve?"}}
    end

    subgraph Execution["⚡ Real Execution"]
        Execute["Execute for real"]
        Snapshot["Create restore point"]
    end

    subgraph Rollback["🔄 Rollback Engine"]
        Undo["Undo last action"]
        History["Action history\n(last 50 actions)"]
    end

    User --> Preview
    Simulation --> Show --> Approve
    Approve -->|"Yes"| Snapshot --> Execute
    Approve -->|"No"| Cancel["Cancel"]
    Execute --> History
    History --> Undo
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | SWE-agent: Agent-Computer Interfaces for SE | arXiv:2405.15793 | Agent sandbox execution pattern — isolated env untuk code changes |
| 2 | E2B (open source) | e2b.dev | Cloud sandboxes for AI agents — disposable execution environments |
| 3 | Docker Container Sandboxing for CI | doi:10.1109/ICSME.2016.58 | Isolation patterns for safe code execution |
| 4 | Undo/Redo Architecture (Command Pattern) | GoF Design Patterns | Command pattern → every action is reversible object |
| 5 | Speculative Execution in Databases | doi:10.1145/2723372.2723713 | Preview query results without committing — basis preview engine |
| 6 | CodeSandbox / StackBlitz (WebContainers) | codesandbox.io | Browser-based isolated execution — lightweight alternative to Docker |
| 7 | Shadow Testing (LaunchDarkly pattern) | launchdarkly.com | Run new code path in shadow mode, compare with production |
| 8 | Safepoint: A System for Consistent Rollback | arXiv:2312.04529 | Consistent snapshot + rollback for distributed systems |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: Simulation NEVER affects real state.
        Sandbox is fully isolated: separate filesystem, network, DB.
        No sandbox action can leak to production.

Rule 2: Preview mode is the DEFAULT for destructive actions.
        File delete, git push, email send → auto-preview first.
        User can skip preview with "EDITH, just do it" (opt-in skip).

Rule 3: Restore points are automatic.
        Every non-read action → snapshot before execution.
        Snapshots retained: last 50 or 7 days, whichever is less.

Rule 4: Rollback is cascading.
        Undo action A that triggered B and C → undo C, B, then A.
        If cascade would affect external systems → warn user first.
```

### 3.2 System Architecture

```mermaid
flowchart TD
    subgraph Pipeline["🔄 Message Pipeline"]
        Action["Tool Call\n(file_write, git_push, etc.)"]
        Classifier["Action Classifier\nread vs write vs destructive"]
    end

    subgraph SimLayer["🔮 Simulation Layer"]
        direction TB
        Preview["Preview Engine\n(generate diff/description)"]
        Sandbox["Sandbox Engine\n(Docker / WebContainer)"]
        WhatIf["What-If Engine\n(impact analysis)"]
    end

    subgraph SafetyLayer["🛡️ Safety Layer"]
        SnapshotMgr["Snapshot Manager\n(create restore points)"]
        ActionLog["Action Log\n(every mutation logged)"]
        RollbackEngine["Rollback Engine\n(reverse by replay)"]
    end

    Action --> Classifier
    Classifier -->|"read"| DirectExec["Direct Execute\n(no simulation needed)"]
    Classifier -->|"write"| Preview
    Classifier -->|"destructive"| Sandbox
    
    Preview --> UserDecision{{"User: Approve?"}}
    Sandbox --> UserDecision
    
    UserDecision -->|"Yes"| SnapshotMgr --> Execute["Real Execute"]
    UserDecision -->|"No"| Discard["Discard"]
    
    Execute --> ActionLog
    ActionLog --> RollbackEngine
```

### 3.3 Cross-Device Simulation

```mermaid
flowchart LR
    subgraph Phone["📱 Phone"]
        PhonePreview["Preview Card\n'EDITH wants to merge PR.\nImpact: 3 files, 2 tests affected.\n[Approve] [Reject] [Simulate]'"]
    end

    subgraph Gateway["🌐 EDITH Gateway"]
        SimEngine["Simulation Engine"]
        ActionQueue["Pending Action Queue"]
    end

    subgraph Laptop["💻 Laptop"]
        Sandbox["Docker Sandbox"]
        RealExec["Real Execution"]
    end

    SimEngine --> ActionQueue
    ActionQueue -->|"push notification"| PhonePreview
    PhonePreview -->|"approve"| RealExec
    PhonePreview -->|"simulate"| Sandbox
    Sandbox -->|"results"| PhonePreview
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["25A\nAction Preview\nEngine"]
    B["25B\nSandbox Execution\n(Docker/WebContainer)"]
    C["25C\nWhat-If Analysis"]
    D["25D\nSnapshot & Restore\nPoints"]
    E["25E\nRollback Engine"]
    F["25F\nMobile Approval\nUI"]

    A --> B --> C
    A --> D --> E
    A --> F
```

---

### Phase 25A — Action Preview Engine

**Goal:** Generate readable preview of what an action will do, before doing it.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Preview as Preview Engine

    User->>EDITH: "Replace all TODO comments in src/ with FIXME"
    EDITH->>Preview: preview({action: "find_replace", target: "src/**", find: "TODO", replace: "FIXME"})
    
    Preview->>Preview: Scan files (read-only)
    Preview->>Preview: Generate diff for each file
    
    Preview-->>EDITH: PreviewResult {\n  affected: 12 files,\n  changes: 23 replacements,\n  diff: [file1: +3 -3, ...]\n}
    
    EDITH-->>User: "Preview:\n- 12 files affected\n- 23 'TODO' → 'FIXME' replacements\n- Files: config.ts (+3), main.ts (+5), ...\n\nProceed?"
    
    User->>EDITH: "Go ahead"
    EDITH->>EDITH: Execute for real
```

**Preview Types:**
| Action Type | Preview Format |
|-------------|---------------|
| File edit | Unified diff (like `git diff`) |
| File delete | List files + sizes + last modified |
| Git push | Commits list + changed files + remote impact |
| Email send | Full draft + recipients + "sent as" |
| API call (write) | Request body + endpoint + expected response |
| Database query (write) | SQL + affected rows estimate |
| Shell command | Explain what command does + dry-run if possible |

```typescript
interface ActionPreview {
  actionId: string;
  type: string;
  description: string;            // human-readable: "Replace 23 TODOs with FIXME in 12 files"
  impact: 'low' | 'medium' | 'high' | 'critical';
  affectedResources: string[];    // file paths, URLs, DB tables
  diff?: string;                  // unified diff format
  reversible: boolean;            // can this be undone?
  estimatedDuration: number;      // ms
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/preview-engine.ts` | CREATE | ~150 |
| `EDITH-ts/src/core/simulation/action-classifier.ts` | CREATE | ~80 |
| `EDITH-ts/src/core/simulation/types.ts` | CREATE | ~60 |

---

### Phase 25B — Sandbox Execution

**Goal:** Execute actions in isolated environment untuk verify hasil sebelum real execution.

```mermaid
flowchart TD
    subgraph SandboxTypes["🏗️ Sandbox Types"]
        Docker["Docker Container\n- Full OS isolation\n- Network isolated\n- Disposable\n- ~3s startup"]
        WebContainer["WebContainer (StackBlitz)\n- Browser-based\n- Instant startup\n- JS/TS only\n- ~100ms startup"]
        VirtualFS["Virtual Filesystem\n- In-memory file ops\n- No actual writes\n- Fastest\n- ~0ms startup"]
    end

    Classifier{"Action Type?"}
    
    Classifier -->|"Code execution\nShell command"| Docker
    Classifier -->|"JS/TS code\nNPM scripts"| WebContainer
    Classifier -->|"File read/write\nText processing"| VirtualFS

    Docker & WebContainer & VirtualFS --> Result["Sandbox Result\n{success, output, side_effects}"]
    Result --> Compare["Compare with expected"]
```

```typescript
interface SandboxConfig {
  type: 'docker' | 'webcontainer' | 'virtual-fs';
  timeoutMs: number;              // max execution time
  memoryLimitMb: number;          // max memory
  networkAccess: boolean;         // allow internet in sandbox?
  mountPaths: string[];           // which host paths to copy into sandbox
}

// DECISION: Default to virtual-fs, escalate to Docker for shell commands
// WHY: Virtual-fs is instant (0ms), Docker takes 3s startup
// ALTERNATIVES: Always Docker (too slow), always virtual (can't run shell)
// REVISIT: When WebContainers mature beyond JS/TS
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/sandbox-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/sandbox-docker.ts` | CREATE | ~100 |
| `EDITH-ts/src/core/simulation/sandbox-virtual-fs.ts` | CREATE | ~80 |

---

### Phase 25C — What-If Analysis

**Goal:** Answer "apa yang terjadi kalau..." questions.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant WhatIf as What-If Engine
    participant LLM
    participant Sandbox

    User->>EDITH: "Kalau gue merge PR #42, ada breaking changes ga?"
    EDITH->>WhatIf: analyze({action: "merge_pr", pr: 42})
    
    WhatIf->>WhatIf: Fetch PR diff
    WhatIf->>Sandbox: Apply diff in sandbox
    WhatIf->>Sandbox: Run tests in sandbox
    Sandbox-->>WhatIf: 2 tests failed, 1 type error
    
    WhatIf->>LLM: Explain impact in natural language
    LLM-->>WhatIf: "PR #42 introduces breaking change in UserService API..."
    
    WhatIf-->>EDITH: WhatIfResult
    EDITH-->>User: "⚠️ Kalau merge PR #42:\n- 2 tests akan fail (user.test.ts, auth.test.ts)\n- 1 type error di UserService\n- Breaking change di API endpoint /users\n\nRecommendation: Fix tests dulu sebelum merge."
```

**What-If Scenarios:**
```
"Kalau gue merge PR ini?"          → sandbox run tests + type check
"Kalau gue pake Groq instead OpenAI?" → cost + speed comparison estimate
"Kalau gue reschedule meeting?"    → check calendar conflicts for all attendees
"Kalau gue deploy versi ini?"      → sandbox run build + smoke tests
"Kalau gue delete file ini?"       → check imports, dependents, references
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/what-if-engine.ts` | CREATE | ~120 |

---

### Phase 25D — Snapshot & Restore Points

**Goal:** Automatic restore point sebelum setiap mutation.

```mermaid
flowchart TD
    Action["Action: edit file X"]
    
    subgraph Snapshot["📸 Snapshot"]
        ReadState["Read current state\nof affected resources"]
        Store["Store in snapshot DB\n{action_id, timestamp,\npre_state, post_state}"]
    end

    Execute["Execute action"]
    Verify["Verify success"]

    Action --> ReadState --> Store --> Execute --> Verify

    subgraph Retention["🗑️ Retention Policy"]
        Keep50["Keep last 50 snapshots"]
        Keep7D["OR keep 7 days"]
        Prune["Prune older snapshots\n(whichever limit hit first)"]
    end

    Store --> Retention
```

```typescript
interface ActionSnapshot {
  id: string;
  actionId: string;
  timestamp: number;
  type: string;                   // 'file_write', 'git_push', 'email_send'
  target: string;                 // file path, git remote, email address
  preState: Buffer | string;      // state before action
  postState?: Buffer | string;    // state after action (for verification)
  childSnapshots: string[];       // cascaded actions
  reversible: boolean;
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/snapshot-manager.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/snapshot-store.ts` | CREATE | ~80 |

---

### Phase 25E — Rollback Engine

**Goal:** "EDITH, undo yang barusan" → reverse last action(s).

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Rollback as Rollback Engine
    participant Snapshot as Snapshot Store

    User->>EDITH: "EDITH, undo yang barusan"
    EDITH->>Rollback: rollback({count: 1})
    Rollback->>Snapshot: getLatestSnapshot()
    Snapshot-->>Rollback: Snapshot: file_write to config.ts
    
    Rollback->>Rollback: Has child snapshots? No
    Rollback->>Rollback: Restore config.ts to pre_state
    Rollback-->>EDITH: Rolled back: config.ts restored
    
    EDITH-->>User: "Done, config.ts dikembalikan ke versi sebelumnya."
```

**Cascading Undo:**
```mermaid
flowchart TD
    Action_A["Action A: Create feature branch"]
    Action_B["Action B: Write 3 files"]
    Action_C["Action C: Commit + push"]

    Undo["'EDITH, undo deploy barusan'"]
    
    Undo --> Undo_C["Undo C: git reset + force delete remote branch"]
    Undo_C --> Undo_B["Undo B: Delete 3 created files"]
    Undo_B --> Undo_A["Undo A: Delete branch"]

    Action_A --> Action_B --> Action_C

    Note["Cascading: undo in REVERSE order\nWarn user before undo affects\nexternal systems (remote push)"]
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/rollback-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/__tests__/rollback-engine.test.ts` | CREATE | ~100 |

---

### Phase 25F — Mobile Approval UI

**Goal:** Approve/reject previewed actions dari HP.

```
Mobile Approval Card:
  ┌─ Action Preview ──────────────────┐
  │ 📝 Replace TODO → FIXME           │
  │                                   │
  │ Impact: 12 files, 23 changes     │
  │ Risk: 🟢 LOW                     │
  │                                   │
  │ config.ts:                        │
  │ - // TODO: implement cache        │
  │ + // FIXME: implement cache       │
  │                                   │
  │ [Approve] [Reject] [Simulate]    │
  └───────────────────────────────────┘
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `apps/mobile/components/ActionPreviewCard.tsx` | CREATE | ~80 |
| `apps/mobile/screens/ApprovalScreen.tsx` | CREATE | ~100 |

---

## 5. Acceptance Gates

```
□ File edit shows diff preview before execution
□ Git push shows commits + affected files before pushing
□ Docker sandbox runs code without affecting host filesystem
□ Virtual-fs preview generates correct diff in <100ms
□ What-if: "merge PR" runs tests in sandbox + reports failures
□ Snapshot created automatically before every write action
□ "EDITH undo" reverses last action correctly
□ Cascading undo works for multi-step actions
□ Snapshot retention: max 50 or 7 days, auto-prune older
□ Mobile: approve/reject previews from phone
□ "EDITH just do it" skips preview (opt-in bypass)
□ Rollback of external actions (git push) warns before executing
```

---

## 6. Koneksi ke Phase Lain

| Phase | Koneksi | Data Flow |
|-------|---------|-----------|
| Phase 7 (Computer Use) | All computer actions get preview | tool_call → preview_engine |
| Phase 11 (Multi-Agent) | Agent actions previewed before execute | agent_action → simulation |
| Phase 17 (Privacy) | Preview hides sensitive data in diff display | preview → privacy_filter |
| Phase 22 (Mission) | Mission tasks previewed (batch approve) | mission_task → preview_queue |
| Phase 23 (Hardware) | Hardware commands get safety preview | hw_command → preview |
| Phase 27 (Cross-Device) | Approve from phone, execute on laptop | approval → device_sync |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/core/simulation/preview-engine.ts` | CREATE | ~150 |
| `EDITH-ts/src/core/simulation/action-classifier.ts` | CREATE | ~80 |
| `EDITH-ts/src/core/simulation/sandbox-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/sandbox-docker.ts` | CREATE | ~100 |
| `EDITH-ts/src/core/simulation/sandbox-virtual-fs.ts` | CREATE | ~80 |
| `EDITH-ts/src/core/simulation/what-if-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/snapshot-manager.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/snapshot-store.ts` | CREATE | ~80 |
| `EDITH-ts/src/core/simulation/rollback-engine.ts` | CREATE | ~120 |
| `EDITH-ts/src/core/simulation/types.ts` | CREATE | ~60 |
| `EDITH-ts/src/core/simulation/__tests__/rollback-engine.test.ts` | CREATE | ~100 |
| `apps/mobile/components/ActionPreviewCard.tsx` | CREATE | ~80 |
| `apps/mobile/screens/ApprovalScreen.tsx` | CREATE | ~100 |
| **Total** | | **~1310** |

**New dependencies:** `dockerode` (Docker API), `memfs` (in-memory filesystem)
