/**
 * @file types.ts
 * @description EDITH internal Plugin SDK types — mirrors packages/plugin-sdk for runtime use.
 *
 * ARCHITECTURE:
 *   Internal consumers import from here. External extensions use packages/plugin-sdk.
 */

import type { Hook } from "../hooks/registry.js"

export interface ExtensionManifest {
  name: string
  version: string
  description: string
  type: "channel" | "tool" | "skill" | "hook" | "composite"
  enabled?: boolean
}

export interface PluginManifestV2 extends ExtensionManifest {
  requiredEnvVars?: string[]
  /** Minimum EDITH version required. */
  minEdithVersion?: string
}

export interface EDITHPlugin {
  name: string
  version: string
  description: string
  hooks?: Hook[]
  tools?: Record<string, unknown>
  onLoad?: () => Promise<void>
  onUnload?: () => Promise<void>
}

export interface EDITHPluginV2 {
  readonly name: string
  readonly version: string
  readonly manifest?: PluginManifestV2
  hooks?: Hook[]
  onLoad?: () => Promise<void>
  onUnload?: () => Promise<void>
}

export interface BaseChannelExtension {
  readonly channelId: string
  initialize(): Promise<void>
  send(userId: string, message: string): Promise<void>
  onMessage(handler: (userId: string, message: string) => Promise<void>): void
}

export interface BaseToolExtension {
  readonly toolId: string
  readonly description: string
  execute(params: Record<string, unknown>): Promise<unknown>
}
