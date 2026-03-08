/**
 * @file index.ts
 * @description Notion integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Syncs Notion databases/pages with EDITH's knowledge base.
 *   Provides tools for querying, creating, and updating Notion pages.
 *   Requires NOTION_API_KEY.
 */
import type { Hook } from "../../../src/hooks/registry.js"

export const name = "notion"
export const version = "0.1.0"
export const description = "Notion workspace integration"

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  // No-op until NOTION_API_KEY configured
}
