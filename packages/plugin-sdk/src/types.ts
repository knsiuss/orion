/**
 * @file types.ts
 * @description EDITH Plugin SDK — base types for building extensions and plugins.
 *
 * ARCHITECTURE:
 *   Extensions implement BaseChannelExtension or BaseToolExtension.
 *   Each extension has an ExtensionManifest for discovery by the loader.
 *   Hooks use BaseHook/HookContext for pre/post message interception.
 */

export interface ExtensionManifest {
  name: string
  version: string
  description: string
  type: 'channel' | 'tool' | 'skill' | 'hook' | 'composite'
  enabled?: boolean
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

export interface HookContext {
  userId: string
  channel: string
  content: string
  metadata: Record<string, unknown>
  abort?: boolean
  abortReason?: string
}

export interface BaseHook {
  name: string
  type: 'pre_message' | 'post_message' | 'pre_tool' | 'post_tool' | 'pre_send' | 'post_send'
  priority: number
  handler: (context: HookContext) => Promise<HookContext>
}
