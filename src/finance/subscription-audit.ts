/**
 * @file subscription-audit.ts
 * @description Audit and track recurring subscriptions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   In-memory subscription ledger with monthly cost calculation.
 *   Provides upcoming billing alerts and annual cost overview.
 */
import { createLogger } from '../logger.js'

const log = createLogger('finance.subscriptions')

/** A recurring subscription entry. */
export interface Subscription {
  id: string
  name: string
  amount: number
  currency: string
  billingCycle: 'monthly' | 'yearly' | 'weekly'
  nextBillingDate: Date
  category: string
  active: boolean
}

class SubscriptionAudit {
  private subscriptions = new Map<string, Subscription>()

  /**
   * Add a subscription to track.
   * @param sub - Subscription details
   */
  add(sub: Subscription): void {
    this.subscriptions.set(sub.id, sub)
    log.debug('subscription added', { name: sub.name, amount: sub.amount })
  }

  /**
   * Calculate total monthly cost across all active subscriptions.
   * Yearly subscriptions are divided by 12; weekly multiplied by 4.33.
   * @returns Total monthly cost in subscription currencies
   */
  getMonthlyTotal(): number {
    let total = 0
    for (const sub of this.subscriptions.values()) {
      if (!sub.active) continue
      if (sub.billingCycle === 'monthly') total += sub.amount
      else if (sub.billingCycle === 'yearly') total += sub.amount / 12
      else if (sub.billingCycle === 'weekly') total += sub.amount * 4.33
    }
    return total
  }

  /**
   * Get subscriptions with billing dates in the current month.
   * @returns Active subscriptions due this calendar month
   */
  getDueThisMonth(): Subscription[] {
    const now = new Date()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return [...this.subscriptions.values()].filter(
      s => s.active && s.nextBillingDate >= now && s.nextBillingDate <= endOfMonth,
    )
  }

  /**
   * List all currently active subscriptions.
   * @returns Array of active subscriptions
   */
  listActive(): Subscription[] {
    return [...this.subscriptions.values()].filter(s => s.active)
  }
}

/** Singleton subscription audit tracker. */
export const subscriptionAudit = new SubscriptionAudit()
