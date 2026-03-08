/**
 * @file config.ts
 * @description CLI config management — get/set/list user configuration.
 *
 * ARCHITECTURE:
 *   Stores config in ~/.edith/config.json (separate from .env secrets).
 *   Nested key access via dot notation: channels.telegram.enabled
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../../logger.js'

const log = createLogger('cli.config')

/** Returns the path to ~/.edith/config.json, creating the directory if needed. */
function getConfigPath(): string {
  const dir = join(homedir(), '.edith')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'config.json')
}

/** Reads the current config from disk, returning empty object on missing/parse error. */
function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(getConfigPath(), 'utf8')) as Record<string, unknown> }
  catch { return {} }
}

/** Writes the config object to disk as pretty-printed JSON. */
function writeConfig(cfg: Record<string, unknown>): void {
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2))
}

/**
 * Reads and prints the value at the given dot-notation key.
 * @param key - Dot-notation key, e.g. "channels.telegram.enabled"
 */
export function configGet(key: string): void {
  const cfg = readConfig()
  let val: unknown = cfg
  for (const part of key.split('.')) val = (val as Record<string, unknown>)?.[part]
  console.log(val ?? '(not set)')
}

/**
 * Sets a dot-notation key to a string value and persists to disk.
 * @param key - Dot-notation key
 * @param value - String value to assign
 */
export function configSet(key: string, value: string): void {
  const cfg = readConfig()
  const parts = key.split('.')
  let obj = cfg
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (typeof obj[p] !== 'object' || obj[p] === null) obj[p] = {}
    obj = obj[p] as Record<string, unknown>
  }
  obj[parts[parts.length - 1]!] = value
  writeConfig(cfg)
  console.log(`✓ Set ${key} = ${value}`)
  log.info('config set', { key, value })
}

/** Prints all config key-value pairs as JSON. */
export function configList(): void {
  const cfg = readConfig()
  if (Object.keys(cfg).length === 0) { console.log('(no config set)'); return }
  console.log(JSON.stringify(cfg, null, 2))
}
