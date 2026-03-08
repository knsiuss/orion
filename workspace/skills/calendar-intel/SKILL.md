---
name: calendar-intel
description: "Intelligent calendar management: view, create, and analyze events via Google Calendar or CalDAV."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🗓️"
    requires:
      env:
        - GOOGLE_CALENDAR_ACCESS_TOKEN
---

# Calendar Intel

## When to Use

Use for:
- Viewing upcoming events and free/busy slots
- Creating or updating calendar events
- Finding the best time to schedule a meeting
- Analyzing schedule patterns (over-booked days, back-to-back meetings)
- Setting travel time buffers between events

Do NOT use for:
- Task management (use Todoist or Linear)
- Reminders without events (use Apple Reminders)

## API Reference

Uses Google Calendar API.
Base URL: `https://www.googleapis.com/calendar/v3`

### List Events
```
GET /calendars/primary/events?timeMin={now}&maxResults=10&orderBy=startTime&singleEvents=true
```

### Create Event
```
POST /calendars/primary/events
{
  "summary": "Team Sync",
  "start": { "dateTime": "2026-03-10T14:00:00+07:00" },
  "end": { "dateTime": "2026-03-10T15:00:00+07:00" },
  "attendees": [{ "email": "alice@example.com" }]
}
```

## Example Invocations

- "What's on my calendar today?"
- "Schedule a 30-min call with Sarah tomorrow afternoon."
- "When am I free this week for a 2-hour deep work block?"
- "Block Friday morning for heads-down coding."
- "How many meetings do I have this week?"

## What It Does

1. Fetches and parses calendar events
2. Analyzes free/busy windows for scheduling
3. Creates, updates, or deletes events with confirmation
4. Flags scheduling conflicts and back-to-back meetings
5. Suggests optimal meeting times based on energy patterns (if habit-model data is available)
