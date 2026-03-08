---
name: email-summary
description: "Summarize emails or email threads, extract action items, and prioritize inbox."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📬"
    requires:
      env:
        - GMAIL_ACCESS_TOKEN
---

# Email Summary

## When to Use

Use for:
- Summarizing a long email thread
- Extracting action items and decisions from emails
- Triaging the inbox and flagging priority messages
- Getting a quick read on a forwarded email chain

Do NOT use for:
- Drafting replies (use email-draft skill)
- Sending emails (use email channel with confirmation)

## How It Works

With Gmail integration (`GMAIL_ACCESS_TOKEN`):
- Fetches unread or recent emails via Gmail API
- Parses thread structure

Without integration:
- User pastes email content directly
- EDITH analyzes the pasted text

### Gmail API
```
GET https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is:unread
```

## Output Format

```
📬 Email Summary — 7 unread

HIGH PRIORITY:
• From: client@corp.com — "Production outage?" — Needs immediate response

ACTION ITEMS FROM THREADS:
• Reply to Marcus about contract by EOD
• Share Q1 report with the board by Friday

LOW PRIORITY (3 newsletters, 2 notifications — skipped)
```

## Example Invocations

- "Summarize my inbox from the last 24 hours."
- "What action items are in this email thread?" (paste thread)
- "Flag anything urgent in my unread emails."
- "Summarize the email chain about the Q1 budget."

## What It Does

1. Fetches or accepts the email content
2. Identifies sender, subject, and core message
3. Extracts action items, deadlines, and decisions
4. Ranks emails by urgency
5. Returns a structured digest
