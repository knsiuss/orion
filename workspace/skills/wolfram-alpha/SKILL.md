---
name: wolfram-alpha
description: "Compute mathematical, scientific, and factual answers via Wolfram Alpha."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🧮"
    requires:
      env:
        - WOLFRAM_APP_ID
---

# Wolfram Alpha

## When to Use

Use for:
- Mathematical computations (calculus, algebra, statistics)
- Physics, chemistry, and engineering formulas
- Unit conversions and dimensional analysis
- Factual lookups (population, GDP, distances, chemical properties)
- Date and time calculations

Do NOT use for:
- General web search (use web-search skill)
- Simple arithmetic (EDITH can do that natively)
- Creative or subjective questions

## API Reference

Base URL: `https://api.wolframalpha.com/v2/query`
Params: `input={query}&appid=$WOLFRAM_APP_ID&output=JSON&format=plaintext`

## Example Invocations

- "What is the integral of x² sin(x)?"
- "How far is Jupiter from Earth right now?"
- "Convert 150 lbs to kilograms."
- "What is the boiling point of ethanol at 0.5 atm?"
- "How many seconds until January 1, 2027?"

## What It Does

1. Sends the natural language query to Wolfram Alpha
2. Extracts the primary result pod and supporting data
3. Returns the computed answer in a readable format
4. Includes step-by-step solution for math problems when available
