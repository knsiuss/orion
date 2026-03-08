/**
 * @file cloud-relay.ts
 * @description Cloud WebSocket relay fallback for cross-network gateway communication.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Used when direct P2P (same-network) is not available.
 *   - Relay server URL is configured via GATEWAY_RELAY_URL env var.
 *   - sync-transport.ts selects between P2P and cloud relay automatically.
 */

import { createLogger } from "../logger.js"

const log = createLogger("gateway.cloud-relay")

/**
 * Manages connection to a cloud WebSocket relay for cross-network gateway sync.
 */
export class CloudRelay {
  /** Active WebSocket connection to the relay, if any. */
  private ws: WebSocket | null = null
  /** Current connection state. */
  private connected = false
  /** Relay URL (stored for reconnect attempts and diagnostics). */
  private relayUrl = ""

  /**
   * Connect to the cloud relay WebSocket.
   *
   * @param relayUrl - WebSocket URL of the relay server.
   */
  async connect(relayUrl: string): Promise<void> {
    if (this.connected) return

    this.relayUrl = relayUrl
    log.debug("relay URL configured", { relayUrl: this.relayUrl })
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(relayUrl)

        const timeout = setTimeout(() => {
          this.ws?.close()
          reject(new Error("Cloud relay connection timeout"))
        }, 10_000)

        this.ws.onopen = (): void => {
          clearTimeout(timeout)
          this.connected = true
          log.info("cloud relay connected", { relayUrl })
          resolve()
        }

        this.ws.onerror = (): void => {
          clearTimeout(timeout)
          this.connected = false
          reject(new Error("Cloud relay connection error"))
        }

        this.ws.onclose = (): void => {
          this.connected = false
          log.info("cloud relay disconnected")
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  /**
   * Disconnect from the cloud relay.
   */
  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this.connected = false
    log.info("cloud relay disconnected")
  }

  /**
   * Send data through the cloud relay.
   *
   * @param data - Serializable data to send.
   */
  async send(data: unknown): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error("Cloud relay not connected")
    }
    this.ws.send(JSON.stringify(data))
  }

  /**
   * Check if the cloud relay connection is active.
   *
   * @returns True if connected.
   */
  isConnected(): boolean {
    return this.connected
  }
}

/** Singleton cloud relay. */
export const cloudRelay = new CloudRelay()
