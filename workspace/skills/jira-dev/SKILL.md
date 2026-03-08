---
name: jira-dev
description: "Manage Jira sprints and issues: create, transition, assign, and query via the Jira REST API."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🎯"
    requires:
      env:
        - JIRA_URL
        - JIRA_EMAIL
        - JIRA_API_TOKEN
---

# Jira Dev

## When to Use

Use for:
- Creating Jira issues (bugs, stories, tasks, epics)
- Transitioning issues through a workflow (To Do → In Progress → Done)
- Listing issues in the current sprint
- Searching issues with JQL

Do NOT use for:
- Non-Jira project management (use Linear or Trello)
- Bulk import/export operations

## API Reference

Base URL: `$JIRA_URL/rest/api/3`
Auth: Basic auth (`$JIRA_EMAIL:$JIRA_API_TOKEN` base64)

### Create Issue
```
POST /issue
{
  "fields": {
    "project": { "key": "ENG" },
    "summary": "Fix rate limiter bug",
    "issuetype": { "name": "Bug" },
    "priority": { "name": "High" }
  }
}
```

### Transition Issue
```
POST /issue/{issueKey}/transitions
{ "transition": { "id": "<transition_id>" } }
```

### JQL Search
```
GET /search?jql=assignee=currentUser() AND sprint in openSprints()
```

## Example Invocations

- "Create a Jira bug in ENG project: 'Auth timeout after 30s'."
- "Move ENG-42 to In Progress."
- "What tickets are assigned to me in the current sprint?"
- "Show all P1 issues in ENG that are still open."

## What It Does

1. Resolves project key and transition IDs (cached after first query)
2. Builds and executes the REST API call
3. Returns issue key, summary, status, and URL
4. Supports JQL for advanced searches
