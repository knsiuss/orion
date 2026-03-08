/**
 * @file protocol.ts
 * @description Agent Communication Protocol (ACP) message schema, state machine, and HMAC signing utilities.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Defines ACPMessage, AgentCredential, ACPState, and STATE_TRANSITIONS used across the ACP subsystem.
 *   - signMessage() and verifyMessage() are used by runner.ts and router.ts to authenticate inter-agent messages.
 *   - STATE_TRANSITIONS enforces the legal state machine: idle → requested → approved → executing → done/failed.
 *   - Consumed by acp/router.ts for dispatch validation and by agents/runner.ts for outbound message signing.
 */
import crypto from "node:crypto"

export type ACPState = "idle" | "requested" | "approved" | "executing" | "done" | "failed"

export interface ACPMessage {
  id: string
  from: string
  to: string
  type: "request" | "response" | "event" | "error"
  action: string
  payload: unknown
  correlationId?: string
  timestamp: number
  signature: string
  state: ACPState
}

export interface AgentCredential {
  agentId: string
  secret: string
  capabilities: string[]
}

export const STATE_TRANSITIONS: Record<ACPState, ACPState[]> = {
  idle: ["requested"],
  requested: ["approved", "failed"],
  approved: ["executing", "failed"],
  executing: ["done", "failed"],
  done: [],
  failed: [],
}

export function statePayload(msg: Omit<ACPMessage, "signature">): string {
  return `${msg.id}:${msg.from}:${msg.to}:${msg.action}:${msg.timestamp}`
}

export function signMessage(msg: Omit<ACPMessage, "signature">, secret: string): string {
  return crypto.createHmac("sha256", secret).update(statePayload(msg)).digest("hex")
}

export function verifyMessage(msg: ACPMessage, secret: string): boolean {
  try {
    const payload = statePayload({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      type: msg.type,
      action: msg.action,
      payload: msg.payload,
      correlationId: msg.correlationId,
      timestamp: msg.timestamp,
      state: msg.state,
    })

    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex")
    const left = Buffer.from(expected, "hex")
    const right = Buffer.from(msg.signature, "hex")

    if (left.length !== right.length) {
      return false
    }

    return crypto.timingSafeEqual(left, right)
  } catch {
    return false
  }
}
