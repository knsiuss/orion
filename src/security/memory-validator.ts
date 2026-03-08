/**
 * @file memory-validator.ts
 * @description Validates memory entries before they are persisted to prevent injection of malicious or policy-violating content.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by src/memory/store.ts at write time (save()). Delegates content
 *   inspection to prompt-filter.ts (filterPrompt) and enforces size/format
 *   constraints before the entry reaches LanceDB.
 */
import { createLogger } from "../logger.js"
import { filterPrompt } from "./prompt-filter.js"

const log = createLogger("security.memory-validator")

export interface MemoryEntry {
  content: string
  metadata: Record<string, unknown>
}

export interface ValidatedMemories {
  clean: MemoryEntry[]
  flagged: Array<{ entry: MemoryEntry; reason: string }>
}

export function validateMemoryEntries(entries: MemoryEntry[]): ValidatedMemories {
  const clean: MemoryEntry[] = []
  const flagged: Array<{ entry: MemoryEntry; reason: string }> = []

  for (const entry of entries) {
    try {
      const result = filterPrompt(entry.content, "memory-validator")

      if (!result.safe && result.reason) {
        log.warn("Memory entry flagged", {
          metadata: entry.metadata,
          reason: result.reason,
        })
        flagged.push({ entry, reason: result.reason })
      } else {
        clean.push({
          ...entry,
          content: result.sanitized,
        })
      }
    } catch (error) {
      log.error("validateMemoryEntries error for entry", {
        metadata: entry.metadata,
        error,
      })
      flagged.push({ entry, reason: "Validation error" })
    }
  }

  if (flagged.length > 0) {
    log.info("Memory validation complete", {
      clean: clean.length,
      flagged: flagged.length,
    })
  }

  return { clean, flagged }
}
