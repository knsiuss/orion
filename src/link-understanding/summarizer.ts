/**
 * @file summarizer.ts
 * @description LLM-based URL content summarization.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Uses orchestrator.generate('fast', ...) for quick summarization.
 *   - Called as a fire-and-forget side effect; injects summary into context.
 */

import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import type { LinkMetadata } from "./extractor.js"

const log = createLogger("link-understanding.summarizer")

/** Prompt template for metadata-based summarization. */
const SUMMARIZE_PROMPT = `Summarize this web page in 1-2 concise sentences based on its metadata.

Title: {title}
Description: {description}
Site: {site}
Type: {type}
URL: {url}

Summary:`

/**
 * Generates LLM-powered summaries of link metadata.
 *
 * Uses the orchestrator's "fast" task type for low-latency summarization.
 * Gracefully degrades to a markdown link on failure.
 */
export class LinkSummarizer {
  /**
   * Produces a 1-2 sentence summary of a link from its metadata.
   *
   * Sends the link's Open Graph / meta tag metadata to the LLM via the
   * orchestrator's "fast" route. On failure, returns a fallback markdown link.
   *
   * @param metadata - Structured metadata from {@link LinkMetadata}.
   * @returns A concise summary string, or a markdown link fallback.
   */
  async summarizeLink(metadata: LinkMetadata): Promise<string> {
    try {
      const prompt = SUMMARIZE_PROMPT
        .replace("{title}", metadata.title ?? "Unknown")
        .replace("{description}", metadata.description ?? "No description available")
        .replace("{site}", metadata.siteName ?? "Unknown site")
        .replace("{type}", metadata.type ?? "unknown")
        .replace("{url}", metadata.url)

      const summary = await orchestrator.generate("fast", { prompt })
      log.debug("summarization complete", { url: metadata.url })
      return summary.trim()
    } catch (error) {
      log.error("summarizeLink failed", { url: metadata.url, error })
      return `[${metadata.title ?? metadata.url}](${metadata.url})`
    }
  }
}

/** Singleton LinkSummarizer instance. */
export const linkSummarizer = new LinkSummarizer()
