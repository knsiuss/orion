/**
 * @file os-agent/notification.ts
 * @description Unified proactive notification dispatcher for desktop, mobile/chat, and voice routing.
 * @module os-agent/notification
 */

import { execa } from "execa"

import { isWithinQuietHours } from "../background/quiet-hours.js"
import {
  loadRuntimeProactiveConfig,
  resolveRuntimeProactiveConfig,
  type RuntimeProactiveConfig,
} from "../background/runtime-config.js"
import { channelManager } from "../channels/manager.js"
import { eventBus } from "../core/event-bus.js"
import { createLogger } from "../logger.js"
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
  NotificationPriority,
} from "./types.js"

const log = createLogger("os-agent.notification")

type EventBusDispatch = typeof eventBus.dispatch

interface NotificationDispatcherDependencies {
  notifyDesktop?: (title: string, message: string) => Promise<void>
  sendChannelMessage?: (userId: string, message: string) => Promise<boolean>
  dispatchEvent?: EventBusDispatch
  now?: () => Date
}

const DEFAULT_PROACTIVE_CONFIG = resolveRuntimeProactiveConfig()

async function notifyDesktopHost(title: string, message: string): Promise<void> {
  const safeTitle = title.replace(/'/g, "''").replace(/"/g, '\\"')
  const safeMessage = message.replace(/'/g, "''").replace(/"/g, '\\"')

  if (process.platform === "darwin") {
    await execa("osascript", ["-e", `display notification "${safeMessage}" with title "${safeTitle}"`])
    return
  }

  if (process.platform === "linux") {
    await execa("notify-send", [title, message])
    return
  }

  if (process.platform === "win32") {
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null",
      `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument`,
      `$xml.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>${safeTitle}</text><text>${safeMessage}</text></binding></visual></toast>')`,
      `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)`,
      `$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('EDITH')`,
      "$notifier.Show($toast)",
    ].join("; ")

    await execa("powershell", ["-NoProfile", "-Command", script])
  }
}

function defaultChannelsForPriority(priority: NotificationPriority): NotificationChannel[] {
  if (priority === "high") {
    return ["desktop", "mobile", "voice"]
  }
  if (priority === "medium") {
    return ["desktop", "mobile"]
  }
  return ["desktop"]
}

function resolveRequestedChannels(
  proactiveConfig: RuntimeProactiveConfig,
  payload: NotificationPayload,
): NotificationChannel[] {
  const requested = payload.channels && payload.channels.length > 0
    ? payload.channels
    : defaultChannelsForPriority(payload.priority)

  return requested.filter((channel) => {
    if (channel === "desktop") {
      return proactiveConfig.channels.desktop
    }
    if (channel === "mobile") {
      return proactiveConfig.channels.mobile
    }
    return proactiveConfig.channels.voice
  })
}

/**
 * Unified dispatcher for proactive notifications. Quiet hours, cooldown checks,
 * client event fan-out, and host-local desktop notifications all pass through here.
 */
export class NotificationDispatcher {
  private proactiveConfig: RuntimeProactiveConfig
  private readonly notifyDesktopImpl: (title: string, message: string) => Promise<void>
  private readonly sendChannelMessageImpl: (userId: string, message: string) => Promise<boolean>
  private readonly dispatchEventImpl: EventBusDispatch
  private readonly nowImpl: () => Date
  private readonly lastDispatchAt = new Map<string, number>()

  constructor(
    proactiveConfig: RuntimeProactiveConfig = DEFAULT_PROACTIVE_CONFIG,
    dependencies: NotificationDispatcherDependencies = {},
  ) {
    this.proactiveConfig = proactiveConfig
    this.notifyDesktopImpl = dependencies.notifyDesktop ?? notifyDesktopHost
    this.sendChannelMessageImpl = dependencies.sendChannelMessage ?? ((userId, message) => channelManager.send(userId, message))
    this.dispatchEventImpl = dependencies.dispatchEvent ?? eventBus.dispatch.bind(eventBus)
    this.nowImpl = dependencies.now ?? (() => new Date())
  }

  /**
   * Replace the active proactive config without recreating the dispatcher.
   *
   * @param proactiveConfig The normalized runtime proactive config.
   */
  updateConfig(proactiveConfig: RuntimeProactiveConfig): void {
    this.proactiveConfig = proactiveConfig
  }

  /**
   * Reload proactive config from edith.json and apply it to this dispatcher.
   *
   * @returns The normalized proactive runtime config.
   */
  async reloadConfig(): Promise<RuntimeProactiveConfig> {
    const proactiveConfig = await loadRuntimeProactiveConfig()
    this.updateConfig(proactiveConfig)
    return proactiveConfig
  }

  /**
   * Read the currently active proactive config snapshot.
   *
   * @returns The current normalized runtime config.
   */
  getConfig(): RuntimeProactiveConfig {
    return this.proactiveConfig
  }

  /**
   * Dispatch a proactive notification through the configured routes.
   *
   * @param payload The normalized notification payload to dispatch.
   * @returns Routing outcome, including requested and delivered channels.
   */
  async dispatch(payload: NotificationPayload): Promise<NotificationDispatchResult> {
    if (!this.proactiveConfig.enabled) {
      return {
        ok: false,
        requestedChannels: [],
        deliveredChannels: [],
        suppressedReason: "proactive-disabled",
      }
    }

    const requestedChannels = resolveRequestedChannels(this.proactiveConfig, payload)
    if (requestedChannels.length === 0) {
      return {
        ok: false,
        requestedChannels: [],
        deliveredChannels: [],
        suppressedReason: "no-channels",
      }
    }

    const now = this.nowImpl()
    if (!payload.bypassQuietHours && isWithinQuietHours(now, this.proactiveConfig.quietHours)) {
      return {
        ok: false,
        requestedChannels,
        deliveredChannels: [],
        suppressedReason: "quiet-hours",
      }
    }

    if (payload.cooldownKey && payload.cooldownMs && payload.cooldownMs > 0) {
      const previous = this.lastDispatchAt.get(payload.cooldownKey) ?? 0
      if ((now.getTime() - previous) < payload.cooldownMs) {
        return {
          ok: false,
          requestedChannels,
          deliveredChannels: [],
          suppressedReason: "cooldown",
        }
      }
    }

    const deliveredChannels: NotificationChannel[] = []

    this.dispatchEventImpl("notification.dispatched", {
      userId: payload.userId,
      title: payload.title,
      message: payload.message,
      priority: payload.priority,
      channels: requestedChannels,
      source: payload.source,
      timestamp: now.getTime(),
      metadata: payload.metadata,
    })

    if (requestedChannels.includes("desktop")) {
      try {
        await this.notifyDesktopImpl(payload.title, payload.message)
        deliveredChannels.push("desktop")
      } catch (error) {
        log.warn("desktop notification failed", {
          error: String(error),
          title: payload.title,
        })
      }
    }

    if (requestedChannels.includes("mobile")) {
      try {
        const sent = await this.sendChannelMessageImpl(payload.userId, `${payload.title}\n${payload.message}`.trim())
        if (sent) {
          deliveredChannels.push("mobile")
        }
      } catch (error) {
        log.warn("mobile/chat notification failed", {
          error: String(error),
          title: payload.title,
        })
      }
    }

    if (payload.cooldownKey && payload.cooldownMs && payload.cooldownMs > 0) {
      this.lastDispatchAt.set(payload.cooldownKey, now.getTime())
    }

    return {
      ok: true,
      requestedChannels,
      deliveredChannels,
    }
  }
}

export const notificationDispatcher = new NotificationDispatcher()

export const __notificationTestUtils = {
  defaultChannelsForPriority,
  resolveRequestedChannels,
}
