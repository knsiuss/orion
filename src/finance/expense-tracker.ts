/**
 * @file expense-tracker.ts
 * @description Track and categorize expenses — JARVIS financial awareness.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Persists to Prisma ExpenseRecord model.
 *   Provides monthly summaries and totals by category.
 *   Used by morning briefing for financial context.
 */
import { createLogger } from '../logger.js'
import { prisma } from '../database/index.js'

const log = createLogger('finance.expense-tracker')

/** Input for recording an expense. */
export interface Expense {
  amount: number
  currency: string
  category: string
  description: string
  date: Date
  source?: string
}

class ExpenseTracker {
  /**
   * Record a new expense to the database.
   * @param userId - Owner of the expense
   * @param expense - Expense details
   */
  async record(userId: string, expense: Expense): Promise<void> {
    await prisma.expenseRecord.create({
      data: {
        userId,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        description: expense.description,
        date: expense.date,
        source: expense.source ?? 'manual',
      },
    })
    log.debug('expense recorded', { userId, amount: expense.amount, category: expense.category })
  }

  /**
   * Get monthly spending summary by category.
   * @param userId - User to query
   * @returns Map of category → total amount for the current month
   */
  async getMonthlySummary(userId: string): Promise<Record<string, number>> {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const records = await prisma.expenseRecord.findMany({
      where: { userId, date: { gte: startOfMonth } },
    })

    return records.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + r.amount
      return acc
    }, {})
  }

  /**
   * Get total spending for the current month.
   * @param userId - User to query
   * @returns Total spending amount in the user's primary currency
   */
  async getMonthlyTotal(userId: string): Promise<number> {
    const summary = await this.getMonthlySummary(userId)
    return Object.values(summary).reduce((sum, v) => sum + v, 0)
  }
}

/** Singleton expense tracker. */
export const expenseTracker = new ExpenseTracker()
