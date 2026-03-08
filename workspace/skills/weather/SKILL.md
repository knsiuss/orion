---
name: weather
description: "Get current weather conditions and multi-day forecasts for any location."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "⛅"
    requires:
      env:
        - OPENWEATHER_API_KEY
---

# Weather

## When to Use

Use for:
- Current weather conditions at a location
- 3–7 day forecasts
- Hourly weather for today
- Weather alerts or severe conditions

Do NOT use for:
- Historical climate data (use a specialized API)
- Hyper-local agricultural forecasts

## API Reference

Uses OpenWeatherMap API.
Base URL: `https://api.openweathermap.org/data/3.0`

### Current Weather
```
GET /onecall?lat={lat}&lon={lon}&exclude=minutely,hourly,daily,alerts&appid=$OPENWEATHER_API_KEY&units=metric
```

### Geocoding (name → coords)
```
GET http://api.openweathermap.org/geo/1.0/direct?q={city}&limit=1&appid=$OPENWEATHER_API_KEY
```

## Output Format

```
Jakarta, Indonesia — Partly Cloudy
🌡 32°C (feels like 36°C)  💧 78% humidity  🌬 12 km/h NW
Forecast: Thu 31° | Fri 30° | Sat 28° (rain)
```

## Example Invocations

- "What's the weather like in Jakarta right now?"
- "Will it rain in Singapore this weekend?"
- "Give me the weekly forecast for New York."
- "Is there a storm warning anywhere near London?"

## What It Does

1. Geocodes the location to lat/lon if needed
2. Calls OpenWeatherMap One Call API
3. Formats current conditions and forecast concisely
4. Highlights any active weather alerts
