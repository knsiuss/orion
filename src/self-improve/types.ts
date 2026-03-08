/**
 * @file types.ts
 * @description Shared type definitions for the Phase 24 self-improvement system.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Imported by quality-tracker, prompt-versioning, pattern-detector,
 *     gap-detector, skill-creator, and learning-report modules.
 *   - FROZEN_ZONES and MUTABLE_ZONES constrain prompt optimization scope.
 */

/** A single feedback signal captured from a user interaction. */
export interface FeedbackSignal {
  /** Unique identifier for the interaction this signal is attached to. */
  interactionId: string
  /** Unix timestamp when this signal was recorded. */
  timestamp: number
  /** Signal polarity — positive confirms quality; negative/strong_negative flags issues. */
  signal: "positive" | "negative" | "strong_negative"
  /** Human-readable reason for the signal (rephrase request, explicit correction, etc.). */
  reason: string
  /** Topic or skill domain the interaction was about. */
  topic: string
  /** Skill module that was invoked, if any. */
  skillUsed?: string
  /** Prompt version ID active when this interaction occurred. */
  promptVersion: string
}

/** A versioned snapshot of a system-prompt zone for rollback and diffing. */
export interface PromptVersion {
  /** Unique version ID (cuid-style string). */
  id: string
  /** ISO timestamp of when this version was created. */
  timestamp: string
  /** Prompt zone this version applies to (must be in MUTABLE_ZONES). */
  zone: string
  /** Previous content before the optimization. */
  oldContent: string
  /** New content after optimization. */
  newContent: string
  /** Natural-language reason for this change. */
  reason: string
  /** Statistical evidence backing the optimization decision. */
  evidence: {
    /** Number of interactions analyzed. */
    sampleSize: number
    /** Proportion of negative signals in the sample. */
    negativeRate: number
    /** Estimated improvement ratio. */
    improvementEstimate: number
  }
  /** Version ID to restore if rollback is triggered. */
  rollbackTarget?: string
}

/** A recurring message pattern that could become a skill. */
export interface SkillPattern {
  /** Unique pattern identifier. */
  id: string
  /** Human-readable description of the pattern. */
  description: string
  /** Example messages that match this pattern. */
  examples: string[]
  /** Number of times this pattern was observed. */
  occurrenceCount: number
  /** Unix timestamp of first observation. */
  firstSeen: number
  /** Unix timestamp of most recent observation. */
  lastSeen: number
  /** Lifecycle state of this pattern. */
  status: "candidate" | "approved" | "rejected" | "archived"
}

/** A topic gap — something EDITH couldn't answer satisfactorily. */
export interface KnowledgeGap {
  /** Topic that triggered the gap. */
  topic: string
  /** Number of times EDITH failed on this topic. */
  count: number
  /** Example questions that exposed this gap. */
  examples: string[]
  /** Recommended action to close this gap. */
  suggestedAction: string
}

/** A compiled weekly learning and improvement report. */
export interface LearningReport {
  /** ISO date string for the week this report covers (Monday's date). */
  weekOf: string
  /** Total interactions processed in the period. */
  totalInteractions: number
  /** Ratio of positive interactions. */
  positiveRate: number
  /** Ratio of negative interactions. */
  negativeRate: number
  /** Prompt improvements applied during this period. */
  improvements: string[]
  /** New skills auto-generated or approved during this period. */
  newSkills: string[]
  /** Knowledge gaps resolved or closed. */
  gapsClosed: string[]
  /** Top improvement opportunities identified. */
  topOpportunities: string[]
}

/**
 * Prompt zones that are immutable — the optimizer will never touch these.
 * Protects core identity, safety rails, and user permissions.
 */
export const FROZEN_ZONES = ["identity", "safety", "permissions", "user_preferences"] as const

/**
 * Prompt zones that the optimizer is allowed to mutate.
 * Lower-risk stylistic and routing zones only.
 */
export const MUTABLE_ZONES = [
  "response_style",
  "tool_selection",
  "context_weighting",
  "proactive_phrasing",
] as const

/** Union type of all frozen zone names. */
export type FrozenZone = (typeof FROZEN_ZONES)[number]

/** Union type of all mutable zone names. */
export type MutableZone = (typeof MUTABLE_ZONES)[number]
