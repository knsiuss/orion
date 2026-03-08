---
name: wikipedia
description: "Search Wikipedia and return concise summaries of articles."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📖"
---

# Wikipedia

## When to Use

Use for:
- Getting a factual summary of a concept, person, place, or event
- Verifying historical facts or dates
- Getting an overview before deeper research
- Finding related topics via Wikipedia's category system

Do NOT use for:
- Breaking news (Wikipedia may not be up to date)
- Medical or legal advice (always recommend professional consultation)
- Highly technical deep-dives (use web-search for primary sources)

## API Reference

Uses the Wikipedia REST API (no key required).

### Search
```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
```

### Full-text Search
```
GET https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={query}&format=json
```

## Example Invocations

- "What is the Large Language Model?"
- "Tell me about the history of Indonesia."
- "Who is Alan Turing?"
- "Summarize the Wikipedia article on quantum computing."

## What It Does

1. Searches Wikipedia for the most relevant article
2. Fetches the article summary (introductory section)
3. Returns a concise 2–4 paragraph summary
4. Includes a link to the full article
5. Offers to go deeper on any subtopic
