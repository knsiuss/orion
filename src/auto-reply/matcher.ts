/**
 * @file matcher.ts
 * @description Matches incoming messages against active auto-reply templates.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by message-pipeline Stage 0 (pre-LLM) to check for auto-reply matches.
 *   - If a match is found, the pipeline short-circuits and returns the template response.
 */

import { createLogger } from "../logger.js"
import { templateStore } from "./templates.js"
import type { AutoReplyTemplate } from "./templates.js"

const log = createLogger("auto-reply.matcher")

/**
 * Evaluates incoming messages against a user's enabled auto-reply templates
 * and returns the first match (if any).
 */
export class AutoReplyMatcher {
  /**
   * Attempts to match an incoming message against the user's enabled templates.
   *
   * Evaluation order:
   * 1. Fetch enabled templates for the user.
   * 2. Filter by channel (empty channels array = matches all channels).
   * 3. Test each template's trigger against the message.
   * 4. Return the first matching template, or null.
   *
   * @param userId  - The user who owns the templates.
   * @param message - The incoming message text to evaluate.
   * @param channel - The channel ID the message arrived on.
   * @returns The first matching template, or null if no match is found.
   */
  async match(
    userId: string,
    message: string,
    channel: string,
  ): Promise<AutoReplyTemplate | null> {
    const templates = await templateStore.listEnabled(userId)

    for (const template of templates) {
      // Channel filter: empty array means "all channels"
      if (
        template.channels.length > 0 &&
        !template.channels.includes(channel)
      ) {
        continue
      }

      if (this.testTrigger(template, message)) {
        log.info("auto-reply matched", {
          templateId: template.id,
          userId,
          triggerType: template.triggerType,
          channel,
        })
        return template
      }
    }

    return null
  }

  /**
   * Tests whether a single template's trigger matches the given message.
   *
   * @param template - The template whose trigger to test.
   * @param message  - The incoming message text.
   * @returns True if the trigger matches.
   */
  private testTrigger(
    template: AutoReplyTemplate,
    message: string,
  ): boolean {
    const lowerMessage = message.toLowerCase()

    switch (template.triggerType) {
      case "keyword":
        return lowerMessage.includes(template.trigger.toLowerCase())

      case "exact":
        return lowerMessage === template.trigger.toLowerCase()

      case "regex":
        try {
          const re = new RegExp(template.trigger, "i")
          return re.test(message)
        } catch (err: unknown) {
          log.warn("invalid regex in template — skipping", {
            templateId: template.id,
            trigger: template.trigger,
            err,
          })
          return false
        }

      default:
        log.warn("unknown triggerType — skipping", {
          templateId: template.id,
          triggerType: (template as AutoReplyTemplate).triggerType,
        })
        return false
    }
  }
}

/** Singleton matcher instance. */
export const autoReplyMatcher = new AutoReplyMatcher()
