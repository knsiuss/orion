---
name: github-prs
description: "Review GitHub pull requests: list open PRs, summarize diffs, and post review comments."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔀"
    requires:
      env:
        - GITHUB_TOKEN
      bins:
        - gh
---

# GitHub PRs

## When to Use

Use for:
- Listing open pull requests on a repo
- Summarizing what a PR changes (without reading every line)
- Posting a review comment or approving a PR
- Checking CI status on a PR

Do NOT use for:
- Merging PRs without explicit user confirmation
- Creating PRs (use diff-reviewer skill for that flow)

## How It Works

Uses the `gh` CLI (preferred) or GitHub REST API.

### List Open PRs
```bash
gh pr list --repo owner/repo --state open
```

### View PR Diff Summary
```bash
gh pr diff <number> --repo owner/repo | head -200
```

### Post Review Comment
```bash
gh api repos/owner/repo/pulls/<number>/reviews \
  -f body="LGTM" -f event="APPROVE"
```

## Example Invocations

- "Show me all open PRs on the EDITH repo."
- "Summarize PR #42."
- "Approve PR #17 with comment 'LGTM, good refactor'."
- "What's the CI status on PR #55?"

## What It Does

1. Identifies the repo from context or user input
2. Fetches PR list or diff via `gh` CLI
3. Summarizes changes by file and impact
4. Posts review comments or approval on request (with confirmation)
5. Flags PRs with failing CI or merge conflicts
