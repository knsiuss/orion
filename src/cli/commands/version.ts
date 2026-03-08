/**
 * @file version.ts
 * @description CLI version information.
 *
 * ARCHITECTURE:
 *   Reads version from package.json and prints runtime info.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Prints EDITH version, Node.js version, platform, and architecture. */
export function showVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string; name?: string }
    console.log(`EDITH ${pkg.version ?? 'unknown'} (${pkg.name ?? 'edith'})`)
    console.log(`Node.js ${process.version} | ${process.platform} ${process.arch}`)
  } catch { console.log('EDITH (version unknown)') }
}
