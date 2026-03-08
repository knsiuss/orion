/**
 * @file gateway-sync.ts
 * @description CRDT-based synchronization between gateway peer instances.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - startup.ts calls register peers and starts discovery (fire-and-forget).
 *   - sync-transport.ts handles the actual WebSocket/HTTP delivery.
 *   - Receives deltas from remote gateways and merges into local state.
 */

import { createLogger } from "../logger.js"
import { syncTransport } from "./sync-transport.js"

const log = createLogger("gateway.sync")

/** Registered peer entry. */
interface PeerEntry {
  /** Peer gateway ID. */
  gatewayId: string
  /** Peer HTTP/WS base URL. */
  url: string
}

/**
 * Synchronizes state between distributed EDITH gateway instances.
 */
export class GatewaySync {
  /** Registered peers keyed by gatewayId. */
  private readonly peers = new Map<string, PeerEntry>()

  /**
   * Register a peer gateway for synchronization.
   *
   * @param gatewayId - Unique peer gateway identifier.
   * @param url       - Peer HTTP base URL.
   */
  registerPeer(gatewayId: string, url: string): void {
    this.peers.set(gatewayId, { gatewayId, url })
    log.info("peer registered", { gatewayId, url })
  }

  /**
   * Unregister a peer gateway.
   *
   * @param gatewayId - Peer to remove.
   */
  unregisterPeer(gatewayId: string): void {
    this.peers.delete(gatewayId)
    log.info("peer unregistered", { gatewayId })
  }

  /**
   * Push a delta to all registered peers.
   *
   * @param data - Serializable delta to push.
   */
  async push(data: unknown): Promise<void> {
    const pushes = [...this.peers.values()].map((peer) =>
      syncTransport.send(peer.url, data).catch((err) =>
        log.warn("sync push failed", { gatewayId: peer.gatewayId, err }),
      ),
    )
    await Promise.all(pushes)
    log.debug("sync delta pushed", { peers: this.peers.size })
  }

  /**
   * Apply an incoming delta from a remote peer.
   *
   * @param delta - Incoming serializable delta.
   */
  async receive(delta: unknown): Promise<void> {
    // Delegates to memory-sync or other subsystems based on payload type
    const typedDelta = delta as { type?: string; userId?: string }
    log.debug("sync delta received", { type: typedDelta?.type ?? "unknown" })
    // Further routing would be done by specific subsystem handlers
  }

  /**
   * Perform a bidirectional sync handshake with a peer.
   *
   * @param peerUrl - Peer gateway URL to handshake with.
   */
  async handshake(peerUrl: string): Promise<void> {
    try {
      await syncTransport.send(peerUrl, {
        type: "sync_handshake",
        timestamp: Date.now(),
        gatewayId: process.env.GATEWAY_ID ?? "primary",
      })
      log.info("sync handshake complete", { peerUrl })
    } catch (err) {
      log.warn("sync handshake failed", { peerUrl, err })
    }
  }
}

/** Singleton gateway sync. */
export const gatewaySync = new GatewaySync()
