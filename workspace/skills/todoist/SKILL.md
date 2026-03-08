---
name: todoist
description: "Manage Todoist tasks: add, complete, list, and prioritize via the Todoist REST API."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "✅"
    requires:
      env:
        - TODOIST_API_TOKEN
---

# Todoist

## When to Use

Use for:
- Adding tasks with deadlines and priority levels
- Listing tasks in a project or due today
- Completing or rescheduling tasks
- Moving tasks between projects

Do NOT use for:
- Project planning with sub-issues (use Linear or Jira instead)
- Calendar-based scheduling (use calendar-intel skill)

## API Reference

Base URL: `https://api.todoist.com/rest/v2`
Auth header: `Authorization: Bearer $TODOIST_API_TOKEN`

### Add Task
```
POST /tasks
{ "content": "Buy server", "due_string": "tomorrow", "priority": 4 }
```

### Get Active Tasks
```
GET /tasks?project_id=<id>
```

### Close (Complete) Task
```
POST /tasks/{task_id}/close
```

## Example Invocations

- "Add a P1 task: deploy hotfix by Friday."
- "What tasks do I have due today?"
- "Complete the 'Write tests' task."
- "Move 'Review PR #42' to the Dev project."

## What It Does

1. Parses intent (add / list / complete / reschedule / move)
2. Resolves project names to IDs via GET /projects
3. Calls the Todoist REST API
4. Returns formatted task list or confirmation
5. Logs completed tasks to episodic memory
