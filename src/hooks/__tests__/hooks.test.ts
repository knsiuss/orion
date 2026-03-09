/**
 * @file hooks.test.ts
 * @description Unit/integration tests for hooks\.__tests__\.hooks.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { manifestHookRegistry } from '../manifest-registry.js'
import { parseFrontmatter } from '../frontmatter.js'

describe('ManifestHookRegistry', () => {
  beforeEach(() => {
    for (const h of manifestHookRegistry.list()) manifestHookRegistry.unregister(h.id)
  })

  it('registers and retrieves hooks by event', () => {
    manifestHookRegistry.register({
      id: 'test-hook',
      name: 'Test',
      events: ['before_message'],
      enabled: true,
      priority: 10,
      path: '/test/hook.ts',
    })
    const hooks = manifestHookRegistry.getForEvent('before_message')
    expect(hooks).toHaveLength(1)
    expect(hooks[0]!.id).toBe('test-hook')
  })

  it('filters disabled hooks', () => {
    manifestHookRegistry.register({ id: 'disabled', name: 'D', events: ['after_message'], enabled: false, priority: 1, path: '/t' })
    expect(manifestHookRegistry.getForEvent('after_message')).toHaveLength(0)
  })

  it('sorts by priority ascending', () => {
    manifestHookRegistry.register({ id: 'low', name: 'L', events: ['on_error'], enabled: true, priority: 100, path: '/l' })
    manifestHookRegistry.register({ id: 'high', name: 'H', events: ['on_error'], enabled: true, priority: 1, path: '/h' })
    const hooks = manifestHookRegistry.getForEvent('on_error')
    expect(hooks[0]!.id).toBe('high')
  })

  it('unregisters correctly', () => {
    manifestHookRegistry.register({ id: 'to-remove', name: 'R', events: ['on_session_start'], enabled: true, priority: 50, path: '/r' })
    manifestHookRegistry.unregister('to-remove')
    expect(manifestHookRegistry.getForEvent('on_session_start')).toHaveLength(0)
  })
})

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---\nid: my-hook\nname: My Hook\nevents:\n  - before_message\nenabled: true\npriority: 10\n---\nDescription`
    const result = parseFrontmatter(content, '/path/hook.md')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('my-hook')
    expect(result!.priority).toBe(10)
  })

  it('returns null for missing frontmatter', () => {
    expect(parseFrontmatter('No frontmatter here', '/path')).toBeNull()
  })

  it('defaults enabled=true and priority=50', () => {
    const content = `---\nid: basic\nevents:\n  - on_cron\n---`
    const result = parseFrontmatter(content, '/path')
    expect(result!.enabled).toBe(true)
    expect(result!.priority).toBe(50)
  })
})
