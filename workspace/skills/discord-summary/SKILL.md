---
name: discord-summary
description: "Summarize Discord channel activity, extract key discussions, and surface mentions."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🎮"
    requires:
      env:
        - DISCORD_BOT_TOKEN
---

# Discord Summary

## When to Use

Use for:
- Catching up on a Discord server or channel after being away
- Extracting key announcements or decisions from a community
- Summarizing a long discussion thread
- Finding messages that mention you

Do NOT use for:
- Sending Discord messages (use the Discord channel directly)
- Accessing DMs (privacy boundary — only public channels)

## API Reference

Uses Discord REST API.
Base URL: `https://discord.com/api/v10`

### Get Channel Messages
```
GET /channels/{channel_id}/messages?limit=100&after={snowflake}
```

### Get Guild Channels
```
GET /guilds/{guild_id}/channels
```

## Example Invocations

- "Summarize #announcements on the EDITH Discord."
- "What's been discussed in the dev channel in the last 24 hours?"
- "Catch me up on the community server — I've been offline since Friday."
- "Are there any messages mentioning me in the Discord?"

## What It Does

1. Fetches recent messages from the specified channel
2. Groups by topic and thread
3. Highlights announcements, decisions, and direct mentions
4. Returns a concise digest with jump links
5. Flags any moderation alerts or important server notices
