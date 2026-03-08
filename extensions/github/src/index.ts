/**
 * @file index.ts
 * @description GitHub integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered via plugin-sdk loader. Provides tools for listing repos,
 *   issues, and PRs via the GitHub REST API. Requires GITHUB_TOKEN.
 */
import type { Hook } from "../../../src/hooks/registry.js"

export interface GitHubExtensionConfig {
  token: string
}

export const name = "github"
export const version = "0.1.0"
export const description = "GitHub integration — repos, issues, PRs"

export const hooks: Hook[] = [
  {
    name: "github-event-notify",
    type: "post_message",
    priority: 10,
    handler: async (ctx) => ctx, // Placeholder: will notify on GitHub events
  },
]

export async function onLoad(): Promise<void> {
  // No-op until GITHUB_TOKEN is wired
}
