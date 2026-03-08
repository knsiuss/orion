---
name: terminal-bridge
description: "Execute terminal commands with explanation, safety checks, and output analysis."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "💻"
---

# Terminal Bridge

## When to Use

Use for:
- Running shell commands that require explanation
- Executing build, deploy, or maintenance scripts
- Piping command output into EDITH for analysis
- Chaining commands with error handling

Do NOT use for:
- Running tests (use test-runner skill)
- Managing Git repos (use github-prs / github-issues skills)
- Destructive operations without explicit confirmation

## Safety Protocol

Before executing any command, EDITH:
1. Explains what the command will do in plain language
2. Flags destructive operations (rm, format, drop, --force) for explicit confirmation
3. Never executes commands that could exfiltrate data or modify system files without approval
4. Logs all executed commands to the session for auditability

### Dangerous Commands (require explicit confirmation)
- `rm -rf`, `rmdir /s`, `format`, `mkfs`
- `DROP TABLE`, `DELETE FROM` without WHERE
- `git push --force`, `git reset --hard`
- Any command piped from user-provided external input

## Example Invocations

- "Run `pnpm build` and tell me if there are errors."
- "What does this command do: `find . -name '*.log' -mtime +7 -delete`?"
- "Run the deploy script and monitor the output."
- "Show me disk usage on the project directory."

## What It Does

1. Parses the command and explains it before running
2. Confirms destructive operations with the user
3. Executes via the OS agent shell tool
4. Streams output and summarizes results
5. Suggests follow-up commands if the output indicates issues
