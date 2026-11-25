// src/renderer/issue-watch/model.test.ts
import { describe, expect, it } from 'vitest'
import type { Session, Worktree } from '@shared/types'
import type { IssueRecord } from '@shared/issue-watch'
import { issueLink, reconcileStep, recordFor, recordForSession, sessionForIssue, sessionOf, worktreeOfSession } from './model'

const at = (m: number): number => new Date(2026, 10, 10, 10, m).getTime()

const record = (over: Partial<IssueRecord> = {}): IssueRecord => ({
  key: 'github.com/acme/widget#1',
  projectId: 'p1',
  repo: 'github.com/acme/widget',
  number: 1,
  title: 'Checkout is blank',
  url: 'https://github.com/acme/widget/issues/1',
  author: 'alice',
  createdAt: at(1),
  claimedAt: at(2),
  state: 'working',
  rounds: 0,
  sessionId: 's1',
  ...over
})

const session = (over: Partial<Session> = {}): Pick<Session, 'status' | 'finishedAt'> => ({ status: 'running', ...over })

describe('reconcileStep', () => {
  it('waits while the session runs, and runs once a turn ended after the claim', () => {
    expect(reconcileStep(record(), session(), false)).toEqual({ type: 'wait' })
    expect(reconcileStep(record(), session({ status: 'done_unread', finishedAt: at(5) }), false)).toEqual({ type: 'run' })
    expect(reconcileStep(record(), session({ status: 'idle', finishedAt: at(5) }), false)).toEqual({ type: 'run' })
  })

  it('does not mistake the idle moment before the first turn for an ended turn', () => {
    // A reload right after the session was opened: idle, nothing finished yet.
    expect(reconcileStep(record(), session({ status: 'idle' }), false)).toEqual({ type: 'wait' })
    // Finished before the claim (an older session reused?): not this record's turn.
    expect(reconcileStep(record(), session({ status: 'idle', finishedAt: at(1) }), false)).toEqual({ type: 'wait' })
  })

  it('picks a turn that ended while the window was away up again', () => {
    const fixing = record({
      state: 'fixing',
      rounds: 1,
      acceptance: { passed: false, command: 'npm test', at: at(6), rounds: 0 },
      fixSentAt: at(6)
    })
    expect(reconcileStep(fixing, session({ status: 'idle', finishedAt: at(7) }), false)).toEqual({ type: 'run' })
    // The fix is in and its turn has not run: wait.
    expect(reconcileStep(fixing, session({ status: 'idle', finishedAt: at(5) }), false)).toEqual({ type: 'wait' })
  })

  it('sends the fix prompt again when it never went in (a quit or a reload during 验收)', () => {
    const asked = { passed: false, command: 'npm test', at: at(6), rounds: 0 }
    // Reload right after the acceptance failed: 修复中, no fix prompt recorded, no new turn.
    const fixing = record({ state: 'fixing', rounds: 1, acceptance: asked })
    expect(reconcileStep(fixing, session({ status: 'idle', finishedAt: at(5) }), false)).toEqual({ type: 'resend-fix' })
    // The prompt is in (recorded after the acceptance): wait for its turn.
    expect(reconcileStep({ ...fixing, fixSentAt: at(6) }, session({ status: 'idle', finishedAt: at(5) }), false)).toEqual({ type: 'wait' })
    // An older fix (before this acceptance) is re-sent too: this acceptance has had no prompt since.
    expect(reconcileStep({ ...fixing, fixSentAt: at(4) }, session({ status: 'idle', finishedAt: at(5) }), false)).toEqual({ type: 'resend-fix' })
    // A turn that ended after the acceptance: run the acceptance again, never the prompt.
    expect(reconcileStep({ ...fixing, fixSentAt: at(6) }, session({ status: 'idle', finishedAt: at(7) }), false)).toEqual({ type: 'run' })
  })

  it('leaves 验收中 to main and the finished states alone', () => {
    expect(reconcileStep(record({ state: 'accepting' }), session({ status: 'idle', finishedAt: at(9) }), false)).toEqual({ type: 'ignore' })
    expect(reconcileStep(record({ state: 'awaiting' }), session({ status: 'idle', finishedAt: at(9) }), false)).toEqual({ type: 'ignore' })
    expect(reconcileStep(record({ state: 'merged' }), undefined, true)).toEqual({ type: 'ignore' })
    expect(reconcileStep(record({ state: 'queued' }), undefined, false)).toEqual({ type: 'ignore' })
  })

  it('ends a record whose session is gone or archived', () => {
    expect(reconcileStep(record(), undefined, false)).toEqual({ type: 'drop', reason: 'session-gone' })
    expect(reconcileStep(record(), session({ status: 'running' }), true)).toEqual({ type: 'drop', reason: 'archived' })
  })
})

describe('finding records', () => {
  const records = [record(), record({ key: 'github.com/acme/widget#2', number: 2, sessionId: 's2', state: 'queued' })]

  it('finds the record of a session and of a 看板 row', () => {
    expect(recordForSession(records, 's2')?.number).toBe(2)
    expect(recordForSession(records, undefined)).toBeUndefined()
    expect(recordFor(records, 'github.com/acme/widget', 1)?.key).toBe(records[0]!.key)
    expect(recordFor(records, 'GitHub.com/Acme/Widget', 2)?.number).toBe(2)
    expect(recordFor(records, 'github.com/acme/other', 1)).toBeUndefined()
  })

  it('finds a session already working on the issue (a reload between fire and opened)', () => {
    const worktrees = [{ id: 'w1', path: '/wt' }, { id: 'w2', archived: 1 }] as unknown as Worktree[]
    const mine = { id: 's1', worktreeId: 'w1', github: { repo: 'GitHub.com/Acme/Widget', kind: 'issue', number: 9 } } as unknown as Session
    const archived = { id: 's2', worktreeId: 'w2', github: { repo: 'github.com/acme/widget', kind: 'issue', number: 9 } } as unknown as Session
    const other = { id: 's3', worktreeId: 'w1', github: { repo: 'github.com/acme/widget', kind: 'issue', number: 8 } } as unknown as Session
    expect(sessionForIssue([archived, other, mine], worktrees, { repo: 'github.com/acme/widget', number: 9 })?.id).toBe('s1')
    expect(sessionForIssue([other], worktrees, { repo: 'github.com/acme/widget', number: 9 })).toBeUndefined()
  })

  it('gives the issue link and the session’s worktree', () => {
    expect(issueLink(records[0]!)).toEqual({ repo: 'github.com/acme/widget', kind: 'issue', number: 1 })
    const worktrees = [{ id: 'w1', path: '/wt' }] as unknown as Worktree[]
    const s = { id: 's1', worktreeId: 'w1' } as Session
    expect(worktreeOfSession(worktrees, s)?.path).toBe('/wt')
    expect(worktreeOfSession(worktrees, undefined)).toBeUndefined()
    expect(sessionOf([s], worktrees, { sessionId: 's9' })).toEqual({ session: undefined, worktree: undefined })
    expect(sessionOf([s], worktrees, { sessionId: 's1' })).toEqual({ session: s, worktree: worktrees[0] })
  })
})
