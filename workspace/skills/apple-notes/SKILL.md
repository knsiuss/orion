---
name: apple-notes
description: "Create, read, search, and organize Apple Notes on macOS and iOS."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📝"
    os: [macos, ios]
    requires:
      bins:
        - osascript
---

# Apple Notes

## When to Use

Use for:
- Creating quick notes or capturing thoughts
- Searching existing notes by keyword
- Appending content to an existing note
- Organizing notes into folders

Do NOT use for:
- Windows or Linux (AppleScript only runs on macOS)
- Large structured documents (use Notion or Obsidian instead)
- Tasks or reminders (use Apple Reminders skill)

## How It Works

On macOS, Apple Notes is controlled via AppleScript (`osascript`).
EDITH runs the appropriate script to create, search, or update notes.

### Create a Note
```applescript
tell application "Notes"
  make new note at folder "Notes" with properties {name:"Title", body:"Content"}
end tell
```

### Search Notes
```applescript
tell application "Notes"
  set matchingNotes to every note whose name contains "query"
end tell
```

## Example Invocations

- "EDITH, create a note titled 'Meeting recap' with these bullet points..."
- "Search my notes for anything about the Stark Tower project."
- "Add this to my 'Ideas' note: ..."

## What It Does

1. Parses the user's intent (create / search / append / list folders)
2. Generates and executes the appropriate AppleScript
3. Returns confirmation or search results
4. Saves note title/ID to episodic log for future reference
