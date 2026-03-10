/**
 * @file internal-hooks.ts
 * @description Type-safe internal hook system with globalThis singleton registry.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Provides cross-module event dispatch for lifecycle events (message, session,
 *   agent, gateway, channel, memory, pipeline). Uses a globalThis singleton so hooks
 *   registered in one module chunk survive bundle splitting.
 *
 *   Supports dual subscription: register for a general type ("message") or a
 *   specific action ("message:received"). Both fire when a matching event triggers.
 *
 *   Called from message-pipeline.ts, channel manager, gateway startup, daemon, etc.
 *
 * PAPER BASIS:
 *   - Pattern adapted from OpenClaw's internal-hooks.ts — globalThis singleton
 *     registry with dual subscription and error-isolated dispatch.
 */

import { createLogger } from "../logger.js"

const log = createLogger("hooks.internal")

// ── Event Type Definitions ──────────────────────────────────────────────

/** Top-level event domains. */
export type InternalHookEventType =
  | "message"
  | "session"
  | "agent"
  | "gateway"
  | "channel"
  | "memory"
  | "pipeline"

/** Common event shape shared by all hook events. */
export interface InternalHookEvent {
  /** Event domain. */
  type: InternalHookEventType
  /** Specific action within the domain. */
  action: string
  /** Session / conversation key. */
  sessionKey: string
  /** Arbitrary event-specific context. */
  context: Record<string, unknown>
  /** When the event was created. */
  timestamp: Date
  /** Hooks may push messages here for the caller to relay to the user. */
  messages: string[]
}

export type InternalHookHandler = (event: InternalHookEvent) => Promise<void> | void

// ── Typed Event Contexts ────────────────────────────────────────────────

/** Context for message:received */
export interface MessageReceivedContext {
  from: string
  content: string
  channelId: string
  conversationId?: string
  messageId?: string
  timestamp?: number
  metadata?: Record<string, unknown>
}

/** Context for message:sent */
export interface MessageSentContext {
  to: string
  content: string
  channelId: string
  success: boolean
  error?: string
  conversationId?: string
  messageId?: string
}

/** Context for message:transcribed */
export interface MessageTranscribedContext {
  from?: string
  channelId: string
  transcript: string
  mediaPath?: string
  mediaType?: string
  conversationId?: string
}

/** Context for session:start */
export interface SessionStartContext {
  userId: string
  channel: string
  resumedFrom?: string
}

/** Context for session:end */
export interface SessionEndContext {
  userId: string
  channel: string
  turnCount: number
  durationMs: number
}

/** Context for agent:bootstrap */
export interface AgentBootstrapContext {
  workspaceDir: string
  agentId?: string
  sessionId?: string
}

/** Context for gateway:startup */
export interface GatewayStartupContext {
  port?: number
  host?: string
  channels?: string[]
}

/** Context for channel:connected / channel:disconnected */
export interface ChannelLifecycleContext {
  channelId: string
  channelType: string
  error?: string
}

/** Context for memory:write */
export interface MemoryWriteContext {
  userId: string
  contentPreview: string
  store: string
}

/** Context for pipeline:error */
export interface PipelineErrorContext {
  userId: string
  stage: string
  error: string
}

// ── Typed Event Shapes ──────────────────────────────────────────────────

export type MessageReceivedEvent = InternalHookEvent & {
  type: "message"
  action: "received"
  context: MessageReceivedContext
}

export type MessageSentEvent = InternalHookEvent & {
  type: "message"
  action: "sent"
  context: MessageSentContext
}

export type MessageTranscribedEvent = InternalHookEvent & {
  type: "message"
  action: "transcribed"
  context: MessageTranscribedContext
}

export type SessionStartEvent = InternalHookEvent & {
  type: "session"
  action: "start"
  context: SessionStartContext
}

export type SessionEndEvent = InternalHookEvent & {
  type: "session"
  action: "end"
  context: SessionEndContext
}

export type AgentBootstrapEvent = InternalHookEvent & {
  type: "agent"
  action: "bootstrap"
  context: AgentBootstrapContext
}

export type GatewayStartupEvent = InternalHookEvent & {
  type: "gateway"
  action: "startup"
  context: GatewayStartupContext
}

// ── globalThis Singleton Registry ───────────────────────────────────────

/**
 * globalThis singleton ensures handlers survive bundle splitting.
 * Without this, hooks registered in one chunk are invisible to
 * triggerInternalHook in another chunk.
 */
const _g = globalThis as typeof globalThis & {
  __edith_internal_hook_handlers__?: Map<string, InternalHookHandler[]>
}
const handlers = (_g.__edith_internal_hook_handlers__ ??= new Map<string, InternalHookHandler[]>())

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Register a hook handler for a general type or specific type:action key.
 *
 * @example
 * ```ts
 * // Listen to ALL message events
 * registerInternalHook("message", async (event) => {
 *   log.info("message event", { action: event.action })
 * })
 *
 * // Listen only to message:received
 * registerInternalHook("message:received", async (event) => {
 *   if (isMessageReceivedEvent(event)) {
 *     await notifyDashboard(event.context.from)
 *   }
 * })
 * ```
 */
export function registerInternalHook(eventKey: string, handler: InternalHookHandler): void {
  if (!handlers.has(eventKey)) {
    handlers.set(eventKey, [])
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  handlers.get(eventKey)!.push(handler)
}

/**
 * Unregister a specific hook handler.
 * @param eventKey - The event key the handler was registered for
 * @param handler - The exact handler reference to remove
 */
export function unregisterInternalHook(eventKey: string, handler: InternalHookHandler): void {
  const eventHandlers = handlers.get(eventKey)
  if (!eventHandlers) return

  const index = eventHandlers.indexOf(handler)
  if (index !== -1) {
    eventHandlers.splice(index, 1)
  }

  if (eventHandlers.length === 0) {
    handlers.delete(eventKey)
  }
}

/** Clear all registered hooks (for testing). */
export function clearInternalHooks(): void {
  handlers.clear()
}

/** Get all registered event keys (for debugging). */
export function getRegisteredEventKeys(): string[] {
  return Array.from(handlers.keys())
}

/**
 * Trigger a hook event — calls handlers for both the general type
 * and the specific type:action.
 *
 * Error-isolated: one handler failing doesn't block subsequent handlers.
 */
export async function triggerInternalHook(event: InternalHookEvent): Promise<void> {
  const typeHandlers = handlers.get(event.type) ?? []
  const specificHandlers = handlers.get(`${event.type}:${event.action}`) ?? []
  const allHandlers = [...typeHandlers, ...specificHandlers]

  if (allHandlers.length === 0) return

  for (const handler of allHandlers) {
    try {
      await handler(event)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Hook error [${event.type}:${event.action}]`, { error: message })
    }
  }
}

/**
 * Fire-and-forget wrapper — logs errors instead of rejecting.
 * @param task - The async hook task
 * @param label - Human-readable label for logging
 */
export function fireAndForgetHook(task: Promise<void>, label: string): void {
  task.catch((err) => {
    log.warn(`fire-and-forget hook failed: ${label}`, { error: err })
  })
}

// ── Event Factory ───────────────────────────────────────────────────────

/**
 * Create a hook event with common fields filled in.
 * @param type - Event domain
 * @param action - Specific action
 * @param sessionKey - Session key
 * @param context - Event-specific context
 */
export function createInternalHookEvent(
  type: InternalHookEventType,
  action: string,
  sessionKey: string,
  context: Record<string, unknown> = {},
): InternalHookEvent {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  }
}

// ── Type Guards ─────────────────────────────────────────────────────────

/** Checks that event.type and event.action match expected values. */
function isTypeAction(
  event: InternalHookEvent,
  type: InternalHookEventType,
  action: string,
): boolean {
  return event.type === type && event.action === action
}

/** Validate context has a string field. */
function hasString(ctx: Record<string, unknown>, key: string): boolean {
  return typeof ctx[key] === "string"
}

/** Validate context has a boolean field. */
function hasBoolean(ctx: Record<string, unknown>, key: string): boolean {
  return typeof ctx[key] === "boolean"
}

/** Type guard for message:received events. */
export function isMessageReceivedEvent(event: InternalHookEvent): event is MessageReceivedEvent {
  if (!isTypeAction(event, "message", "received")) return false
  return hasString(event.context, "from") && hasString(event.context, "channelId")
}

/** Type guard for message:sent events. */
export function isMessageSentEvent(event: InternalHookEvent): event is MessageSentEvent {
  if (!isTypeAction(event, "message", "sent")) return false
  return (
    hasString(event.context, "to") &&
    hasString(event.context, "channelId") &&
    hasBoolean(event.context, "success")
  )
}

/** Type guard for message:transcribed events. */
export function isMessageTranscribedEvent(
  event: InternalHookEvent,
): event is MessageTranscribedEvent {
  if (!isTypeAction(event, "message", "transcribed")) return false
  return hasString(event.context, "transcript") && hasString(event.context, "channelId")
}

/** Type guard for session:start events. */
export function isSessionStartEvent(event: InternalHookEvent): event is SessionStartEvent {
  if (!isTypeAction(event, "session", "start")) return false
  return hasString(event.context, "userId")
}

/** Type guard for session:end events. */
export function isSessionEndEvent(event: InternalHookEvent): event is SessionEndEvent {
  if (!isTypeAction(event, "session", "end")) return false
  return hasString(event.context, "userId") && typeof event.context.turnCount === "number"
}

/** Type guard for agent:bootstrap events. */
export function isAgentBootstrapEvent(event: InternalHookEvent): event is AgentBootstrapEvent {
  if (!isTypeAction(event, "agent", "bootstrap")) return false
  return hasString(event.context, "workspaceDir")
}

/** Type guard for gateway:startup events. */
export function isGatewayStartupEvent(event: InternalHookEvent): event is GatewayStartupEvent {
  if (!isTypeAction(event, "gateway", "startup")) return false
  return true
}
