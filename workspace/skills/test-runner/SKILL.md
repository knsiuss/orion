---
name: test-runner
description: "Run tests, analyze failures, and suggest fixes for failing test suites."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🧪"
    requires:
      bins:
        - pnpm
---

# Test Runner

## When to Use

Use for:
- Running the full test suite or a targeted subset
- Analyzing test failures and suggesting fixes
- Checking type errors alongside test results
- Generating test coverage reports

Do NOT use for:
- Running arbitrary shell commands (use terminal-bridge)
- End-to-end browser tests (use playwright tools directly)

## Commands

| Action | Command |
|--------|---------|
| Run all tests | `pnpm test` |
| Run specific file | `pnpm vitest run src/memory/__tests__/` |
| Run with coverage | `pnpm vitest run --coverage` |
| TypeScript check | `pnpm typecheck` |
| Watch mode | `pnpm vitest` |

## Failure Analysis Protocol

When tests fail, EDITH:
1. Identifies the failing test name and assertion
2. Reads the relevant source and test files
3. Diagnoses whether it is a test issue or source issue
4. Proposes a targeted fix
5. Re-runs the specific test to confirm

## Example Invocations

- "Run the tests and tell me what's failing."
- "Run only the memory module tests."
- "This test is failing — here's the output. What's wrong?"
- "Check TypeScript errors before I commit."
- "Generate a coverage report for the channels module."

## What It Does

1. Executes the test command via terminal
2. Parses the output (Vitest JSON reporter preferred)
3. Summarizes pass/fail counts and lists failures
4. For each failure: shows the test name, expected vs actual, and proposes a fix
