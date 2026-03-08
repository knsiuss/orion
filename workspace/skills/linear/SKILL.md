---
name: linear
description: "Manage Linear issues and sprints: create, assign, triage, and track engineering work."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "📐"
    requires:
      env:
        - LINEAR_API_KEY
---

# Linear

## When to Use

Use for:
- Creating and triaging Linear issues
- Moving issues through workflow states
- Listing issues in a cycle (sprint) or backlog
- Checking team velocity and cycle progress

Do NOT use for:
- Non-engineering project management (use Notion or Trello)
- Real-time chat (use Slack)

## API Reference

Base URL: `https://api.linear.app/graphql`
Auth: `Authorization: $LINEAR_API_KEY`

### Create Issue (GraphQL)
```graphql
mutation {
  issueCreate(input: {
    title: "Fix auth bug"
    teamId: "<team_id>"
    priority: 1
    stateId: "<todo_state_id>"
  }) {
    issue { id identifier url }
  }
}
```

### List My Issues
```graphql
query {
  viewer {
    assignedIssues { nodes { identifier title state { name } priority } }
  }
}
```

## Example Invocations

- "Create a Linear issue: 'Rate limiter not resetting on restart', P1, Team Backend."
- "What issues are assigned to me right now?"
- "Move issue ENG-42 to In Review."
- "Show me all P0 bugs in the current cycle."

## What It Does

1. Authenticates via Linear API key
2. Resolves team/state names to IDs with a one-time query (cached)
3. Executes GraphQL mutation or query
4. Returns issue identifier, title, URL, and state
