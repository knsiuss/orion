/**
 * @file device-router.ts
 * @description Routes outbound messages to the appropriate user devices.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses presence-manager.ts to select active devices.
 *   - pairedDeviceRegistry.listForUser() provides the device candidate list.
 *   - Caller is responsible for actual message delivery per deviceId.
 */

import { createLogger } from "../logger.js"
import { presenceManager } from "./presence-manager.js"
import { pairedDeviceRegistry } from "../pairing/device-registry.js"

const log = createLogger("sessions.device-router")

/**
 * Routes outbound payloads to the correct device(s) based on presence state.
 */
export class DeviceRouter {
  /**
   * Determine which device(s) should receive a payload.
   *
   * @param userId  - User to route to.
   * @param _payload - Payload being routed (reserved for future content-based routing).
   * @returns Array of deviceIds to send to ('all' placeholder returns all active devices).
   */
  route(userId: string, _payload: unknown): string[] {
    const active = presenceManager.getActiveDevice(userId)

    if (active !== "all") {
      return [active]
    }

    // Broadcast to all non-offline devices
    const devices = pairedDeviceRegistry.listForUser(userId)
    const online = devices.filter((d) => {
      const { state } = presenceManager.getPresence(d.deviceId)
      return state !== "offline" && state !== "dnd"
    })

    if (online.length === 0) {
      log.debug("route: no online devices, broadcasting to all registered", { userId })
      return devices.map((d) => d.deviceId)
    }

    return online.map((d) => d.deviceId)
  }

  /**
   * Determine the single best device for a push notification.
   *
   * @param userId - User to notify.
   * @returns Single deviceId or 'all' if no preferred device.
   */
  routeNotification(userId: string): string | "all" {
    return presenceManager.getActiveDevice(userId)
  }
}

/** Singleton device router. */
export const deviceRouter = new DeviceRouter()
