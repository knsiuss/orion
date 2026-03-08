---
name: relationship-map
description: "Map and recall your relationships: contacts, roles, interaction history, and context."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🗺️"
    invokeKey: people
---

# Relationship Map

## When to Use

Use for:
- Recalling context about a specific person before a meeting
- Understanding relationship dynamics in a team or org
- Logging a new contact with context
- Finding the right person for a task

Do NOT use for:
- CRM functionality for large customer databases (use a dedicated CRM)
- Storing sensitive PII without user consent

## Data Model

Each contact entry in memory:
```
Name: <name>
Role: <title / relationship>
Organization: <company / group>
Last Interaction: <date>
Context: <how you know them, ongoing topics>
Notes: <anything notable>
```

Stored in `workspace/USER.md` (contacts section) and vector memory for semantic search.

## Invoke

```
/people <name>
EDITH, who is Sarah Chen?
EDITH, remind me of the context on the DevOps team before my call.
EDITH, add a new contact: Marcus Lee, CTO at Nexus Labs, met at the AI summit.
```

## What It Does

1. Searches memory for all stored context on a person or group
2. Returns a relationship summary: role, history, ongoing topics
3. Flags any recent interactions relevant to the current task
4. Adds or updates contact entries on request
5. Maps team/org relationships when asked for org chart context
