import { describe, expect, it } from 'vitest'
import { buildGroups, dispatchAncestors, type GroupSession } from './session-group'

const s = (id: string, status: GroupSession['status'] = 'idle', dispatchedBy?: string): GroupSession => ({ id, status, ...(dispatchedBy ? { dispatchedBy } : {}) })

describe('buildGroups', () => {
  it('has no group for a session without members', () => {
    expect(buildGroups([s('a'), s('b')])).toEqual({})
  })

  it('counts members at every depth, most urgent status first', () => {
    const groups = buildGroups(
      [s('main'), s('c1', 'done_unread', 'main'), s('c2', 'running', 'main'), s('g1', 'needs_you', 'c1'), s('g2', 'error', 'g1')],
      { main: [{ id: 'sub', status: 'running' }], c2: [{ id: 'mate', status: 'idle' }] }
    )
    expect(groups['main']!.counts).toEqual([
      { status: 'needs_you', count: 1 },
      { status: 'error', count: 1 },
      { status: 'running', count: 2 },
      { status: 'done_unread', count: 1 },
      { status: 'idle', count: 1 }
    ])
    expect(groups['main']!.total).toBe(6)
    // A member's own group counts only what is below it.
    expect(groups['c1']!.total).toBe(2)
    expect(groups['g2']).toBeUndefined()
  })

  it('lists one level of direct members: child sessions, then the other items', () => {
    const groups = buildGroups([s('main'), s('c1', 'idle', 'main'), s('g1', 'idle', 'c1')], { main: [{ id: 'sub', status: 'running' }], c1: [{ id: 'k', status: 'running' }] })
    expect(groups['main']!.children).toEqual(['c1'])
    expect(groups['main']!.items).toEqual([{ id: 'sub', status: 'running' }])
    expect(groups['c1']!.children).toEqual(['g1'])
  })

  it('leaves a child whose dispatcher is not listed at the top level', () => {
    const groups = buildGroups([s('orphan', 'needs_you', 'elsewhere'), s('main')])
    expect(groups).toEqual({})
  })

  it('does not count pending confirms: callers leave them out of the items', () => {
    // A pending `wavi run` is no member; the sidebar passes only subagents, teammates and workflow runs.
    expect(buildGroups([s('main')], { main: [] })).toEqual({})
  })

  it('survives a dispatch cycle', () => {
    const groups = buildGroups([s('a', 'idle', 'b'), s('b', 'running', 'a')])
    expect(groups['a']!.total).toBe(1)
    expect(groups['b']!.total).toBe(1)
  })
})

describe('dispatchAncestors', () => {
  it('lists dispatchers nearest first and stops at one that is not listed', () => {
    const all = [s('main'), s('c', 'idle', 'main'), s('g', 'idle', 'c'), s('x', 'idle', 'gone')]
    expect(dispatchAncestors(all, 'g')).toEqual(['c', 'main'])
    expect(dispatchAncestors(all, 'x')).toEqual([])
    expect(dispatchAncestors(all, 'main')).toEqual([])
  })
})
