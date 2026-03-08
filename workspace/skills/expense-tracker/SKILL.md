---
name: expense-tracker
description: "Log and categorize expenses, track spending against budget, and generate reports."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "💸"
---

# Expense Tracker

## When to Use

Use for:
- Logging a new expense quickly by voice or text
- Viewing spending by category this month
- Checking if you're within budget for a category
- Generating a monthly expense summary

Do NOT use for:
- Bank account integration (no direct banking APIs — manual entry only)
- Tax preparation (use an accountant or dedicated software)

## Expense Categories

Default categories (customizable):
- Housing, Food & Dining, Transport, Entertainment, Health, Shopping, Tech, Subscriptions, Travel, Other

## Data Storage

Expenses stored in Prisma DB (or appended to `memory/expenses.md` if DB unavailable):
```
{ userId, amount, currency, category, description, date, tags }
```

## Example Invocations

- "Log $24.50 for lunch at the noodle place."
- "I spent 350,000 IDR on transport this week."
- "How much have I spent on food this month?"
- "Show me my expense summary for February."
- "Am I over budget on entertainment this month?"

## What It Does

1. Parses amount, currency, category, and description from natural language
2. Stores the expense with timestamp
3. Computes running totals by category for the current period
4. Generates formatted reports (daily, weekly, monthly)
5. Alerts when a budget threshold is approached (if budgets are configured)
