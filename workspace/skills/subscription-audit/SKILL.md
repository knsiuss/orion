---
name: subscription-audit
description: "Audit recurring subscriptions: list active services, costs, renewal dates, and identify unused ones."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔄"
    invokeKey: subs
---

# Subscription Audit

## When to Use

Use for:
- Getting a clear picture of all active subscriptions
- Finding subscriptions you may have forgotten about
- Calculating total monthly recurring cost
- Flagging subscriptions to cancel

Do NOT use for:
- Automatically canceling subscriptions (manual action required)
- Real-time bank statement parsing (manual entry only)

## Data Model

Each subscription entry:
```
Name: <service>
Category: <software/streaming/cloud/other>
Cost: <amount> <currency> / <billing cycle>
Next Renewal: <date>
Usage: <active/unused/unsure>
Notes: <any context>
```

Stored in `memory/subscriptions.md` and vector memory.

## Example Invocations

- "Show me all my active subscriptions."
- "Add a subscription: GitHub Copilot, $10/month, renews March 15."
- "What am I paying for monthly in total?"
- "Which subscriptions haven't I used in the last month?"
- "Flag Netflix and Adobe as candidates for cancellation."

## What It Does

1. Lists all tracked subscriptions from memory
2. Calculates total monthly and annual cost
3. Groups by category and flags unused ones
4. Highlights upcoming renewals in the next 30 days
5. Suggests cost-saving actions (e.g., annual billing, bundle alternatives)
