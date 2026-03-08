---
name: youtube
description: "Search YouTube videos, get video details, and retrieve transcripts for summarization."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "▶️"
    requires:
      env:
        - YOUTUBE_API_KEY
---

# YouTube

## When to Use

Use for:
- Searching YouTube for videos on a topic
- Getting video details (title, channel, view count, duration)
- Fetching a video transcript for summarization
- Finding tutorials or explainer videos

Do NOT use for:
- Downloading videos (against YouTube ToS)
- Accessing private or age-restricted content

## API Reference

Uses YouTube Data API v3.
Base URL: `https://www.googleapis.com/youtube/v3`

### Search Videos
```
GET /search?part=snippet&q={query}&type=video&maxResults=5&key=$YOUTUBE_API_KEY
```

### Video Details
```
GET /videos?part=snippet,statistics,contentDetails&id={video_id}&key=$YOUTUBE_API_KEY
```

### Transcript (via youtube-transcript API)
```
GET https://www.youtube.com/watch?v={video_id}
(parsed with ytdl-core or yt-dlp subtitle extraction)
```

## Example Invocations

- "Find YouTube videos about 'LLM fine-tuning'."
- "What's the most popular video on EDITH AI?"
- "Summarize this YouTube video: https://youtube.com/watch?v=..."
- "Find a tutorial on Prisma with TypeScript."

## What It Does

1. Searches YouTube Data API for relevant videos
2. Returns ranked results with title, channel, views, and duration
3. Fetches and summarizes the transcript on request
4. Surfaces the top result with a direct link
