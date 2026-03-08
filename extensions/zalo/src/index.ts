/**
 * @file index.ts
 * @description Zalo integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Zalo OA (Official Account) messaging channel for Vietnamese users.
 *   Requires Zalo OA credentials and webhook configuration.
 */
import type { Hook } from "../../../src/hooks/registry.js"

export const name = "zalo"
export const version = "0.1.0"
export const description = "Zalo OA messaging channel"

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  // No-op until Zalo OA credentials configured
}
