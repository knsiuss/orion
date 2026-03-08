---
name: memory-audit
description: "Audit EDITH's memory contents: review stored facts, detect stale entries, and clean up."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🗂️"
    invokeKey: memory-audit
---

# Memory Audit

## When to Use

Use for:
- Reviewing everything EDITH has stored about you
- Finding and removing outdated or incorrect facts
- Checking what is in MEMORY.md, USER.md, and the vector store
- Privacy review — seeing all persisted data before export

Do NOT use for:
- Real-time conversation context (that lives in the session, not persisted memory)
- Browsing episodic logs in detail (use memory-search skill for that)

## Memory Layers

| Layer | Location | Contents |
|-------|----------|---------|
| Pinned Facts | `workspace/MEMORY.md` | High-confidence stable facts |
| User Profile | `workspace/USER.md` | Name, timezone, preferences |
| Vector Store | LanceDB | Semantic conversation history |
| Episodic Logs | `memory/YYYY-MM-DD.md` | Daily session highlights |
| Prisma DB | SQLite | UserPreference, sessions, feedback |

## Invoke

```
/memory-audit
EDITH, show me everything you know about me.
EDITH, audit your memory and flag anything outdated.
```

## What It Does

1. Reads all memory layers and aggregates contents
2. Lists stored facts grouped by category
3. Flags entries older than 90 days for review
4. Detects contradictions between memory layers
5. Presents a deletion/correction interface
6. Applies approved changes after confirmation
