---
name: coding-agent
description: "AI-powered coding assistant: write, refactor, explain, and review code across any language."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "👨‍💻"
---

# Coding Agent

## When to Use

Use for:
- Writing new functions, classes, or modules
- Refactoring existing code for readability or performance
- Explaining what a code snippet does
- Converting code between languages
- Generating boilerplate (tests, config files, schemas)

Do NOT use for:
- Deploying code (use terminal-bridge with confirmation)
- Running tests (use test-runner skill)
- Reviewing diffs (use diff-reviewer skill)

## Approach

EDITH operates as a senior engineer: writes production-quality code, not toy examples.

### Principles
- Prefer simple, explicit code over clever abstractions
- Add JSDoc/docstrings to all public APIs
- Handle errors explicitly — no silent failures
- Write TypeScript with strict types; no `any`
- Match the project's existing code style

## Example Invocations

- "Write a TypeScript function that debounces async calls."
- "Refactor this class to use dependency injection."
- "Explain what this regex does: `^(?=.*[A-Z])(?=.*\d).{8,}$`"
- "Convert this Python script to TypeScript."
- "Generate a Zod schema for this JSON response."

## What It Does

1. Analyzes the request and relevant context files
2. Writes clean, typed, documented code
3. Explains the approach and any tradeoffs
4. Suggests tests for the generated code
5. Offers to wire the code into the existing codebase
