---
name: diff-reviewer
description: "Review code diffs for bugs, security issues, style violations, and improvement suggestions."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔍"
---

# Diff Reviewer

## When to Use

Use for:
- Reviewing a `git diff` before committing
- Checking a pull request diff for issues
- Auditing a change for security vulnerabilities
- Getting a second opinion on a refactor

Do NOT use for:
- Reviewing entire codebases (too broad — use grep/search tools instead)
- Auto-merging PRs (always requires human approval)

## Review Checklist

EDITH checks for:

**Correctness**
- Off-by-one errors, null/undefined access, wrong types
- Async/await errors (missing await, unhandled promises)
- Edge cases not handled

**Security**
- SQL injection, XSS, path traversal
- Secrets or credentials accidentally included
- Insufficient input validation

**Performance**
- N+1 queries
- Unnecessary re-computation in hot paths
- Missing indexes for new DB queries

**Style**
- Consistency with existing code patterns
- Missing JSDoc on public APIs
- Dead code or debug logs left in

## Example Invocations

- "Review this diff before I commit it."
- "Check PR #42 diff for security issues."
- "Is there anything wrong with this refactor?"
- "Sanity-check this database migration."

## What It Does

1. Parses the diff (unified diff format or raw code)
2. Runs through the review checklist
3. Returns categorized findings (blocker / warning / suggestion)
4. Provides specific line references and fix recommendations
