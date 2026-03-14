/**
 * @file manager.ts
 * @description ChannelManager — unified registry for all communication channels.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Owns the lifecycle (start/stop) of every channel. Called by main.ts in
 *   "gateway" or "all" mode. Individual channels register themselves here;
 *   ChannelManager routes outbound messages via smart channel routing
 *   (channelRouter resolves last-active channel first).
 *
 *   Tahap 3.8 — Conditional registration:
 *   Channels are only registered when their required config keys are present.
 *   This prevents startup noise from channels without credentials and reduces
 *   the number of failed channel.start() calls on every boot.
 *
 *   Tahap 3.2 — Inbound handler wiring:
 *   After all channels are started, an inbound MessageHandler can be registered
 *   via setInboundHandler(). Channels that implement onMessage() will receive
 *   the handler and call it for every incoming message.
 *
 * @module channels/manager
 */

import type { BaseChannel, MessageHandler } from "./base.js";
import { WebChatChannel } from "./webchat.js";
import { whatsAppChannel } from "./whatsapp.js";
import { telegramChannel } from "./telegram.js";
import { discordChannel } from "./discord.js";
import { signalChannel } from "./signal.js";
import { lineChannel } from "./line.js";
import { matrixChannel } from "./matrix.js";
import { teamsChannel } from "./teams.js";
import { iMessageChannel } from "./imessage.js";
import { emailChannel } from "./email.js";
import { smsChannel } from "./sms.js";
import { phoneChannel } from "./phone.js";
import { createLogger } from "../logger.js";
import config from "../config.js";
import { sandbox } from "../permissions/sandbox.js";
import { outputScanner } from "../security/output-scanner.js";
import { slackChannel } from "./slack.js";
import { channelRouter } from "./router.js";

const log = createLogger("channels.manager");

/**
 * Candidate channel entry: the channel instance + a predicate that returns
 * true when the required environment config is present and the channel should
 * be registered.
 */
/**
 * Minimal channel shape required by init() — avoids surfacing a pre-existing
 * TypeScript conflict where some channels (e.g. TelegramChannel) declare
 * `private sendTyping` while BaseChannel has it as optional-public.
 * The full BaseChannel interface is enforced at the Map level via a cast.
 */
type ChannelLike = Pick<
  BaseChannel,
  "start" | "stop" | "send" | "sendWithConfirm" | "isConnected"
> & {
  onMessage?: (handler: MessageHandler) => void;
};

interface ChannelCandidate {
  name: string;
  channel: ChannelLike;
  /** Return true when this channel has sufficient config to attempt start(). */
  isConfigured(): boolean;
}

/**
 * Full list of channel candidates evaluated during init().
 * Only candidates where isConfigured() returns true are registered and started.
 * Order determines fallback priority in channelRouter when multiple channels connect.
 */
function buildChannelCandidates(): ChannelCandidate[] {
  return [
    // WebChat is always registered — it's the built-in local interface.
    {
      name: "webchat",
      channel: new WebChatChannel(),
      isConfigured: () => true,
    },

    // Messaging platforms — require at minimum a bot token or explicit enable flag.
    {
      name: "telegram",
      channel: telegramChannel,
      isConfigured: () => config.TELEGRAM_BOT_TOKEN.trim().length > 0,
    },
    {
      name: "discord",
      channel: discordChannel,
      isConfigured: () => config.DISCORD_BOT_TOKEN.trim().length > 0,
    },
    {
      name: "whatsapp",
      channel: whatsAppChannel,
      isConfigured: () =>
        config.WHATSAPP_ENABLED ||
        config.WHATSAPP_CLOUD_ACCESS_TOKEN.trim().length > 0,
    },
    {
      name: "slack",
      channel: slackChannel,
      isConfigured: () => config.SLACK_BOT_TOKEN.trim().length > 0,
    },
    {
      name: "signal",
      channel: signalChannel,
      isConfigured: () => config.SIGNAL_PHONE_NUMBER.trim().length > 0,
    },
    {
      name: "line",
      channel: lineChannel,
      isConfigured: () => config.LINE_CHANNEL_TOKEN.trim().length > 0,
    },
    {
      name: "matrix",
      channel: matrixChannel,
      isConfigured: () => config.MATRIX_ACCESS_TOKEN.trim().length > 0,
    },
    {
      name: "teams",
      channel: teamsChannel,
      isConfigured: () => config.TEAMS_APP_ID.trim().length > 0,
    },
    {
      name: "imessage",
      channel: iMessageChannel,
      isConfigured: () => config.BLUEBUBBLES_URL.trim().length > 0,
    },

    // Phase 8 channels — communication infrastructure.
    {
      name: "email",
      channel: emailChannel,
      isConfigured: () =>
        config.EMAIL_HOST.trim().length > 0 ||
        config.GMAIL_CLIENT_ID.trim().length > 0 ||
        config.OUTLOOK_CLIENT_ID.trim().length > 0,
    },
    {
      name: "sms",
      channel: smsChannel,
      isConfigured: () => config.TWILIO_ACCOUNT_SID.trim().length > 0,
    },
    {
      name: "phone",
      channel: phoneChannel,
      isConfigured: () =>
        config.TWILIO_TWIML_APP_SID.trim().length > 0 ||
        config.PHONE_WEBHOOK_URL.trim().length > 0,
    },
  ];
}

export class ChannelManager {
  private channels = new Map<string, BaseChannel>();
  private initialized = false;
  /** Optional inbound message handler — set via setInboundHandler(). */
  private inboundHandler: MessageHandler | null = null;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const candidates = buildChannelCandidates();
    let registered = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      if (!candidate.isConfigured()) {
        log.debug("channel skipped — no config", { name: candidate.name });
        skipped++;
        continue;
      }
      this.channels.set(candidate.name, candidate.channel as BaseChannel);
      registered++;
    }

    log.info("channel candidates evaluated", { registered, skipped });

    for (const [name, channel] of this.channels) {
      try {
        await channel.start();

        // Wire inbound handler if already set and channel supports it (Tahap 3.2).
        if (this.inboundHandler && channel.onMessage) {
          channel.onMessage(this.inboundHandler);
        }
      } catch (error) {
        log.warn("channel failed to start", { name, error });
      }
    }

    sandbox.setChannelManager({
      sendWithConfirm: async (
        userId: string,
        message: string,
        action: string,
      ) => {
        for (const [, channel] of this.channels) {
          if (channel.isConnected()) {
            return channel.sendWithConfirm(userId, message, action);
          }
        }
        return false;
      },
    });

    this.initialized = true;
    log.info("channel manager initialized", {
      channels: Array.from(this.channels.keys()),
      connected: this.getConnectedChannels(),
    });
  }

  /**
   * Register an inbound message handler for all channels that support it.
   *
   * Must be called after init() to wire already-started channels. If called
   * before init(), the handler is stored and wired during init().
   *
   * @param handler - Callback invoked for every inbound message from any channel.
   */
  setInboundHandler(handler: MessageHandler): void {
    this.inboundHandler = handler;
    for (const [name, channel] of this.channels) {
      if (channel.onMessage) {
        channel.onMessage(handler);
        log.debug("inbound handler wired", { name });
      }
    }
  }

  /** Record inbound activity for smart routing (call from every channel's inbound handler). */
  recordActivity(userId: string, channelName: string): void {
    channelRouter.recordActivity(userId, channelName);
  }

  async send(userId: string, message: string): Promise<boolean> {
    const scan = outputScanner.scan(message);
    if (!scan.safe) {
      log.warn("Channel send payload sanitized", {
        userId,
        issues: scan.issues,
      });
    }
    const safeMessage = scan.sanitized;

    // ATOM 3.4: Smart routing — last active channel first
    const resolved = channelRouter.resolve(
      { userId, urgency: "normal", contentType: "text" },
      this.channels,
    );

    for (const channel of resolved) {
      const sent = await channel.send(userId, safeMessage);
      if (sent) return true;
    }

    return false;
  }

  async broadcast(message: string): Promise<void> {
    const scan = outputScanner.scan(message);
    if (!scan.safe) {
      log.warn("Broadcast payload sanitized", {
        issues: scan.issues,
      });
    }
    const safeMessage = scan.sanitized;

    for (const [, channel] of this.channels) {
      try {
        await channel.send(config.DEFAULT_USER_ID, safeMessage);
      } catch (error) {
        log.error("broadcast failed for channel", error);
      }
    }
  }

  getConnectedChannels(): string[] {
    const connected: string[] = [];
    for (const [name, channel] of this.channels) {
      if (channel.isConnected()) {
        connected.push(name);
      }
    }
    return connected;
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name);
  }

  /** Returns per-channel status for health monitoring. */
  healthCheck(): Array<{ name: string; connected: boolean }> {
    const results: Array<{ name: string; connected: boolean }> = [];
    for (const [name, channel] of this.channels) {
      results.push({ name, connected: channel.isConnected() });
    }
    return results;
  }

  async stop(): Promise<void> {
    for (const [, channel] of this.channels) {
      try {
        await channel.stop();
      } catch (error) {
        log.error("failed to stop channel", error);
      }
    }
    this.channels.clear();
    this.initialized = false;
    log.info("all channels stopped");
  }
}

export const channelManager = new ChannelManager();
