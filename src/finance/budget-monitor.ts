/**
 * @file budget-monitor.ts
 * @description Tracks spending against budget limits and alerts on overruns.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Reads from ExpenseRecord in Prisma. Used by ambient/ambient-scheduler.ts
 *   to trigger proactive budget warnings.
 */
import { createLogger } from "../logger.js"

const log = createLogger("finance.budget-monitor")

export interface Budget {
  category: string
  monthlyLimit: number
  currency: string
}

class BudgetMonitor {
  private budgets = new Map<string, Budget[]>()

  setBudget(userId: string, category: string, monthlyLimit: number, currency = "IDR"): void {
    const userBudgets = this.budgets.get(userId) ?? []
    const existing = userBudgets.find(b => b.category === category)
    if (existing) {
      existing.monthlyLimit = monthlyLimit
    } else {
      userBudgets.push({ category, monthlyLimit, currency })
    }
    this.budgets.set(userId, userBudgets)
    log.info("budget set", { userId, category, monthlyLimit })
  }

  getBudgets(userId: string): Budget[] {
    return this.budgets.get(userId) ?? []
  }

  async checkOverruns(userId: string, _currentSpending: Map<string, number>): Promise<string[]> {
    const warnings: string[] = []
    const budgets = this.getBudgets(userId)

    for (const budget of budgets) {
      const spent = _currentSpending.get(budget.category) ?? 0
      if (spent > budget.monthlyLimit) {
        warnings.push(`Over budget in ${budget.category}: spent ${spent} / ${budget.monthlyLimit} ${budget.currency}`)
      } else if (spent > budget.monthlyLimit * 0.8) {
        warnings.push(`Nearing budget limit in ${budget.category}: spent ${spent} / ${budget.monthlyLimit} ${budget.currency}`)
      }
    }

    return warnings
  }
}

export const budgetMonitor = new BudgetMonitor()
