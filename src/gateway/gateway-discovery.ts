/**
 * @file gateway-discovery.ts
 * @description Cloud-backed registry for cross-network gateway peer discovery.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Complements network-discovery.ts (mDNS) for internet-scale discovery.
 *   - Peers are registered on startup; discovered via user ID.
 *   - gateway-sync.ts uses getPeers() to find peers to sync with.
 */

import { createLogger } from "../logger.js"

const log = createLogger("gateway.discovery")

/** A registered gateway peer. */
interface GatewayEntry {
  /** Gateway unique ID. */
  gatewayId: string
  /** User ID associated with this gateway. */
  userId: string
  /** HTTP base URL of this gateway. */
  url: string
  /** When this entry was last updated. */
  updatedAt: number
}

/**
 * In-memory gateway registry for peer discovery.
 * A real implementation would persist to a shared cloud store.
 */
export class GatewayDiscovery {
  /** Registered gateways keyed by gatewayId. */
  private readonly registry = new Map<string, GatewayEntry>()

  /**
   * Register this gateway instance for discovery.
   *
   * @param gatewayId - Unique identifier for this gateway.
   * @param url       - Public HTTP URL of this gateway.
   * @param userId    - User ID this gateway serves.
   */
  register(gatewayId: string, url: string, userId: string): void {
    this.registry.set(gatewayId, { gatewayId, userId, url, updatedAt: Date.now() })
    log.info("gateway registered", { gatewayId, userId, url })
  }

  /**
   * Get all known peer gateways for a user.
   * Excludes this gateway from results.
   *
   * @param userId - User whose gateways to find.
   * @returns Array of peer gateways for this user.
   */
  getPeers(userId: string): Array<{ gatewayId: string; url: string }> {
    const selfId = process.env.GATEWAY_ID ?? "primary"
    return [...this.registry.values()]
      .filter((e) => e.userId === userId && e.gatewayId !== selfId)
      .map(({ gatewayId, url }) => ({ gatewayId, url }))
  }

  /**
   * Unregister a gateway (e.g., on shutdown).
   *
   * @param gatewayId - Gateway to unregister.
   */
  unregister(gatewayId: string): void {
    this.registry.delete(gatewayId)
    log.info("gateway unregistered", { gatewayId })
  }
}

/** Singleton gateway discovery. */
export const gatewayDiscovery = new GatewayDiscovery()
