---
name: focus-timer
description: "Start a Pomodoro or custom focus timer with break reminders and session tracking."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🍅"
---

# Focus Timer

## When to Use

Use for:
- Starting a timed focus session (default 25 min Pomodoro)
- Taking scheduled short or long breaks
- Tracking how many focus sessions were completed today
- Blocking distractions during a session (via quiet-hours integration)

Do NOT use for:
- Scheduling recurring calendar events (use calendar-intel skill)
- System-level app blocking (requires OS agent integration)

## Session Modes

| Mode | Work | Short Break | Long Break |
|------|------|-------------|------------|
| Pomodoro | 25 min | 5 min | 15 min (every 4) |
| Deep Work | 90 min | 15 min | — |
| Custom | User-defined | User-defined | — |

## How It Works

1. Records session start time and duration in episodic memory
2. Schedules a notification (via voice or channel) at session end
3. Activates quiet-hours mode for the session duration
4. After 4 Pomodoros, suggests a long break automatically

## Example Invocations

- "Start a Pomodoro. I'm working on the auth refactor."
- "Begin a 90-minute deep work session."
- "How many focus sessions have I done today?"
- "Stop the timer, I need to take a call."

## What It Does

1. Parses duration and session label from user input
2. Sets EDITH to quiet mode for the session
3. Sends a start notification with the task name
4. Fires a "time's up" alert at session end with break suggestion
5. Logs session to `memory/YYYY-MM-DD.md` for habit tracking
