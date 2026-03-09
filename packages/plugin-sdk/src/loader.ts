/**
 * @file loader.ts
 * @description Plugin loader types and manifest for the EDITH Plugin SDK.
 *
 * ARCHITECTURE:
 *   External extensions use these types to implement their plugin contract.
 *   The runtime loader lives in src/plugin-sdk/loader.ts (internal).
 */

import type { BaseHook, ExtensionManifest } from "./types.js"

export interface PluginLoadResult {
  name: string
  version: string
  hookCount: number
  loadedAt: Date
}

export interface PluginManifestV2 extends ExtensionManifest {
  requiredEnvVars?: string[]
  /** Minimum EDITH version required */
  minEdithVersion?: string
}

export interface EDITHPluginV2 {
  readonly name: string
  readonly version: string
  readonly manifest?: PluginManifestV2
  hooks?: BaseHook[]
  onLoad?: () => Promise<void>
  onUnload?: () => Promise<void>
}
