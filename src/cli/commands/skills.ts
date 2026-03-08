/**
 * @file skills.ts
 * @description CLI skill management commands.
 *
 * ARCHITECTURE:
 *   Lists skills from workspace/skills/ directory.
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Lists all installed skills from workspace/skills/. */
export function skillsList(): void {
  const skillsDir = join(process.cwd(), 'workspace', 'skills')
  if (!existsSync(skillsDir)) { console.log('No skills directory found.'); return }
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name)
  if (skills.length === 0) { console.log('No skills installed.'); return }
  console.log(`\nAvailable Skills (${skills.length}):`)
  for (const skill of skills.sort()) console.log(`  • ${skill}`)
}
