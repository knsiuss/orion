/**
 * @file network-discovery.ts
 * @description mDNS-based local network gateway discovery.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses 'bonjour-service' npm package via dynamic import (optional).
 *   - Degrades gracefully — no-op if bonjour is not installed.
 *   - startup.ts calls advertise() and discover() fire-and-forget.
 */

import { createLogger } from "../logger.js"

const log = createLogger("gateway.network-discovery")

/** Discovered peer gateway entry. */
interface DiscoveredGateway {
  /** Remote gateway ID. */
  gatewayId: string
  /** Remote gateway URL. */
  url: string
}

/** Bonjour service shape (optional dep). */
type BonjourBrowser = { stop(): void }
type BonjourService = {
  publish(opts: Record<string, unknown>): void
  find(opts: Record<string, unknown>, cb: (service: Record<string, unknown>) => void): BonjourBrowser
  destroy(): void
}
type BonjourModule = { default: new() => BonjourService }

/** Load optional module without TypeScript module resolution. */
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>

/**
 * Advertises and discovers EDITH gateway instances on the local network via mDNS.
 */
export class NetworkDiscovery {
  /** Active bonjour instance, if available. */
  private bonjour: BonjourService | null = null
  /** Active browser instance for cleanup. */
  private browser: BonjourBrowser | null = null

  /**
   * Advertise this gateway on the local network via mDNS.
   * Silently no-ops if bonjour-service is not installed.
   *
   * @param port - Port this gateway is listening on.
   */
  advertise(port: number): void {
    void this.tryAdvertise(port).catch((err) =>
      log.warn("mDNS advertise failed", { err }),
    )
  }

  private async tryAdvertise(port: number): Promise<void> {
    try {
      const mod = await dynamicImport("bonjour-service") as BonjourModule
      this.bonjour = new mod.default()
      this.bonjour.publish({
        name: `edith-gateway-${process.env.GATEWAY_ID ?? "primary"}`,
        type: "edith",
        port,
      })
      log.info("mDNS advertisement started", { port })
    } catch {
      log.debug("bonjour-service not available — mDNS advertisement skipped")
    }
  }

  /**
   * Discover EDITH gateways on the local network via mDNS.
   *
   * @returns Array of discovered gateways (empty if bonjour not available).
   */
  async discover(): Promise<DiscoveredGateway[]> {
    try {
      const mod = await dynamicImport("bonjour-service") as BonjourModule
      const bonjour = new mod.default()
      const discovered: DiscoveredGateway[] = []

      return await new Promise<DiscoveredGateway[]>((resolve) => {
        // Use an object so the reference is read (not just assigned)
        const timer = { ref: setTimeout(() => { resolve(discovered) }, 3000) }

        this.browser = bonjour.find({ type: "edith" }, (service) => {
          const host = (service.host as string | undefined) ?? "localhost"
          const port = (service.port as number | undefined) ?? 18789
          const name = (service.name as string | undefined) ?? "unknown"
          discovered.push({ gatewayId: name, url: `http://${host}:${port}` })
          log.debug("mDNS peer discovered", { name, host, port })
          // Reset timer so we keep collecting for 3s after last discovery
          clearTimeout(timer.ref)
          timer.ref = setTimeout(() => {
            this.browser?.stop()
            bonjour.destroy()
            resolve(discovered)
          }, 3000)
        })
      })
    } catch {
      log.debug("bonjour-service not available — mDNS discovery skipped")
      return []
    }
  }

  /**
   * Stop mDNS advertisement and browser.
   */
  stop(): void {
    this.browser?.stop()
    this.bonjour?.destroy()
    this.bonjour = null
    this.browser = null
    log.debug("mDNS stopped")
  }
}

/** Singleton network discovery. */
export const networkDiscovery = new NetworkDiscovery()
