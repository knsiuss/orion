---
name: legion-delegate
description: "Delegate a task to a specialized Iron Legion instance (research, code, communication, or general)."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "⚙️"
    invokeKey: delegate
---

# Legion Delegate

## When to Use

Use for:
- Offloading a long-running research task to a background instance
- Delegating code generation to a specialized coding agent
- Routing communication drafting to a communication-specialist instance
- Running parallel tasks across multiple EDITH instances

Do NOT use for:
- Tasks that require the primary instance's session context (keep those local)
- Tasks requiring real-time user interaction (delegate must run asynchronously)

## Instance Roles

| Role | Specialization |
|------|---------------|
| `research` | Web search, summarization, data gathering |
| `code` | Code generation, debugging, refactoring |
| `communication` | Email drafts, Slack messages, meeting prep |
| `general` | Fallback for any unspecialized task |
| `primary` | The current instance (you) |

## How It Works

The Iron Legion (Phase 26) routes tasks via the `TaskRouter` and `LegionOrchestrator`.

1. `TaskRouter.classify()` identifies the best specialist role
2. `LegionOrchestrator.delegateToRole()` sends the task to an available instance
3. The delegating instance monitors progress and returns results

## Invoke

```
/delegate <task>
EDITH, delegate the competitive analysis to the research instance.
EDITH, have the coding agent refactor the memory module while I do other work.
```

## What It Does

1. Classifies the task to the optimal role
2. Checks for available registered instances
3. Sends the task with a signed Legion message
4. Monitors the task and streams status updates
5. Returns the result when the delegation completes
