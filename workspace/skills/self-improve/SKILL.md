---
name: self-improve
description: "Trigger EDITH's self-improvement cycle: analyze quality signals, optimize prompts, and generate a learning report."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔄"
    invokeKey: self-improve
---

# Self-Improve

## When to Use

Use for:
- Manually triggering the weekly learning cycle
- Generating a report of what EDITH has learned recently
- Reviewing candidate skill patterns before they are saved
- Rolling back a prompt optimization that regressed quality

Do NOT use for:
- General feedback (use the barge-in or edit signal naturally — EDITH detects it)
- Modifying frozen prompt zones (SOUL.md, security layers)

## How It Works

The self-improvement cycle (Phase 24) involves:
1. **QualityTracker**: Reviews accumulated feedback signals (barge-ins, rephrases, edits)
2. **GapDetector**: Identifies topics where EDITH frequently struggles
3. **PromptOptimizer**: Proposes optimizations to mutable prompt zones
4. **PatternDetector**: Identifies recurring user workflows → candidate skills
5. **SkillCreator**: Drafts new auto-skills from detected patterns
6. **LearningReport**: Generates a Markdown summary of all changes

## Invoke

```
/self-improve
EDITH, run your self-improvement cycle.
EDITH, generate a learning report.
```

## What It Does

1. Calls `selfImproveOrchestrator.run()` via the message pipeline
2. Streams progress updates (QualityTracker → GapDetector → PromptOptimizer → Report)
3. Presents the learning report in Markdown
4. Lists any pending prompt changes for user approval before applying
5. Lists candidate new skills for user review

## Safety

- Only mutable prompt zones can be modified (SOUL.md and security layers are frozen)
- All prompt changes are versioned and can be rolled back
- User must confirm before any prompt is written to disk
