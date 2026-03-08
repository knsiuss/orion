---
name: news-briefing
description: "Deliver a concise daily news digest from top sources, filterable by topic."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📰"
    requires:
      env:
        - NEWS_API_KEY
---

# News Briefing

## When to Use

Use for:
- Morning news briefing across top headlines
- Topic-specific news (tech, AI, finance, geopolitics)
- Breaking news on a specific event
- Weekly digest summarization

Do NOT use for:
- Real-time stock ticker data (use stock-quotes skill)
- Detailed investigative research (use web-search skill)

## API Reference

Uses NewsAPI.org.
Base URL: `https://newsapi.org/v2`

### Top Headlines
```
GET /top-headlines?country=us&pageSize=10&apiKey=$NEWS_API_KEY
```

### Topic Search
```
GET /everything?q=artificial+intelligence&sortBy=publishedAt&pageSize=10&apiKey=$NEWS_API_KEY
```

## Output Format

```
📰 EDITH News Briefing — Mon, March 9, 2026

1. [Tech] OpenAI releases GPT-5 with extended reasoning — TechCrunch (2h ago)
2. [Finance] Fed holds rates steady amid mixed signals — Bloomberg (4h ago)
3. [World] Indonesia wins UN climate funding deal — Reuters (6h ago)
```

## Example Invocations

- "Give me today's morning briefing."
- "What's happening in AI this week?"
- "Any news about the Indonesia tech sector?"
- "Summarize the top 5 stories from the last 24 hours."

## What It Does

1. Fetches top headlines or topic-filtered articles
2. Deduplicates similar stories
3. Summarizes each article in one sentence
4. Groups by category and ranks by recency and relevance
