---
name: debug-assistant
description: "Diagnose and fix bugs by analyzing error messages, stack traces, and code context."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔬"
---

# Debug Assistant

## When to Use

Use for:
- Analyzing error messages and stack traces
- Identifying root causes of unexpected behavior
- Suggesting fixes with explanation
- Tracing execution flow through code

Do NOT use for:
- Running tests (use test-runner skill)
- Profiling performance (different tooling required)
- Production incident response without human oversight

## Debugging Protocol

EDITH follows a structured approach:

1. **Reproduce**: Identify the exact conditions that trigger the bug
2. **Isolate**: Narrow down to the smallest failing unit
3. **Hypothesize**: List 2-3 likely root causes ranked by probability
4. **Verify**: Confirm hypothesis with evidence from the code/logs
5. **Fix**: Write a minimal, targeted fix
6. **Prevent**: Suggest a test to catch regressions

## What to Provide

For best results, share:
- The error message and full stack trace
- The relevant code snippet (function or class)
- What you expected vs. what happened
- Recent changes that might have caused the issue

## Example Invocations

- "I'm getting 'Cannot read properties of undefined' — here's the stack trace..."
- "This async function is returning undefined even though I'm awaiting it."
- "Why does this Prisma query return an empty array when the DB has data?"
- "My TypeScript types look correct but the runtime crashes here."

## What It Does

1. Parses the error message and stack trace
2. Identifies the likely failing line and function
3. Explains the root cause in plain language
4. Proposes a fix with before/after code
5. Suggests a regression test
