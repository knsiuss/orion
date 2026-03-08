/**
 * @file p2p-connector.ts
 * @description Direct WebSocket P2P connections between gateway instances.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - sync-transport.ts checks isConnected() to select WebSocket path.
 *   - Connections are kept alive for ongoing sync sessions.
 *   - Falls back gracefully — connection failures are non-fatal.
 */

import { createLogger } from "../logger.js"

const log = createLogger("gateway.p2p-connector")

/** Active WebSocket connection wrapper. */
interface P2PConnection {
  /** Target URL. */
  url: string
  /** Raw WebSocket instance. */
  ws: WebSocket
  /** Whether the connection is currently open. */
  open: boolean
}

/**
 * Manages direct WebSocket connections between gateway instances.
 */
export class P2PConnector {
  /** Active connections keyed by target URL. */
  private readonly connections = new Map<string, P2PConnection>()

  /**
   * Establish a direct WebSocket connection to a peer gateway.
   *
   * @param targetUrl - Base URL of the peer gateway.
   * @returns True if connection was established successfully.
   */
  async connect(targetUrl: string): Promise<boolean> {
    if (this.isConnected(targetUrl)) return true

    try {
      const wsUrl = targetUrl.replace(/^http/, "ws") + "/gateway/p2p"
      const ws = new WebSocket(wsUrl)

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close()
          resolve(false)
        }, 5000)

        ws.onopen = (): void => {
          clearTimeout(timeout)
          const conn: P2PConnection = { url: targetUrl, ws, open: true }
          this.connections.set(targetUrl, conn)
          log.info("P2P connection established", { targetUrl })
          resolve(true)
        }

        ws.onerror = (): void => {
          clearTimeout(timeout)
          log.warn("P2P connection failed", { targetUrl })
          resolve(false)
        }

        ws.onclose = (): void => {
          const conn = this.connections.get(targetUrl)
          if (conn) conn.open = false
          log.debug("P2P connection closed", { targetUrl })
        }
      })
    } catch (err) {
      log.warn("P2P connect error", { targetUrl, err })
      return false
    }
  }

  /**
   * Disconnect from a peer gateway.
   *
   * @param targetUrl - Peer gateway to disconnect from.
   */
  disconnect(targetUrl: string): void {
    const conn = this.connections.get(targetUrl)
    if (conn) {
      conn.ws.close()
      this.connections.delete(targetUrl)
      log.info("P2P connection closed", { targetUrl })
    }
  }

  /**
   * Check if an active WebSocket connection exists to a peer.
   *
   * @param targetUrl - Peer URL to check.
   * @returns True if the connection is open.
   */
  isConnected(targetUrl: string): boolean {
    return this.connections.get(targetUrl)?.open ?? false
  }
}

/** Singleton P2P connector. */
export const p2pConnector = new P2PConnector()
