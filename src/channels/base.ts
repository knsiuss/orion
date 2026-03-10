/**
 * Callback invoked by a channel implementation when an inbound message arrives.
 *
 * @param userId   - Sender identifier (platform-specific, normalised by channel).
 * @param text     - The plain-text message content.
 * @param metadata - Optional channel-specific extras (messageId, replyTo, media, etc.).
 */
export type MessageHandler = (
  userId: string,
  text: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

export interface BaseChannel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(userId: string, message: string): Promise<boolean>;
  sendWithConfirm(
    userId: string,
    message: string,
    action: string,
  ): Promise<boolean>;
  isConnected(): boolean;

  /**
   * Register an inbound message handler.
   *
   * Called by ChannelManager.init() so all channels route incoming messages
   * through a single handler instead of each wiring independently.
   * Implementing this method is optional — channels that don't support inbound
   * messages (e.g. email-send-only) can omit it.
   *
   * A channel MUST call `handler(userId, text, metadata)` for every message
   * received after this method is called. The handler is idempotent — calling
   * it multiple times for the same message is safe (deduplication happens upstream).
   *
   * @param handler - The function to invoke for each incoming message.
   */
  onMessage?(handler: MessageHandler): void;

  // Optional rich capabilities
  sendTyping?(userId: string): Promise<void>;
  sendMedia?(userId: string, media: ChannelMedia): Promise<boolean>;
  editMessage?(
    userId: string,
    messageId: string,
    newContent: string,
  ): Promise<boolean>;
  deleteMessage?(userId: string, messageId: string): Promise<boolean>;
  reactToMessage?(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<boolean>;
  replyToThread?(
    userId: string,
    threadId: string,
    message: string,
  ): Promise<boolean>;
  capabilities?(): ChannelCapabilities;
}

export type MediaType = "image" | "audio" | "video" | "file" | "voice_note";

export interface ChannelMedia {
  type: MediaType;
  data: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
}

export interface ChannelCapabilities {
  supportsMarkdown: boolean;
  supportsMedia: boolean;
  supportsThreads: boolean;
  supportsReactions: boolean;
  supportsEditing: boolean;
  supportsTypingIndicator: boolean;
  maxMessageLength: number;
}

/**
 * Abstract base class with default no-ops for optional methods.
 * Existing channels can extend this without breaking anything.
 *
 * Channels that support inbound messages should override onMessage() and
 * store the handler, then call it for every received message:
 *
 * ```typescript
 * private messageHandler: MessageHandler | null = null
 *
 * onMessage(handler: MessageHandler): void {
 *   this.messageHandler = handler
 * }
 *
 * // In your message receive callback:
 * if (this.messageHandler) {
 *   void this.messageHandler(userId, text, { messageId })
 *     .catch(err => log.warn("message handler failed", { err }))
 * }
 * ```
 */
export abstract class BaseChannelImpl implements BaseChannel {
  abstract readonly name: string;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(userId: string, message: string): Promise<boolean>;
  abstract sendWithConfirm(
    userId: string,
    message: string,
    action: string,
  ): Promise<boolean>;
  abstract isConnected(): boolean;

  /** Default no-op — override in channels that support inbound messages. */
  onMessage(_handler: MessageHandler): void {}

  async sendTyping(_userId: string): Promise<void> {}
  async sendMedia(_userId: string, _media: ChannelMedia): Promise<boolean> {
    return false;
  }
  async editMessage(
    _userId: string,
    _messageId: string,
    _newContent: string,
  ): Promise<boolean> {
    return false;
  }
  async deleteMessage(_userId: string, _messageId: string): Promise<boolean> {
    return false;
  }
  async reactToMessage(
    _userId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<boolean> {
    return false;
  }
  async replyToThread(
    _userId: string,
    _threadId: string,
    _message: string,
  ): Promise<boolean> {
    return false;
  }

  capabilities(): ChannelCapabilities {
    return {
      supportsMarkdown: false,
      supportsMedia: false,
      supportsThreads: false,
      supportsReactions: false,
      supportsEditing: false,
      supportsTypingIndicator: false,
      maxMessageLength: 2000,
    };
  }
}

export function splitMessage(content: string, maxLength = 2000): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = maxLength;
    const newlineIdx = remaining.lastIndexOf("\n", maxLength);
    const spaceIdx = remaining.lastIndexOf(" ", maxLength);

    if (newlineIdx > maxLength * 0.5) {
      splitIndex = newlineIdx + 1;
    } else if (spaceIdx > maxLength * 0.5) {
      splitIndex = spaceIdx + 1;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
}

export async function pollForConfirm(
  getReply: () => Promise<string | null>,
  timeoutMs = 60_000,
  intervalMs = 3000,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const reply = await getReply();
    if (reply) {
      const normalized = reply.trim().toLowerCase();
      if (
        normalized.includes("yes") ||
        normalized.includes("confirm") ||
        normalized.includes("send")
      ) {
        return true;
      }
      if (normalized.includes("no") || normalized.includes("cancel")) {
        return false;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}
