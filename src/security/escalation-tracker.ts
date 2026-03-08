/**
 * @file escalation-tracker.ts
 * @description Multi-turn risk scoring for user interactions. Tracks escalation
 *   signals across conversation turns and auto-blocks/unblocks users based on
 *   cumulative risk score with time-based decay.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - message-pipeline.ts Stage 1 calls check() before processing and record() after.
 *   - Auto-blocks users whose score exceeds the threshold.
 *   - Scores decay over time so transient spikes don't permanently block users.
 *
 * SIGNAL TYPES:
 *   - injection: prompt injection attempt detected
 *   - jailbreak: jailbreak pattern detected
 *   - abuse: abusive language or harassment
 *   - rate: rate limit exceeded
 *   - suspicious: other suspicious behavior
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.escalation-tracker")

/** Signal types that contribute to escalation score. */
export type EscalationSignalType =
  | "injection"
  | "jailbreak"
  | "abuse"
  | "rate"
  | "suspicious"

/** Weights for each signal type. */
const SIGNAL_WEIGHTS: Record<EscalationSignalType, number> = {
  injection: 3,
  jailbreak: 5,
  abuse: 2,
  rate: 1,
  suspicious: 1,
}

/** Score threshold above which a user is auto-blocked. */
const BLOCK_THRESHOLD = 10

/** Score threshold below which a blocked user is auto-unblocked. */
const UNBLOCK_THRESHOLD = 3

/** Decay rate: points removed per decay interval. */
const DECAY_POINTS = 1

/** Decay interval in milliseconds (5 minutes). */
const DECAY_INTERVAL_MS = 5 * 60 * 1000

/** Per-user escalation state. */
interface UserEscalationState {
  score: number
  blocked: boolean
  lastSignalAt: number
  lastDecayAt: number
  signals: Array<{ type: EscalationSignalType; at: number }>
}

/** Result of an escalation check. */
export interface EscalationCheckResult {
  allowed: boolean
  score: number
  blocked: boolean
}

/**
 * Tracks multi-turn escalation risk per user. Accumulates weighted signals,
 * applies time-based decay, and auto-blocks/unblocks users.
 */
export class EscalationTracker {
  private users = new Map<string, UserEscalationState>()

  /**
   * Check whether a user is allowed to proceed.
   * Applies decay before checking.
   * @param userId - User identifier
   * @returns Check result with current score and block status
   */
  check(userId: string): EscalationCheckResult {
    const state = this.getOrCreate(userId)
    this.applyDecay(state)

    return {
      allowed: !state.blocked,
      score: state.score,
      blocked: state.blocked,
    }
  }

  /**
   * Record an escalation signal for a user.
   * @param userId - User identifier
   * @param signalType - Type of escalation signal
   */
  record(userId: string, signalType: EscalationSignalType): void {
    const state = this.getOrCreate(userId)
    this.applyDecay(state)

    const weight = SIGNAL_WEIGHTS[signalType]
    state.score += weight
    state.lastSignalAt = Date.now()
    state.signals.push({ type: signalType, at: Date.now() })

    // Trim old signals (keep last 50)
    if (state.signals.length > 50) {
      state.signals = state.signals.slice(-50)
    }

    // Auto-block check
    if (!state.blocked && state.score >= BLOCK_THRESHOLD) {
      state.blocked = true
      log.warn("user auto-blocked due to escalation", {
        userId,
        score: state.score,
        threshold: BLOCK_THRESHOLD,
      })
    }

    log.debug("escalation signal recorded", {
      userId,
      signalType,
      weight,
      newScore: state.score,
    })
  }

  /**
   * Get the current score for a user.
   * @param userId - User identifier
   * @returns Current escalation score (0 if unknown)
   */
  getScore(userId: string): number {
    const state = this.users.get(userId)
    if (!state) return 0
    this.applyDecay(state)
    return state.score
  }

  /**
   * Check if a user is currently blocked.
   * @param userId - User identifier
   */
  isBlocked(userId: string): boolean {
    const state = this.users.get(userId)
    if (!state) return false
    this.applyDecay(state)
    return state.blocked
  }

  /**
   * Manually unblock a user and reset their score.
   * @param userId - User identifier
   */
  manualUnblock(userId: string): void {
    const state = this.users.get(userId)
    if (state) {
      state.blocked = false
      state.score = 0
      state.signals = []
      log.info("user manually unblocked", { userId })
    }
  }

  private getOrCreate(userId: string): UserEscalationState {
    let state = this.users.get(userId)
    if (!state) {
      state = {
        score: 0,
        blocked: false,
        lastSignalAt: 0,
        lastDecayAt: Date.now(),
        signals: [],
      }
      this.users.set(userId, state)
    }
    return state
  }

  private applyDecay(state: UserEscalationState): void {
    const now = Date.now()
    const elapsed = now - state.lastDecayAt

    if (elapsed < DECAY_INTERVAL_MS) return

    const intervals = Math.floor(elapsed / DECAY_INTERVAL_MS)
    const decayAmount = intervals * DECAY_POINTS
    state.score = Math.max(0, state.score - decayAmount)
    state.lastDecayAt = now

    // Auto-unblock if score dropped below threshold
    if (state.blocked && state.score <= UNBLOCK_THRESHOLD) {
      state.blocked = false
      log.info("user auto-unblocked after score decay", {
        score: state.score,
        threshold: UNBLOCK_THRESHOLD,
      })
    }
  }
}

/** Singleton escalation tracker. */
export const escalationTracker = new EscalationTracker()
