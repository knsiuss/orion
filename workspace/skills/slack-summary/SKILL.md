---
name: slack-summary
description: "Summarize Slack channel activity, extract decisions, and surface important messages."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "💬"
    requires:
      env:
        - SLACK_BOT_TOKEN
---

# Slack Summary

## When to Use

Use for:
- Catching up on a Slack channel after being away
- Extracting decisions and action items from a busy channel
- Surfacing messages that need your attention
- Daily digest of key team discussions

Do NOT use for:
- Sending Slack messages (use the Slack channel directly)
- Monitoring all channels simultaneously (too noisy — pick specific channels)

## API Reference

Uses Slack Web API.
Base URL: `https://slack.com/api`

### Get Channel History
```
POST /conversations.history
{ "channel": "<channel_id>", "oldest": "<unix_ts>", "limit": 100 }
```

### List Channels
```
POST /conversations.list
{ "types": "public_channel,private_channel", "exclude_archived": true }
```

## Example Invocations

- "Summarize #engineering from the last 8 hours."
- "What decisions were made in #product today?"
- "Catch me up on #general — I was offline since morning."
- "Are there any messages in Slack that need my response?"

## What It Does

1. Fetches channel history for the specified time window
2. Groups messages by thread and topic
3. Identifies decisions, action items, and questions asked of you
4. Returns a structured digest with message links
5. Highlights any messages that directly mention you
