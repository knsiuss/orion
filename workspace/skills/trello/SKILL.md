---
name: trello
description: "Manage Trello boards: create cards, move between lists, and check board status."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📋"
    requires:
      env:
        - TRELLO_API_KEY
        - TRELLO_API_TOKEN
---

# Trello

## When to Use

Use for:
- Creating cards on a Trello board
- Moving cards between lists (e.g., To Do → In Progress → Done)
- Listing cards in a specific list
- Assigning due dates and labels to cards

Do NOT use for:
- Sprint planning with story points (use Jira or Linear instead)
- Detailed issue tracking with comments threads

## API Reference

Base URL: `https://api.trello.com/1`
Query params: `key=$TRELLO_API_KEY&token=$TRELLO_API_TOKEN`

### Create Card
```
POST /cards
{ "idList": "<list_id>", "name": "Card title", "due": "2026-03-15" }
```

### Move Card
```
PUT /cards/{card_id}
{ "idList": "<target_list_id>" }
```

### Get Cards in List
```
GET /lists/{list_id}/cards
```

## Example Invocations

- "Create a Trello card 'Review deploy checklist' in the Backlog list."
- "Move 'Write API docs' to Done."
- "What's currently in the In Progress list?"
- "Add a due date of Friday to the 'Security audit' card."

## What It Does

1. Resolves board and list names to IDs from user config or cache
2. Executes the appropriate Trello API call
3. Returns card URL and confirmation
4. Caches board/list IDs to avoid repeated lookups
