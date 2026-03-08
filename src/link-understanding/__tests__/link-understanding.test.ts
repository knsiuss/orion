/**
 * @file link-understanding.test.ts
 * @description Tests for LinkExtractor (URL detection + OG/meta extraction)
 *              and LinkSummarizer (LLM-based metadata summarization).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - LinkExtractor depends on global fetch and src/security/tool-guard.js
 *   - LinkSummarizer depends on src/engines/orchestrator.js
 *   - Both deps are fully mocked; no real network or LLM calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock: security/tool-guard ────────────────────────────────────────────────
// Default: every URL is allowed; individual tests override when needed.
vi.mock("../../security/tool-guard.js", () => ({
  guardUrl: vi.fn().mockReturnValue({ allowed: true }),
}))

// ── Mock: logger ─────────────────────────────────────────────────────────────
vi.mock("../../logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock: orchestrator ───────────────────────────────────────────────────────
vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("A short LLM-generated summary."),
  },
}))

import { guardUrl } from "../../security/tool-guard.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { LinkExtractor } from "../extractor.js"
import { LinkSummarizer } from "../summarizer.js"
import type { LinkMetadata } from "../extractor.js"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal LinkMetadata fixture. */
function makeMetadata(overrides: Partial<LinkMetadata> = {}): LinkMetadata {
  return {
    url: "https://example.com/page",
    title: "Example Page",
    description: "An example description.",
    image: "https://example.com/image.png",
    siteName: "Example",
    type: "article",
    fetchedAt: Date.now(),
    ...overrides,
  }
}

/** Build a mock Response with the given HTML body and ok flag. */
function mockResponse(html: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    text: vi.fn().mockResolvedValue(html),
  } as unknown as Response
}

// ── LinkExtractor — extractUrls ───────────────────────────────────────────────

describe("LinkExtractor.extractUrls", () => {
  let extractor: LinkExtractor

  beforeEach(() => {
    extractor = new LinkExtractor()
    vi.mocked(guardUrl).mockReturnValue({ allowed: true })
  })

  it("finds a single URL in a string", () => {
    const result = extractor.extractUrls("Check this out: https://example.com")
    expect(result).toEqual(["https://example.com"])
  })

  it("finds multiple URLs in a string", () => {
    const result = extractor.extractUrls(
      "Go to https://foo.com and also https://bar.com for more info.",
    )
    expect(result).toHaveLength(2)
    expect(result).toContain("https://foo.com")
    expect(result).toContain("https://bar.com")
  })

  it("returns empty array when no URLs are present", () => {
    const result = extractor.extractUrls("No links here, just plain text.")
    expect(result).toEqual([])
  })

  it("finds a URL at the start of the string", () => {
    const result = extractor.extractUrls("https://start.com is the start URL")
    expect(result).toContain("https://start.com")
  })

  it("finds a URL in the middle of the string", () => {
    const result = extractor.extractUrls(
      "Before https://middle.com after text",
    )
    expect(result).toContain("https://middle.com")
  })

  it("finds a URL at the end of the string", () => {
    const result = extractor.extractUrls("See the link at https://end.com")
    expect(result).toContain("https://end.com")
  })

  it("deduplicates repeated URLs", () => {
    const result = extractor.extractUrls(
      "https://dup.com is mentioned and https://dup.com again",
    )
    expect(result).toEqual(["https://dup.com"])
  })

  it("excludes localhost URLs (SSRF protection)", () => {
    const result = extractor.extractUrls(
      "Internal: http://localhost:3000/api",
    )
    expect(result).toEqual([])
  })

  it("excludes 127.0.0.1 URLs (SSRF protection)", () => {
    const result = extractor.extractUrls(
      "Internal: http://127.0.0.1/secret",
    )
    expect(result).toEqual([])
  })

  it("excludes URLs that guardUrl marks as disallowed", () => {
    vi.mocked(guardUrl).mockReturnValue({
      allowed: false,
      reason: "blocked by policy",
    })
    const result = extractor.extractUrls("https://blocked.example.com")
    expect(result).toEqual([])
  })

  it("returns empty array for an empty string", () => {
    const result = extractor.extractUrls("")
    expect(result).toEqual([])
  })
})

// ── LinkExtractor — extractMetadata (via public method) ───────────────────────

describe("LinkExtractor.extractMetadata", () => {
  let extractor: LinkExtractor

  beforeEach(() => {
    extractor = new LinkExtractor()
    vi.mocked(guardUrl).mockReturnValue({ allowed: true })
    // Reset global fetch mock before each test
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns og:title and og:description when present", async () => {
    const html = `<html>
      <head>
        <meta property="og:title" content="OG Title"/>
        <meta property="og:description" content="OG Description"/>
      </head>
    </html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.title).toBe("OG Title")
    expect(meta.description).toBe("OG Description")
  })

  it("falls back to <title> when og:title is absent", async () => {
    const html = `<html><head><title>Fallback Title</title></head></html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.title).toBe("Fallback Title")
  })

  it("falls back to meta description when og:description is absent", async () => {
    const html = `<html>
      <head>
        <meta name="description" content="Meta Desc"/>
      </head>
    </html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.description).toBe("Meta Desc")
  })

  it("returns og:image when present", async () => {
    const html = `<html>
      <head>
        <meta property="og:image" content="https://example.com/img.png"/>
      </head>
    </html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.image).toBe("https://example.com/img.png")
  })

  it("returns null fields when no meta tags are present", async () => {
    const html = `<html><body><p>No metadata here.</p></body></html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.title).toBeNull()
    expect(meta.description).toBeNull()
    expect(meta.image).toBeNull()
    expect(meta.siteName).toBeNull()
    expect(meta.type).toBeNull()
  })

  it("returns partial metadata (all null fields) on non-OK HTTP response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse("", false))

    const meta = await extractor.extractMetadata("https://example.com/404")
    expect(meta.title).toBeNull()
    expect(meta.url).toBe("https://example.com/404")
  })

  it("returns partial metadata (all null fields) when fetch throws", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"))

    const meta = await extractor.extractMetadata("https://unreachable.com")
    expect(meta.title).toBeNull()
    expect(meta.url).toBe("https://unreachable.com")
  })

  it("returns cached metadata on second call without re-fetching", async () => {
    const html = `<html><head><title>Cached Page</title></head></html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    await extractor.extractMetadata("https://cached.com")
    await extractor.extractMetadata("https://cached.com")

    // fetch should only have been called once — second call served from cache
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("decodes HTML entities in title", async () => {
    const html = `<html>
      <head>
        <meta property="og:title" content="Tom &amp; Jerry &lt;Adventures&gt;"/>
      </head>
    </html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.title).toBe("Tom & Jerry <Adventures>")
  })

  it("handles content attribute appearing before property attribute", async () => {
    const html = `<html>
      <head>
        <meta content="Reversed OG Title" property="og:title"/>
      </head>
    </html>`
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(html))

    const meta = await extractor.extractMetadata("https://example.com")
    expect(meta.title).toBe("Reversed OG Title")
  })
})

// ── LinkSummarizer ────────────────────────────────────────────────────────────

describe("LinkSummarizer.summarizeLink", () => {
  let summarizer: LinkSummarizer
  const generateMock = vi.mocked(orchestrator.generate)

  beforeEach(() => {
    summarizer = new LinkSummarizer()
    generateMock.mockResolvedValue("A concise LLM summary.")
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("calls orchestrator.generate with task type 'fast'", async () => {
    await summarizer.summarizeLink(makeMetadata())
    expect(generateMock).toHaveBeenCalledWith(
      "fast",
      expect.objectContaining({ prompt: expect.any(String) }),
    )
  })

  it("returns the trimmed LLM response as the summary", async () => {
    generateMock.mockResolvedValue("  Summary with whitespace.  ")
    const result = await summarizer.summarizeLink(makeMetadata())
    expect(result).toBe("Summary with whitespace.")
  })

  it("includes the URL in the prompt sent to the LLM", async () => {
    const meta = makeMetadata({ url: "https://unique-url.com/article" })
    await summarizer.summarizeLink(meta)

    const [, options] = generateMock.mock.calls[0] as [string, { prompt: string }]
    expect(options.prompt).toContain("https://unique-url.com/article")
  })

  it("includes the page title in the prompt", async () => {
    const meta = makeMetadata({ title: "TypeScript Deep Dive" })
    await summarizer.summarizeLink(meta)

    const [, options] = generateMock.mock.calls[0] as [string, { prompt: string }]
    expect(options.prompt).toContain("TypeScript Deep Dive")
  })

  it("includes the page description in the prompt", async () => {
    const meta = makeMetadata({ description: "An in-depth guide to TypeScript." })
    await summarizer.summarizeLink(meta)

    const [, options] = generateMock.mock.calls[0] as [string, { prompt: string }]
    expect(options.prompt).toContain("An in-depth guide to TypeScript.")
  })

  it("uses 'Unknown' placeholder for null title in prompt", async () => {
    const meta = makeMetadata({ title: null })
    await summarizer.summarizeLink(meta)

    const [, options] = generateMock.mock.calls[0] as [string, { prompt: string }]
    expect(options.prompt).toContain("Unknown")
  })

  it("uses 'No description available' placeholder for null description in prompt", async () => {
    const meta = makeMetadata({ description: null })
    await summarizer.summarizeLink(meta)

    const [, options] = generateMock.mock.calls[0] as [string, { prompt: string }]
    expect(options.prompt).toContain("No description available")
  })

  it("returns markdown link fallback when orchestrator throws", async () => {
    generateMock.mockRejectedValue(new Error("LLM unavailable"))

    const meta = makeMetadata({
      url: "https://fallback.com/page",
      title: "Fallback Title",
    })
    const result = await summarizer.summarizeLink(meta)
    expect(result).toBe("[Fallback Title](https://fallback.com/page)")
  })

  it("returns markdown link with URL as text when title is null and orchestrator throws", async () => {
    generateMock.mockRejectedValue(new Error("LLM unavailable"))

    const meta = makeMetadata({
      url: "https://fallback.com/notitle",
      title: null,
    })
    const result = await summarizer.summarizeLink(meta)
    expect(result).toBe(
      "[https://fallback.com/notitle](https://fallback.com/notitle)",
    )
  })

  it("handles empty string returned by LLM (returns empty string)", async () => {
    generateMock.mockResolvedValue("   ")
    const result = await summarizer.summarizeLink(makeMetadata())
    // trim() of whitespace-only string is ""
    expect(result).toBe("")
  })
})
