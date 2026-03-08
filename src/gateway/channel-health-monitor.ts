/**
 * @file channel-health-monitor.ts
 * @description Per-channel uptime tracking with periodic heartbeat probes.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - ChannelManager.init() calls startMonitoring() after all channels are registered.
 *   - GatewayServer exposes getHealth() via GET /api/channels/health.
 *   - Emits events through the global event bus when a channel goes down/up.
 *
 * PATTERN REFERENCE:
 *   - Inspired by OpenClaw's channel-health-monitor.ts heartbeat pattern.
 */

import type { BaseChannel } from "../channels/base.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.channel-health-monitor")

/** Heartbeat probe interval in milliseconds (30 seconds). */
const HEARTBEAT_INTERVAL_MS = 30_000

/** Health snapshot for a single channel. */
export interface ChannelHealth {
  channelId: string
  connected: boolean
  lastHeartbeat: number
  uptimeMs: number
  downSince: number | null
  errorCount: number
  consecutiveFailures: number
}

interface ChannelState {
  channelId: string
  channel: BaseChannel
  connected: boolean
  lastHeartbeat: number
  connectedSince: number | null
  downSince: number | null
  errorCount: number
  consecutiveFailures: number
}

/**
 * Monitors registered channels via periodic isConnected() probes.
 * Tracks uptime, error counts, and emits state-change events.
 */
export class ChannelHealthMonitor {
  private states = new Map<string, ChannelState>()
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Begin heartbeat monitoring for the given channels.
   * @param channels - Map of channelId → BaseChannel instances
   */
  startMonitoring(channels: Map<string, BaseChannel>): void {
    if (this.timer) {
      this.stopMonitoring()
    }

    const now = Date.now()
    for (const [id, channel] of channels) {
      const connected = channel.isConnected()
      this.states.set(id, {
        channelId: id,
        channel,
        connected,
        lastHeartbeat: now,
        connectedSince: connected ? now : null,
        downSince: connected ? null : now,
        errorCount: 0,
        consecutiveFailures: 0,
      })
    }

    this.timer = setInterval(() => {
      this.heartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    this.timer.unref()

    log.info("channel health monitoring started", { channels: channels.size })
  }

  /**
   * Returns health snapshot for all channels, or a single channel by ID.
   * @param channelId - Optional channel ID to filter
   */
  getHealth(): ChannelHealth[]
  getHealth(channelId: string): ChannelHealth | null
  getHealth(channelId?: string): ChannelHealth[] | ChannelHealth | null {
    if (channelId !== undefined) {
      const state = this.states.get(channelId)
      if (!state) return null
      return this.toHealthSnapshot(state)
    }

    const result: ChannelHealth[] = []
    for (const state of this.states.values()) {
      result.push(this.toHealthSnapshot(state))
    }
    return result
  }

  /** Stop the heartbeat timer and clear state. */
  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.states.clear()
    log.info("channel health monitoring stopped")
  }

  private heartbeat(): void {
    const now = Date.now()
    for (const state of this.states.values()) {
      try {
        const wasConnected = state.connected
        const isNowConnected = state.channel.isConnected()

        state.connected = isNowConnected
        state.lastHeartbeat = now

        if (isNowConnected) {
          state.consecutiveFailures = 0
          if (!wasConnected) {
            state.connectedSince = now
            state.downSince = null
            log.info("channel recovered", { channelId: state.channelId })
          }
        } else {
          state.consecutiveFailures++
          state.errorCount++
          if (wasConnected) {
            state.downSince = now
            state.connectedSince = null
            log.warn("channel went down", {
              channelId: state.channelId,
              consecutiveFailures: state.consecutiveFailures,
            })
          }
        }
      } catch (err) {
        state.errorCount++
        state.consecutiveFailures++
        log.warn("heartbeat probe failed", {
          channelId: state.channelId,
          error: String(err),
        })
      }
    }
  }

  private toHealthSnapshot(state: ChannelState): ChannelHealth {
    const now = Date.now()
    const uptimeMs = state.connectedSince ? now - state.connectedSince : 0

    return {
      channelId: state.channelId,
      connected: state.connected,
      lastHeartbeat: state.lastHeartbeat,
      uptimeMs,
      downSince: state.downSince,
      errorCount: state.errorCount,
      consecutiveFailures: state.consecutiveFailures,
    }
  }
}

export const channelHealthMonitor = new ChannelHealthMonitor()
