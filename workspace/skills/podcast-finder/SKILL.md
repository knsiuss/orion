---
name: podcast-finder
description: "Search for podcasts by topic, get episode recommendations, and find show summaries."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🎙️"
---

# Podcast Finder

## When to Use

Use for:
- Finding podcasts on a specific topic
- Getting recent episodes from a show
- Discovering new podcasts based on interests
- Getting a summary of a podcast episode

Do NOT use for:
- Streaming podcast audio (use Spotify or a native player)
- Subscribing to podcasts programmatically

## Data Sources

1. **Listen Notes API** (if `LISTEN_NOTES_API_KEY` is set): Full podcast database search
2. **iTunes Search API** (free, no key): Fallback for podcast discovery
3. **RSS feed parsing**: For episode details of a known podcast

### iTunes Search
```
GET https://itunes.apple.com/search?term={query}&media=podcast&limit=10
```

### Listen Notes Search
```
GET https://listen-api.listennotes.com/api/v2/search?q={query}&type=podcast
Authorization: X-ListenAPI-Key $LISTEN_NOTES_API_KEY
```

## Example Invocations

- "Find podcasts about artificial intelligence."
- "What are the latest episodes of Lex Fridman Podcast?"
- "Recommend a podcast for learning about investing."
- "Summarize the last episode of 'How I Built This'."

## What It Does

1. Searches the podcast database by topic or show name
2. Returns top matches with description, publisher, and episode count
3. Lists recent episodes for a specific show
4. Generates a summary of an episode description
