import { describe, expect, it } from 'vitest'
import type { Session, SessionStatus } from '@shared/types'
import { buildGroups } from '@shared/session-group'
import { memberRows } from './members'

const MIN = 60_000
const NOW = 100 * MIN
const session = (id: string, status: SessionStatus, extra: Partial<Session> = {}): Session => ({
  id, worktreeId: 'w', kind: 'claude', title: id, status, startedAt: NOW - 30 * MIN, lastActivityAt: NOW - 2 * MIN, ...extra
})

const sessions = [
  session('lead', 'running'),
  session('a', 'running', { dispatchedBy: 'lead', turnStartedAt: NOW - 5 * MIN }),
  session('b', 'needs_you', { dispatchedBy: 'lead', statusSince: NOW - 2 * MIN }),
  session('a1', 'idle', { dispatchedBy: 'a' })
]
const items = {
  lead: [
    { id: 'sub1', title: 'scan the repo', model: 'Opus 5.5', right: 'Opus 5.5' },
    { id: 'workflow:r', title: 'audit', kind: 'workflow' as const, right: '2 / 4' }
  ],
  a: [{ id: 'sub2', title: 'read tests', right: 'Fable 5.1' }]
}
const groups = buildGroups(
  sessions.map((s) => ({ id: s.id, status: s.status, ...(s.dispatchedBy ? { dispatchedBy: s.dispatchedBy } : {}) })),
  { lead: [{ id: 'sub1', status: 'running' }, { id: 'workflow:r', status: 'running' }], a: [{ id: 'sub2', status: 'running' }] }
)
const byId = new Map(sessions.map((s) => [s.id, s]))

describe('memberRows', () => {
  const rows = memberRows({ ownerId: 'lead', groups, sessions: byId, items, now: NOW })

  it('lists most urgent first, a dispatched session followed by its own members one step in', () => {
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ['b', 1],
      ['a', 1],
      ['read tests', 2],
      ['a1', 2],
      ['scan the repo', 1],
      ['audit', 1]
    ])
  })

  it('writes a session’s time, a subagent’s model and a workflow’s phase as the meta', () => {
    expect(rows.map((r) => r.meta)).toEqual(['已等 2m', '5m', 'Fable 5.1', expect.stringContaining('前'), 'Opus 5.5', '2 / 4'])
  })

  it('makes only dispatched sessions clickable', () => {
    expect(rows.filter((r) => r.sessionId).map((r) => r.sessionId)).toEqual(['b', 'a', 'a1'])
  })

  it('has no rows for a session without members and does not loop on a dispatch cycle', () => {
    expect(memberRows({ ownerId: 'b', groups, sessions: byId, items, now: NOW })).toEqual([])
    const cyc = [session('x', 'idle', { dispatchedBy: 'y' }), session('y', 'idle', { dispatchedBy: 'x' })]
    const g = buildGroups(cyc.map((s) => ({ id: s.id, status: s.status, dispatchedBy: s.dispatchedBy! })))
    expect(memberRows({ ownerId: 'x', groups: g, sessions: new Map(cyc.map((s) => [s.id, s])), items: {}, now: NOW }).length).toBeLessThanOrEqual(1)
  })
})
