---
name: obsidian
description: "Read, create, and link notes in an Obsidian vault via the Local REST API plugin."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🪨"
    requires:
      env:
        - OBSIDIAN_API_URL
        - OBSIDIAN_API_KEY
---

# Obsidian

## When to Use

Use for:
- Creating new markdown notes in the vault
- Reading or searching existing notes
- Appending content to a note
- Creating wiki-links between notes

Do NOT use for:
- Vaults not running the Obsidian Local REST API plugin
- Binary attachments (images, PDFs)
- Live sync conflicts (resolve manually in Obsidian)

## Setup

Requires the **Obsidian Local REST API** community plugin.
Default URL: `http://localhost:27123`
Set `OBSIDIAN_API_URL` and `OBSIDIAN_API_KEY` in `.env`.

## API Reference

### Create/Update Note
```
PUT /vault/{path/to/note.md}
Content-Type: text/markdown
Body: note content
```

### Read Note
```
GET /vault/{path/to/note.md}
```

### Search
```
POST /search/simple/?query=keyword
```

## Example Invocations

- "Create an Obsidian note titled 'Phase 33 Plan' in my Projects folder."
- "Search my vault for notes about 'machine learning'."
- "Append this summary to my Daily Note for today."
- "Link the 'EDITH Architecture' note to 'Phase 10 Personalization'."

## What It Does

1. Connects to the local Obsidian REST API
2. Creates, reads, or searches notes as requested
3. Formats content in clean Markdown with YAML frontmatter
4. Returns confirmation with vault path or search results
