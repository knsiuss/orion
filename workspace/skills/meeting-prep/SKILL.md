---
name: meeting-prep
description: "Prepare for an upcoming meeting: research attendees, review context, and generate talking points."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📅"
---

# Meeting Prep

## When to Use

Use for:
- Preparing for an upcoming meeting or call
- Generating an agenda from past context
- Researching attendees before a first meeting
- Creating talking points aligned with your goals

Do NOT use for:
- Scheduling meetings (use calendar-intel skill)
- Taking notes during the meeting (use meeting-notes skill)

## Prep Workflow

1. **Retrieve context** — search memory for all prior interactions with attendees and the meeting topic
2. **Research attendees** — check relationship-map for known contacts; optionally web-search for unknowns
3. **Review open items** — pull any open tasks, issues, or follow-ups linked to these people
4. **Generate agenda** — structure talking points based on goals
5. **Anticipate questions** — identify likely pushback or questions

## Output Format

```markdown
## Prep: 1:1 with Marcus — Tue 10 Mar 2026, 15:00

### Context
Last meeting: 2026-02-20 — discussed Q1 roadmap. 3 open action items.

### Open Items
- [x] Marcus was to share security audit (still pending)
- [ ] I owe him the updated cost estimate

### Agenda
1. Status on security audit (Marcus)
2. Q1 cost estimate review (me)
3. Phase 33 timeline

### Talking Points
- Anchor on Phase 33 completion by end of March
- If audit delayed: propose async review by EOW
```

## Example Invocations

- "Prep me for my 3 PM meeting with Marcus."
- "Generate an agenda for tomorrow's product review."
- "What do I need to bring up in my call with the DevOps team?"

## What It Does

1. Identifies the meeting from calendar or user description
2. Pulls all relevant memory context for attendees and topic
3. Generates a structured prep brief with agenda and talking points
4. Flags open action items from prior meetings
