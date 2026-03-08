---
name: movie-recommender
description: "Recommend movies and shows based on taste, mood, or a seed title."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🎬"
---

# Movie Recommender

## When to Use

Use for:
- Finding movies or TV shows to watch tonight
- Getting recommendations similar to a film you loved
- Checking ratings and reviews for a title
- Building a watchlist

Do NOT use for:
- Streaming directly (open the appropriate app)
- Finding illegal streams or torrents

## Data Sources

1. **TMDB API** (`TMDB_API_KEY`) — primary source for metadata and recommendations
2. **OMDb API** (`OMDB_API_KEY`) — fallback for IMDb ratings
3. **LLM knowledge** — curated thematic recommendations

### TMDB Recommendations
```
GET https://api.themoviedb.org/3/movie/{movie_id}/recommendations?api_key=$TMDB_API_KEY
```

### Search
```
GET https://api.themoviedb.org/3/search/movie?query={title}&api_key=$TMDB_API_KEY
```

## Output Format

```
🎬 You might like:

1. "Interstellar" (2014) — Christopher Nolan  ⭐ 8.7/10
   Epic space sci-fi with time dilation. Mind-bending and emotional.

2. "Arrival" (2016) — Denis Villeneuve  ⭐ 8.0/10
   Linguistic first contact thriller. Quiet and profound.
```

## Example Invocations

- "Recommend something like 'Blade Runner 2049'."
- "What's a good thriller to watch tonight?"
- "What's the rating for 'Oppenheimer'?"
- "Add 'Dune: Part Two' to my watchlist."

## What It Does

1. Identifies user's mood or seed title
2. Fetches TMDB recommendations or searches by genre/keyword
3. Returns 3–5 picks with ratings and a brief hook
4. Saves watchlist additions to memory
