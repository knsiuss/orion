---
name: situation-report
description: "Generate a current situation report (SITREP): system health, active tasks, open issues, and recent activity."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📡"
    invokeKey: sitrep
---

# Situation Report (SITREP)

## When to Use

Use for:
- Getting a real-time snapshot of everything in-flight
- Checking EDITH's system health (services, sidecars, channels)
- Reviewing open tasks and issues across all trackers
- Resuming after a period of absence

## SITREP Sections

1. **System Status** — All services, sidecars, channels online/offline
2. **Active Missions** — Running missions and milestone progress
3. **Open Tasks** — High-priority tasks across Todoist/Linear/Jira
4. **Open PRs / Issues** — GitHub PRs awaiting review or merge
5. **Pending Reminders** — Due or overdue reminders
6. **Recent Activity** — Last 5 significant events in episodic memory
7. **Alerts** — Anything requiring immediate attention

## Invoke

```
/sitrep
EDITH, situation report.
EDITH, what's the current state of everything?
```

## Output Format

```
📡 SITREP — Mon 09 Mar 2026, 14:32

SYSTEM: All services nominal. Voice: online. Channels: 4/5 active.

MISSIONS: [ACTIVE] Deploy EDITH to production — Milestone 2/4 in progress.

TASKS (P1):
  • [LINEAR] ENG-42 — Rate limiter bug (In Progress)
  • [TODOIST] Review security audit (Due today)

PRs: PR #55 awaiting review — open 2 days.

ALERTS: OctoPrint unreachable since 13:00. Check connection.
```

## What It Does

1. Polls all connected services for current state
2. Aggregates and deduplicates across trackers
3. Ranks items by urgency
4. Delivers a structured, scannable report
5. Offers to drill down on any section
