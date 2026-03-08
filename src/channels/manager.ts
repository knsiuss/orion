import type { BaseChannel } from "./base.js"
import { WebChatChannel } from "./webchat.js"
import { whatsAppChannel } from "./whatsapp.js"
import { telegramChannel } from "./telegram.js"
import { discordChannel } from "./discord.js"
import { signalChannel } from "./signal.js"
import { lineChannel } from "./line.js"
import { matrixChannel } from "./matrix.js"
import { teamsChannel } from "./teams.js"
import { iMessageChannel } from "./imessage.js"
import { emailChannel } from "./email.js"
import { smsChannel } from "./sms.js"
import { phoneChannel } from "./phone.js"
import { channelCircuitBreaker } from "./circuit-breaker.js"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { channelHealthMonitor } from "../gateway/channel-health-monitor.js"
import { sandbox } from "../permissions/sandbox.js"
import { outputScanner } from "../security/output-scanner.js"

const log = createLogger("channels.manager")

export class ChannelManager {
  private channels = new Map<string, BaseChannel>()
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    const webchat = new WebChatChannel()
    this.channels.set("webchat", webchat)
    this.channels.set("whatsapp", whatsAppChannel)
    this.channels.set("telegram", telegramChannel)
    this.channels.set("discord", discordChannel)
    this.channels.set("signal", signalChannel)
    this.channels.set("line", lineChannel)
    this.channels.set("matrix", matrixChannel)
    this.channels.set("teams", teamsChannel)
    this.channels.set("imessage", iMessageChannel)

    // Phase 8 channels
    this.channels.set("email", emailChannel)
    this.channels.set("sms", smsChannel)
    this.channels.set("phone", phoneChannel)

    for (const [name, channel] of this.channels) {
      try {
        await channel.start()
      } catch (error) {
        log.warn("channel failed to start", { name, error })
      }
    }

    sandbox.setChannelManager({
      sendWithConfirm: async (userId: string, message: string, action: string) => {
        for (const [, channel] of this.channels) {
          if (channel.isConnected()) {
            return channel.sendWithConfirm(userId, message, action)
          }
        }
        return false
      },
    })

    // Start health monitoring for all registered channels
    channelHealthMonitor.startMonitoring(this.channels)

    this.initialized = true
    log.info("channel manager initialized")
  }

  /** Expose the internal channel map for health monitoring. */
  getChannels(): ReadonlyMap<string, BaseChannel> {
    return this.channels
  }

  async send(userId: string, message: string): Promise<boolean> {
    const scan = outputScanner.scan(message)
    if (!scan.safe) {
      log.warn("Channel send payload sanitized", {
        userId,
        issues: scan.issues,
      })
    }
    const safeMessage = scan.sanitized

    const priorityOrder = [
      "telegram",
      "discord",
      "whatsapp",
      "sms", // Phase 8: SMS before email (more immediate)
      "webchat",
      "signal",
      "line",
      "matrix",
      "teams",
      "imessage",
      "email", // Phase 8: Email last (async medium, not phone - phone requires explicit call)
    ]
    for (const name of priorityOrder) {
      const channel = this.channels.get(name)
      if (!channel || !channel.isConnected()) {
        continue
      }

      try {
        const sent = await channelCircuitBreaker.execute(name, () =>
          channel.send(userId, safeMessage),
        )
        if (sent) {
          return true
        }
      } catch (err) {
        log.warn("channel send failed (circuit breaker)", { channel: name, error: String(err) })
        continue
      }
    }

    return false
  }

  async broadcast(message: string): Promise<void> {
    const scan = outputScanner.scan(message)
    if (!scan.safe) {
      log.warn("Broadcast payload sanitized", {
        issues: scan.issues,
      })
    }
    const safeMessage = scan.sanitized

    for (const [, channel] of this.channels) {
      try {
        await channel.send(config.DEFAULT_USER_ID, safeMessage)
      } catch (error) {
        log.error("broadcast failed for channel", error)
      }
    }
  }

  getConnectedChannels(): string[] {
    const connected: string[] = []
    for (const [name, channel] of this.channels) {
      if (channel.isConnected()) {
        connected.push(name)
      }
    }
    return connected
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name)
  }

  async stop(): Promise<void> {
    for (const [, channel] of this.channels) {
      try {
        await channel.stop()
      } catch (error) {
        log.error("failed to stop channel", error)
      }
    }
    this.channels.clear()
    this.initialized = false
    log.info("all channels stopped")
  }
}

export const channelManager = new ChannelManager()
