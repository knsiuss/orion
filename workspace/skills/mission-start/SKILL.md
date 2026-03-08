---
name: mission-start
description: "Start a new named mission/project: create a mission brief, set goals, and track progress."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🚀"
    invokeKey: mission
---

# Mission Start

## When to Use

Use for:
- Launching a new project with clear goals and success criteria
- Creating a structured mission brief that EDITH tracks over time
- Setting milestones and checkpoints
- Linking a mission to tasks, Linear issues, and memory context

Do NOT use for:
- Casual one-off tasks (just ask EDITH directly)
- Tracking existing projects you haven't formalized

## Mission Brief Format

```markdown
## Mission: <Name>
**Codename:** <optional>  **Started:** YYYY-MM-DD  **Status:** Active

### Objective
<1-sentence goal>

### Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Milestones
| # | Milestone | Due | Status |
|---|-----------|-----|--------|
| 1 | ... | ... | Pending |

### Resources
- Key files: ...
- Related issues: ...

### Notes
...
```

## Invoke

```
/mission <name>
EDITH, start a new mission: "Deploy EDITH to production".
EDITH, launch Mission Blackout — objective: secure the house network.
```

## What It Does

1. Prompts for mission name, objective, and initial milestones
2. Creates a mission brief in `workspace/missions/<name>.md`
3. Registers the mission in memory for proactive check-ins
4. Links any related Linear issues or Notion pages
5. Sets up a recurring status prompt (configurable cadence)
