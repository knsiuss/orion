---
name: gitlab
description: "Manage GitLab projects: view pipelines, create issues, review MRs, and check CI/CD status."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🦊"
    requires:
      env:
        - GITLAB_TOKEN
        - GITLAB_URL
---

# GitLab

## When to Use

Use for:
- Checking CI/CD pipeline status
- Creating or reviewing merge requests (MRs)
- Managing GitLab issues and milestones
- Triggering manual pipeline jobs

Do NOT use for:
- GitHub repositories (use github-prs / github-issues skills)
- Deploying to production (use terminal-bridge with explicit confirmation)

## API Reference

Base URL: `$GITLAB_URL/api/v4` (default: `https://gitlab.com/api/v4`)
Auth: `PRIVATE-TOKEN: $GITLAB_TOKEN`

### Get Pipeline Status
```
GET /projects/{id}/pipelines?ref=main&per_page=5
```

### List Open MRs
```
GET /projects/{id}/merge_requests?state=opened
```

### Create Issue
```
POST /projects/{id}/issues
{ "title": "Fix deploy timeout", "labels": "bug,P1", "milestone_id": 3 }
```

## Example Invocations

- "What's the status of the latest pipeline on the main branch?"
- "Show me all open MRs on the backend project."
- "Create a GitLab issue: 'Upgrade Node.js to v22' in the infra project."
- "Retry the failed job 'integration-tests' in pipeline #456."

## What It Does

1. Resolves project ID from name or namespace
2. Calls GitLab REST API
3. Returns formatted status, MR list, or issue URL
4. Surfaces pipeline failures with direct links to failed jobs
