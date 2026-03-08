/**
 * @file index.ts
 * @description Home Assistant integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Connects to a Home Assistant instance via the REST/WS API.
 *   Provides entity state queries, service calls, and automation triggers.
 */
import type { Hook } from "../../../src/hooks/registry.js"

export const name = "home-assistant"
export const version = "0.1.0"
export const description = "Home Assistant smart home integration"

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  // No-op until HA URL + token configured
}
