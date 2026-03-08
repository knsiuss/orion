---
name: book-recommender
description: "Recommend books based on interests, reading history, or a seed book."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📚"
---

# Book Recommender

## When to Use

Use for:
- Getting book recommendations by genre, topic, or mood
- Finding books similar to one you've already read
- Getting a summary or review of a specific book
- Building a reading list

Do NOT use for:
- Purchasing or downloading books (provide links only)
- Academic paper recommendations (use web-search with arXiv)

## Recommendation Approach

EDITH combines:
1. **User reading history** from memory (books mentioned in past conversations)
2. **Open Library / Google Books API** for metadata and descriptions
3. **LLM knowledge** for curated "books like X" recommendations

### Google Books Search
```
GET https://www.googleapis.com/books/v1/volumes?q={query}&maxResults=10
```

## Output Format

```
📚 Recommended for you:

1. "Project Hail Mary" — Andy Weir
   Hard sci-fi, lone astronaut survival. If you liked "The Martian".

2. "The Three-Body Problem" — Liu Cixin
   Epic hard sci-fi trilogy, alien contact, physics puzzles.
```

## Example Invocations

- "Recommend books similar to 'Dune'."
- "I want something on stoicism and philosophy."
- "What are the best books on systems thinking?"
- "Add 'Atomic Habits' to my reading list."

## What It Does

1. Analyzes the user's request and reading history
2. Generates a curated list of 3–5 recommendations
3. Provides a 1-sentence reason for each pick
4. Saves accepted recommendations to the user's reading list in memory
