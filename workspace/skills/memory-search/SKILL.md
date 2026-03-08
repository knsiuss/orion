---
name: memory-search
description: "Deep search across all EDITH memory layers: vector store, episodic logs, and pinned facts."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔎"
    invokeKey: recall
---

# Memory Search

## When to Use

Use for:
- Finding a specific past conversation or decision
- Recalling context from weeks or months ago
- Searching for when something was first discussed
- Cross-referencing facts across multiple memory layers

Do NOT use for:
- Current session context (already in context window)
- Web searches (use web-search skill)

## Search Layers

1. **Vector Store** (LanceDB): Semantic search across all saved interactions
2. **Episodic Logs** (`memory/YYYY-MM-DD.md`): Full-text search of daily logs
3. **MEMORY.md**: Pinned facts scan
4. **USER.md**: User profile scan
5. **Prisma FeedbackRecord**: Feedback signals related to a topic

## Search Strategy

EDITH uses hybrid retrieval:
- Vector similarity for semantic matches
- FTS5 full-text search for exact phrases
- Results ranked by relevance + recency

## Invoke

```
/recall <query>
EDITH, when did we last discuss the deployment strategy?
EDITH, find everything you remember about my work on the EDITH hardware phase.
```

## What It Does

1. Runs hybrid search (vector + FTS) across all memory layers
2. Returns ranked results with date, source, and excerpt
3. Groups related results by topic
4. Surfaces the most relevant 5–10 memories
5. Offers to load a full episodic log for a specific date
