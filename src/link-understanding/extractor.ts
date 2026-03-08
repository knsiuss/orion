/**
 * @file extractor.ts
 * @description Extracts Open Graph and meta tag metadata from URLs.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by message-pipeline when URLs are detected in user messages.
 *   - Returns structured metadata (title, description, image, siteName, type).
 *   - Uses native fetch with timeout to avoid blocking the pipeline.
 */

import { createLogger } from "../logger.js"
import { guardUrl } from "../security/tool-guard.js"

const log = createLogger("link-understanding.extractor")

/** Regex to detect HTTP(S) URLs in free text. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

/** Private/reserved IP ranges that must never be fetched (SSRF protection). */
const BLOCKED_DOMAINS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "10.",
  "192.168.",
  "172.16",
  "172.17",
  "172.18",
  "172.19",
  "172.20",
  "172.21",
  "172.22",
  "172.23",
  "172.24",
  "172.25",
  "172.26",
  "172.27",
  "172.28",
  "172.29",
  "172.30",
  "172.31",
  "169.254.",
]

/** Timeout in milliseconds for fetching a URL. */
const FETCH_TIMEOUT_MS = 10_000

/** Maximum number of URLs to extract from a single message. */
const MAX_URLS_PER_MESSAGE = 10

/** In-memory cache TTL for metadata (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000

/** Structured metadata extracted from a URL's Open Graph / meta tags. */
export interface LinkMetadata {
  /** The original URL that was fetched. */
  url: string
  /** Page title from og:title or <title>. */
  title: string | null
  /** Page description from og:description or <meta name="description">. */
  description: string | null
  /** Primary image URL from og:image. */
  image: string | null
  /** Site name from og:site_name. */
  siteName: string | null
  /** Content type from og:type (e.g. "article", "website"). */
  type: string | null
  /** Unix timestamp (ms) when this metadata was fetched. */
  fetchedAt: number
}

/** Cache entry wrapping LinkMetadata with a timestamp. */
interface CacheEntry {
  /** The cached metadata (null if fetch failed). */
  metadata: LinkMetadata
  /** When this entry was cached (unix ms). */
  cachedAt: number
}

/**
 * Lightweight Open Graph / meta-tag metadata extractor.
 *
 * Uses regex-based HTML parsing to avoid pulling in a full DOM library.
 * Provides SSRF protection via domain blocking and tool-guard integration.
 */
export class LinkExtractor {
  /** In-memory metadata cache keyed by URL. */
  private cache = new Map<string, CacheEntry>()

  /**
   * Finds all HTTP(S) URLs in a text string.
   * Deduplicates results, validates each URL, blocks private IPs,
   * and caps at {@link MAX_URLS_PER_MESSAGE}.
   *
   * @param text - The raw text to scan for URLs.
   * @returns Array of unique, validated URL strings.
   */
  extractUrls(text: string): string[] {
    const matches = text.match(URL_REGEX)
    if (!matches) {
      return []
    }

    const validUrls: string[] = []
    for (const url of matches) {
      try {
        const parsed = new URL(url)
        const hostname = parsed.hostname.toLowerCase()

        const isBlocked = BLOCKED_DOMAINS.some(
          (blocked) => hostname === blocked || hostname.startsWith(blocked),
        )

        const guard = guardUrl(url)

        if (!isBlocked && guard.allowed) {
          validUrls.push(url)
        }
      } catch {
        continue
      }
    }

    return [...new Set(validUrls)].slice(0, MAX_URLS_PER_MESSAGE)
  }

  /**
   * Fetches a URL and extracts Open Graph / meta tag metadata.
   *
   * Attempts to read og:title, og:description, og:image, og:site_name, og:type.
   * Falls back to `<title>` and `<meta name="description">` when OG tags are absent.
   * Uses a 10-second timeout to avoid blocking the pipeline.
   *
   * @param url - The URL to fetch and extract metadata from.
   * @returns Structured {@link LinkMetadata}. Fields are null when not found.
   *          On fetch failure, returns partial metadata with nulls.
   */
  async extractMetadata(url: string): Promise<LinkMetadata> {
    const emptyResult: LinkMetadata = {
      url,
      title: null,
      description: null,
      image: null,
      siteName: null,
      type: null,
      fetchedAt: Date.now(),
    }

    try {
      const cached = this.cache.get(url)
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        log.debug("cache hit", { url })
        return cached.metadata
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; EDITHBot/1.0)",
          },
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        log.warn("fetch failed", { url, status: response.status })
        return emptyResult
      }

      const html = await response.text()
      const metadata = this.parseMetaTags(html, url)

      this.cache.set(url, { metadata, cachedAt: Date.now() })
      log.debug("metadata extracted", { url, title: metadata.title })

      return metadata
    } catch (error) {
      log.error("extractMetadata error", { url, error })
      return emptyResult
    }
  }

  /**
   * Parses Open Graph meta tags and standard HTML tags from raw HTML.
   *
   * Extraction priority:
   *   1. `og:title` → falls back to `<title>`
   *   2. `og:description` → falls back to `<meta name="description">`
   *   3. `og:image` (no fallback)
   *   4. `og:site_name` (no fallback)
   *   5. `og:type` (no fallback)
   *
   * @param html - Raw HTML string.
   * @param url - The source URL (used in result).
   * @returns Structured {@link LinkMetadata}.
   */
  private parseMetaTags(html: string, url: string): LinkMetadata {
    const ogTitle = this.extractOgTag(html, "og:title")
    const ogDescription = this.extractOgTag(html, "og:description")
    const ogImage = this.extractOgTag(html, "og:image")
    const ogSiteName = this.extractOgTag(html, "og:site_name")
    const ogType = this.extractOgTag(html, "og:type")

    const fallbackTitle = this.extractHtmlTitle(html)
    const fallbackDescription = this.extractMetaDescription(html)

    return {
      url,
      title: ogTitle ?? fallbackTitle,
      description: ogDescription ?? fallbackDescription,
      image: ogImage,
      siteName: ogSiteName,
      type: ogType,
      fetchedAt: Date.now(),
    }
  }

  /**
   * Extracts an Open Graph meta tag value by property name.
   *
   * Handles both `property="og:..."` and `name="og:..."` attribute styles,
   * and both `content="..."` orderings (before or after the property attr).
   *
   * @param html - Raw HTML string.
   * @param property - The OG property name (e.g. "og:title").
   * @returns The content value, or null if not found.
   */
  private extractOgTag(html: string, property: string): string | null {
    // Pattern 1: <meta property="og:title" content="...">
    const pattern1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${this.escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
      "i",
    )
    const match1 = html.match(pattern1)
    if (match1?.[1]) {
      return this.decodeHtmlEntities(match1[1])
    }

    // Pattern 2: <meta content="..." property="og:title">
    const pattern2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${this.escapeRegex(property)}["']`,
      "i",
    )
    const match2 = html.match(pattern2)
    if (match2?.[1]) {
      return this.decodeHtmlEntities(match2[1])
    }

    return null
  }

  /**
   * Extracts the content of the `<title>` HTML tag.
   *
   * @param html - Raw HTML string.
   * @returns The title text, or null if not found.
   */
  private extractHtmlTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (match?.[1]) {
      return this.decodeHtmlEntities(match[1]).trim()
    }
    return null
  }

  /**
   * Extracts the content of `<meta name="description" content="...">`.
   *
   * @param html - Raw HTML string.
   * @returns The description text, or null if not found.
   */
  private extractMetaDescription(html: string): string | null {
    // Pattern 1: name before content
    const pattern1 =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
    const match1 = html.match(pattern1)
    if (match1?.[1]) {
      return this.decodeHtmlEntities(match1[1])
    }

    // Pattern 2: content before name
    const pattern2 =
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i
    const match2 = html.match(pattern2)
    if (match2?.[1]) {
      return this.decodeHtmlEntities(match2[1])
    }

    return null
  }

  /**
   * Decodes common HTML entities to their character equivalents.
   *
   * @param input - String potentially containing HTML entities.
   * @returns Decoded string.
   */
  private decodeHtmlEntities(input: string): string {
    return input
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#(\d+);/g, (_match, dec: string) =>
        String.fromCharCode(parseInt(dec, 10)),
      )
  }

  /**
   * Escapes special regex characters in a string.
   *
   * @param str - The string to escape.
   * @returns Regex-safe string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}

/** Singleton LinkExtractor instance. */
export const linkExtractor = new LinkExtractor()
