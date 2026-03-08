---
name: github-issues
description: "Manage GitHub issues: create, label, assign, close, and search across repos."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🐛"
    requires:
      env:
        - GITHUB_TOKEN
      bins:
        - gh
---

# GitHub Issues

## When to Use

Use for:
- Creating bug reports or feature requests
- Searching issues by keyword, label, or assignee
- Closing or labeling issues
- Linking issues to pull requests

Do NOT use for:
- Sprint planning (use Linear or Jira)
- Large-scale issue triage across many repos simultaneously

## How It Works

Uses the `gh` CLI for most operations.

### Create Issue
```bash
gh issue create --repo owner/repo \
  --title "Bug: auth fails on timeout" \
  --body "Steps to reproduce..." \
  --label "bug,P1"
```

### Search Issues
```bash
gh issue list --repo owner/repo --label "bug" --state open
```

### Close Issue
```bash
gh issue close <number> --repo owner/repo
```

## Example Invocations

- "File a GitHub issue: 'Rate limiter not resetting on restart'. Repo: EDITH."
- "Show all open P1 bugs on the EDITH repo."
- "Close issue #33 with comment 'Fixed in PR #44'."
- "Assign issue #12 to me."

## What It Does

1. Resolves repo from user context or explicit mention
2. Executes `gh` CLI command
3. Returns issue number and URL
4. Logs new issues to episodic memory for follow-up
