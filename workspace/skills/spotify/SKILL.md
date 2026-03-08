---
name: spotify
description: "Control Spotify playback, search for music, and manage playlists via the Spotify Web API."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🎵"
    requires:
      env:
        - SPOTIFY_CLIENT_ID
        - SPOTIFY_CLIENT_SECRET
        - SPOTIFY_REFRESH_TOKEN
---

# Spotify

## When to Use

Use for:
- Playing a song, album, artist, or playlist
- Pausing, skipping, or adjusting volume
- Queuing tracks
- Searching for music
- Getting info on what's currently playing

Do NOT use for:
- Downloading music (not supported by API)
- Managing podcast subscriptions (use podcast-finder skill)

## API Reference

Base URL: `https://api.spotify.com/v1`
Auth: OAuth2 access token (auto-refreshed via refresh token)

### Play
```
PUT /me/player/play
{ "uris": ["spotify:track:<id>"] }
```

### Search
```
GET /search?q={query}&type=track,album,artist&limit=5
```

### Current Track
```
GET /me/player/currently-playing
```

## Example Invocations

- "Play 'Back in Black' by AC/DC."
- "Queue the Inception soundtrack."
- "What song is playing right now?"
- "Turn up the volume to 80%."
- "Skip to the next track."
- "Play my 'Focus' playlist."

## What It Does

1. Authenticates via Spotify OAuth (access token auto-refreshed)
2. Searches for the requested content by name
3. Issues playback control commands to the active device
4. Returns confirmation with track/artist info
