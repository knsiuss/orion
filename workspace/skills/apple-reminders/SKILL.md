---
name: apple-reminders
description: "Create, complete, and list Apple Reminders via AppleScript on macOS."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "⏰"
    os: [macos, ios]
    requires:
      bins:
        - osascript
---

# Apple Reminders

## When to Use

Use for:
- Setting a time-based or location-based reminder
- Listing upcoming reminders
- Marking a reminder as complete
- Organizing reminders into lists

Do NOT use for:
- Windows or Linux
- Complex project task management (use Todoist or Linear instead)
- Calendar events (use calendar-intel skill)

## How It Works

Apple Reminders is controlled via AppleScript on macOS.

### Create a Reminder
```applescript
tell application "Reminders"
  set newReminder to make new reminder in list "Reminders" with properties ¬
    {name:"Buy groceries", due date:date "Tuesday, March 10, 2026 at 6:00 PM"}
end tell
```

### List Incomplete Reminders
```applescript
tell application "Reminders"
  set incompleteReminders to every reminder in list "Reminders" whose completed is false
end tell
```

## Example Invocations

- "Remind me to review the deployment at 5 PM today."
- "What reminders do I have for tomorrow?"
- "Mark 'Call vendor' as done."
- "Create a reminder to renew the SSL cert in 30 days."

## What It Does

1. Parses the reminder text, date/time, and list name from user input
2. Resolves relative times ("tomorrow", "in 2 hours") to absolute timestamps
3. Executes AppleScript to create/list/complete reminders
4. Confirms action and echoes the scheduled time back to user
