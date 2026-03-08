/**
 * @file specializations.ts
 * @description Predefined configurations for each Legion instance role.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - legion-orchestrator.ts reads these to configure delegated instances.
 *   - task-router.ts uses role classification to select the right specialization.
 */

import type { InstanceRole, InstanceSpecialization } from "./types.js"

/**
 * Predefined specialization configurations for each instance role.
 * Each role has optimized engine, tools, and prompt overrides.
 */
export const SPECIALIZATIONS: Record<InstanceRole, InstanceSpecialization> = {
  primary: {
    name: "Primary EDITH",
    role: "primary",
    engine: {
      provider: "anthropic",
      model: "claude-opus-4-5",
      temperature: 0.7,
      maxTokens: 4096,
    },
    tools: ["*"],
    systemPromptOverrides: [],
    resourceLimits: { maxConcurrentTasks: 10, dailyTokenBudget: 500_000 },
  },

  research: {
    name: "Research Assistant",
    role: "research",
    engine: {
      provider: "anthropic",
      model: "claude-opus-4-5",
      temperature: 0.3,
      maxTokens: 8192,
    },
    tools: ["web_search", "knowledge_base", "read_file", "search", "query"],
    systemPromptOverrides: [
      "You are a research specialist. Be thorough, cite sources, and prefer depth over brevity.",
      "When researching, always verify claims across multiple sources before presenting.",
    ],
    resourceLimits: { maxConcurrentTasks: 3, dailyTokenBudget: 200_000 },
  },

  code: {
    name: "Code Engineer",
    role: "code",
    engine: {
      provider: "groq",
      model: "llama-3.1-70b-versatile",
      temperature: 0.1,
      maxTokens: 4096,
    },
    tools: ["read_file", "write_file", "edit_file", "search", "git", "run_tests"],
    systemPromptOverrides: [
      "You are a senior software engineer. Be concise, write clean code, and prefer solutions that are testable.",
      "Always consider edge cases and follow existing code style conventions.",
    ],
    resourceLimits: { maxConcurrentTasks: 5, dailyTokenBudget: 150_000 },
  },

  communication: {
    name: "Communication Manager",
    role: "communication",
    engine: {
      provider: "groq",
      model: "llama-3.1-8b-instant",
      temperature: 0.5,
      maxTokens: 2048,
    },
    tools: ["send_email", "read_email", "calendar", "send_message", "schedule_meeting"],
    systemPromptOverrides: [
      "You are a professional communication coordinator. Be concise, polite, and action-oriented.",
      "Always confirm recipient details before sending any communication.",
    ],
    resourceLimits: { maxConcurrentTasks: 5, dailyTokenBudget: 50_000 },
  },

  general: {
    name: "General Assistant",
    role: "general",
    engine: {
      provider: "groq",
      model: "llama-3.1-70b-versatile",
      temperature: 0.7,
      maxTokens: 4096,
    },
    tools: ["read_file", "search", "query", "web_search"],
    systemPromptOverrides: [],
    resourceLimits: { maxConcurrentTasks: 5, dailyTokenBudget: 100_000 },
  },
}

/**
 * Retrieve the specialization configuration for a given instance role.
 *
 * @param role - Instance role to look up.
 * @returns InstanceSpecialization configuration for the role.
 */
export function getSpecialization(role: InstanceRole): InstanceSpecialization {
  return SPECIALIZATIONS[role]
}
