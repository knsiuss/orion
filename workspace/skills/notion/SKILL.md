---
name: notion
description: "Read, create, and update Notion pages and database entries via the Notion API."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📓"
    requires:
      env:
        - NOTION_API_KEY
---

# Notion

## When to Use

Use for:
- Creating a new page or doc in a workspace
- Adding a row to a Notion database
- Reading or summarizing a page's content
- Querying a database with filters

Do NOT use for:
- Large file uploads (Notion API does not support binary uploads)
- Real-time collaboration features
- Replacing dedicated task managers for high-frequency task tracking

## API Reference

Base URL: `https://api.notion.com/v1`
Headers: `Authorization: Bearer $NOTION_API_KEY`, `Notion-Version: 2022-06-28`

### Create a Page
```
POST /pages
{
  "parent": { "database_id": "<id>" },
  "properties": { "Name": { "title": [{ "text": { "content": "My Page" } }] } }
}
```

### Query a Database
```
POST /databases/{database_id}/query
{ "filter": { "property": "Status", "select": { "equals": "In Progress" } } }
```

## Example Invocations

- "Create a Notion page in my Knowledge Base titled 'LLM Notes'."
- "Add a row to my Projects database: name 'EDITH v3', status 'Planning'."
- "Show me all 'In Progress' items in my Tasks database."
- "Summarize the Notion page about Q1 OKRs."

## What It Does

1. Identifies the target (page or database) from user context or saved IDs
2. Constructs the appropriate Notion API payload
3. Executes the request and parses the response
4. Returns a formatted summary or confirmation with a direct Notion URL
