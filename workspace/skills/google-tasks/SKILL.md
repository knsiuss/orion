---
name: google-tasks
description: "Manage Google Tasks: add, complete, and list tasks via the Google Tasks API."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "☑️"
    requires:
      env:
        - GOOGLE_TASKS_ACCESS_TOKEN
---

# Google Tasks

## When to Use

Use for:
- Adding tasks with optional due dates
- Listing tasks across task lists
- Completing or deleting tasks
- Syncing with Google Calendar due dates

Do NOT use for:
- Complex project management (use Linear or Jira)
- Rich task descriptions with attachments (use Notion)

## API Reference

Base URL: `https://tasks.googleapis.com/tasks/v1`
Auth: OAuth2 Bearer token (`GOOGLE_TASKS_ACCESS_TOKEN`)

### List Task Lists
```
GET /users/@me/lists
```

### Insert Task
```
POST /lists/{tasklist_id}/tasks
{ "title": "Review PR", "due": "2026-03-10T00:00:00.000Z" }
```

### Complete Task
```
PATCH /lists/{tasklist_id}/tasks/{task_id}
{ "status": "completed" }
```

## Example Invocations

- "Add a task: 'Deploy hotfix' due tomorrow."
- "Show my tasks for this week."
- "Mark 'Write tests' as complete."
- "What's on my default task list?"

## What It Does

1. Resolves the target task list (default or named)
2. Calls Google Tasks API with the appropriate method
3. Returns a formatted task list or completion confirmation
4. Syncs due dates with Google Calendar when applicable
