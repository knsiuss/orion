/**
 * @file loader.ts
 * @description Dynamic hook loader — scans workspace/hooks/ and extensions/{name}/hooks/.
 *
 * ARCHITECTURE:
 *   Loads all .md files with YAML frontmatter on startup.
 *   Uses hookLifecycle to register discovered hooks.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../logger.js'
import { parseFrontmatter } from './frontmatter.js'
import { hookLifecycle } from './lifecycle.js'

const log = createLogger('hooks.loader')

/** Directories to scan for hook files. */
const HOOK_DIRS = [
  join(process.cwd(), 'workspace', 'hooks'),
  join(process.cwd(), 'extensions'),
]

class HookLoader {
  /**
   * Load all hooks from configured directories.
   * Call once at startup.
   */
  async loadAll(): Promise<void> {
    let loaded = 0

    for (const dir of HOOK_DIRS) {
      if (!existsSync(dir)) continue
      loaded += await this.scanDir(dir)
    }

    log.info('hooks loaded', { count: loaded })
  }

  private async scanDir(dir: string): Promise<number> {
    let count = 0
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = join(dir, entry.name)
          const content = readFileSync(filePath, 'utf8')
          const manifest = parseFrontmatter(content, filePath)
          if (manifest) {
            await hookLifecycle.install(manifest)
            count++
          }
        }
      }
    } catch (err) {
      log.warn('hook scan failed', { dir, err })
    }
    return count
  }
}

export const hookLoader = new HookLoader()
