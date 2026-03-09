/**
 * @file event-bus.ts
 * @description Typed internal event bus for decoupled communication between EDITH subsystems.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Singleton EventEmitter (`eventBus`) exported for use by any module that needs to
 *   publish or subscribe to system-wide events (e.g. message received, memory save,
 *   trigger fired, email draft created). Consumed by message-pipeline.ts, channels/email.ts,
 *   and background/daemon.ts to decouple producers from consumers without direct imports.
 */
import { EventEmitter } from "node:events"

import { createLogger } from "../logger.js"

const log = createLogger("core.event-bus")

export type EDITHEvent =
  | {
    type: "user.message.received"
    userId: string
    content: string
    channel: string
    timestamp: number
  }
  | {
    type: "user.message.sent"
    userId: string
    content: string
    channel: string
    timestamp: number
  }
  | {
    type: "memory.save.requested"
    userId: string
    content: string
    metadata: Record<string, unknown>
  }
  | {
    type: "trigger.fired"
    triggerName: string
    userId: string
    message: string
    priority: string
  }
  | {
    type: "channel.connected"
    channelName: string
  }
  | {
    type: "channel.disconnected"
    channelName: string
    reason?: string
  }
  | {
    type: "memory.consolidate.requested"
    userId: string
  }
  | {
    type: "profile.update.requested"
    userId: string
    content: string
  }
  | {
    type: "causal.update.requested"
    userId: string
    content: string
  }
  | {
    type: "system.heartbeat"
    timestamp: number
  }
  | {
    type: "hardware.print.completed"
    jobId: string
    filePath: string
  }
  | {
    type: "hardware.print.failed"
    jobId: string
    filePath: string
    reason: string
  }
  | {
    type: "voice.handoff.initiated"
    fromDeviceId: string
    toDeviceId: string
  }
  | {
    type: "voice.handoff.completed"
    fromDeviceId: string
    toDeviceId: string
  }
  | {
    /** Emitted by SecretStore when one or more env-file secrets are rotated. */
    type: "security.secrets_rotated"
    /** Names of the keys that changed — values are never included. */
    changedKeys: string[]
    rotatedAt: string
  }

class EDITHEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  emit<T extends EDITHEvent["type"]>(
    eventType: T,
    data: Extract<EDITHEvent, { type: T }>,
  ): boolean {
    log.debug("event emitted", { type: eventType })
    return super.emit(eventType, data)
  }

  on<T extends EDITHEvent["type"]>(
    eventType: T,
    listener: (data: Extract<EDITHEvent, { type: T }>) => void | Promise<void>,
  ): this {
    return super.on(eventType, (data: Extract<EDITHEvent, { type: T }>) => {
      try {
        const result = listener(data)
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            log.error(`Event handler error for ${eventType}`, error)
          })
        }
      } catch (error) {
        log.error(`Event handler error for ${eventType}`, error)
      }
    })
  }

  dispatch<T extends EDITHEvent["type"]>(
    eventType: T,
    data: Omit<Extract<EDITHEvent, { type: T }>, "type">,
  ): void {
    const fullData = { ...data, type: eventType } as Extract<EDITHEvent, { type: T }>
    this.emit(eventType, fullData)
  }
}

export const eventBus = new EDITHEventBus()
