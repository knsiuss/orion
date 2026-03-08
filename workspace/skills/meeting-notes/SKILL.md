---
name: meeting-notes
description: "Capture structured meeting notes with attendees, decisions, and action items."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🗒️"
---

# Meeting Notes

## When to Use

Use for:
- Capturing notes during or after a meeting
- Extracting action items and owners from a meeting transcript
- Generating a meeting summary to share with attendees
- Storing meeting context for future reference

Do NOT use for:
- Real-time transcription (use voice pipeline instead)
- Scheduling meetings (use calendar-intel skill)

## Output Format

EDITH produces structured notes in this format:

```markdown
## Meeting: <Title>
**Date:** YYYY-MM-DD  **Attendees:** Alice, Bob, Carol

### Context
<1-2 sentence summary>

### Key Decisions
- [ ] Decision 1
- [ ] Decision 2

### Action Items
| Owner | Task | Due |
|-------|------|-----|
| Alice | Deploy hotfix | Fri |
| Bob   | Write test plan | Next Mon |

### Notes
<freeform notes>
```

## Example Invocations

- "Start taking meeting notes. Attendees: me, Sarah, and the DevOps team."
- "Here's the transcript — extract the action items."
- "Summarize today's standup and send it to the team Slack channel."
- "Save these meeting notes to Notion under 'Engineering Meetings'."

## What It Does

1. Accepts dictated notes, a transcript, or freeform bullet points
2. Structures content into the canonical meeting notes format
3. Extracts action items with owners and due dates
4. Saves to memory and optionally pushes to Notion/Obsidian
