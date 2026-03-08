---
name: simulation-what-if
description: "Run what-if simulations before executing actions: preview effects, diff changes, and enable rollback."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔭"
    invokeKey: simulate
---

# Simulation / What-If

## When to Use

Use for:
- Previewing the effect of a file operation before executing it
- Simulating a shell command in a sandbox
- Exploring "what would happen if..." scenarios
- Taking a snapshot before a risky operation for rollback

Do NOT use for:
- Simulations that require real network calls (those cannot be sandboxed safely)
- Replacing actual execution — simulation is always followed by explicit user approval

## How It Works

The simulation engine (Phase 25) provides:
1. **ActionClassifier**: Classifies actions as read/write/destructive/external
2. **PreviewEngine**: Shows a diff of what would change
3. **VirtualFS**: Applies file changes in memory without touching disk
4. **SandboxEngine**: Runs shell commands in a temporary directory
5. **SnapshotManager**: Takes before-state snapshot for rollback
6. **RollbackEngine**: Reverts changes using the snapshot

## Invoke

```
/simulate <action>
EDITH, simulate deleting all log files.
EDITH, what would happen if I ran this migration?
EDITH, show me a preview before you apply those changes.
```

## What It Does

1. Classifies the requested action
2. Runs the action in the virtual environment
3. Shows a unified diff of what would change
4. Presents risk level (read / write / destructive)
5. Asks for confirmation before executing for real
6. Takes a snapshot before real execution for rollback capability
