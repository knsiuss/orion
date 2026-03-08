---
name: morning-briefing
description: "Deliver a personalized morning briefing: calendar, tasks, weather, news, and reminders."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "☀️"
    invokeKey: briefing
---

# Morning Briefing

## When to Use

Use for:
- Starting the day with a contextual situational summary
- Getting a combined view of calendar, tasks, weather, and headlines
- Activating EDITH's proactive morning mode
- Syncing with any overnight updates

Automatically triggered by the daemon at the configured morning time.
Can also be invoked manually at any time.

## Briefing Sections

1. **Good Morning** — Greeting with date, day of week, time
2. **Weather** — Current conditions + today's forecast
3. **Calendar** — Today's meetings and events
4. **Tasks** — Top 3–5 priority tasks for the day
5. **News** — Top 3 headlines (configurable topics)
6. **Reminders** — Any pending reminders for today
7. **Active Missions** — Quick status on running missions

## Invoke

```
/briefing
EDITH, good morning.
EDITH, give me my morning briefing.
```

## Customization

User preferences (stored in UserPreference) control:
- `morningBriefingTime`: default `07:30`
- `briefingSections`: which sections to include
- `newsTopics`: preferred news categories
- `verbosity`: compact vs. detailed mode

## What It Does

1. Assembles data from weather, calendar, tasks, news, and memory skills
2. Formats a structured briefing tailored to user's verbosity preference
3. Delivers via the primary channel (voice or chat)
4. Flags any urgent items (overdue tasks, meetings in < 30 min)
5. Asks if there is anything specific to prepare for
