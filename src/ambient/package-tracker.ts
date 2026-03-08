/**
 * @file package-tracker.ts
 * @description Tracks package deliveries and provides status updates.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Stores tracking numbers and periodically polls for status updates.
 *   Integrated with ambient-scheduler.ts for proactive delivery alerts.
 */
import { createLogger } from "../logger.js"

const log = createLogger("ambient.package-tracker")

export interface TrackedPackage {
  trackingNumber: string
  carrier: string
  description: string
  status: string
  lastUpdate: Date
}

class PackageTracker {
  private packages = new Map<string, TrackedPackage[]>()

  track(userId: string, trackingNumber: string, carrier: string, description = ""): void {
    const userPackages = this.packages.get(userId) ?? []
    userPackages.push({
      trackingNumber,
      carrier,
      description,
      status: "pending",
      lastUpdate: new Date(),
    })
    this.packages.set(userId, userPackages)
    log.info("package tracked", { userId, trackingNumber, carrier })
  }

  getActive(userId: string): TrackedPackage[] {
    return (this.packages.get(userId) ?? []).filter(p => p.status !== "delivered")
  }

  markDelivered(userId: string, trackingNumber: string): void {
    const userPackages = this.packages.get(userId) ?? []
    const pkg = userPackages.find(p => p.trackingNumber === trackingNumber)
    if (pkg) {
      pkg.status = "delivered"
      pkg.lastUpdate = new Date()
    }
  }
}

export const packageTracker = new PackageTracker()
