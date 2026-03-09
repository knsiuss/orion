/**
 * @file frontmatter.ts
 * @description Parse YAML frontmatter from hook Markdown files.
 *
 * ARCHITECTURE:
 *   HookLoader uses this to parse hook manifests from .md files.
 *   Format: YAML between --- markers at file start.
 */
import { createLogger } from '../logger.js'

const log = createLogger('hooks.frontmatter')

export interface HookFrontmatterRaw {
  id?: unknown
  name?: unknown
  events?: unknown
  schedule?: unknown
  enabled?: unknown
  priority?: unknown
}

/**
 * Parse a hook manifest from a Markdown file with YAML frontmatter.
 * @param content - Full file content including frontmatter
 * @param filePath - Path to the hook file (for manifest.path)
 * @returns Parsed HookManifest or null if invalid
 */
export function parseFrontmatter(content: string, filePath: string): import('./types.js').HookManifest | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  try {
    // Simple YAML key-value parser (avoid js-yaml dep for this simple case)
    const raw: HookFrontmatterRaw = {}
    for (const line of (match[1] ?? '').split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+)$/)
      if (kv) {
        const [, key, val] = kv
        raw[key as keyof HookFrontmatterRaw] = (val ?? '').trim()
      }
      // Handle YAML list items
      const listItem = line.match(/^\s+-\s+(.+)$/)
      if (listItem && !raw.events) {
        raw.events = []
      }
    }
    // Parse events list properly
    const eventsMatch = (match[1] ?? '').match(/events:\n((?:\s+-\s+.+\n?)+)/)
    if (eventsMatch) {
      raw.events = (eventsMatch[1] ?? '').split('\n')
        .map(l => l.replace(/^\s+-\s+/, '').trim())
        .filter(Boolean)
    } else {
      const inlineEvents = (match[1] ?? '').match(/events:\s*\[([^\]]+)\]/)
      if (inlineEvents) {
        raw.events = (inlineEvents[1] ?? '').split(',').map(e => e.trim())
      }
    }

    if (!raw.id || !raw.events) return null

    return {
      id: String(raw.id),
      name: String(raw.name ?? raw.id),
      events: Array.isArray(raw.events) ? (raw.events as string[]) as import('./types.js').HookEvent[] : [],
      schedule: raw.schedule ? String(raw.schedule) : undefined,
      enabled: String(raw.enabled) !== 'false',
      priority: Number(raw.priority ?? 50),
      path: filePath,
    }
  } catch (err) {
    log.warn('frontmatter parse failed', { filePath, err })
    return null
  }
}
