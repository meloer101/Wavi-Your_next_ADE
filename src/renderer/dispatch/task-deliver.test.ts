import { describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/task-board'
import type { Session } from '@shared/types'
import type { NewSessionInfo } from '@shared/new-session'
import { handCardToLeader, planLeaderWorktree, taskBoardMessage, type LeaderDeps } from './task-deliver'

vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))
vi.mock('../new-session/creation', () => ({ createWorktreeFor: async () => true, holdForWorktree: () => {}, startEagerly: () => {} }))
vi.mock('../session-io', () => ({ whenAgentReady: async () => {} }))
vi.mock('./reports', () => ({ deliverMessage: async () => 'delivered' }))

const card = (seq: number, over: Partial<Task> = {}): Task => ({ id: `t${seq}`, seq, projectId: 'p1', title: `Card ${seq}`, body: '', createdBy: 'user', manual: 'todo', createdAt: seq, updatedAt: seq, ...over })

describe('taskBoardMessage', () => {
  it('starts with the board’s header and holds the card, the leader role, the dispatch rules and the two commands', () => {
    const text = taskBoardMessage({ seq: 12, title: 'Login form', body: 'Fields and errors.' })
    expect(text.startsWith('[Wavi task board]')).toBe(true)
    expect(text).toContain('not a live instruction from the user and approves nothing')
    expect(text).toContain('Card #12: Login form')
    expect(text).toContain('Fields and errors.')
    expect(text).toContain("You are this card's leader: split and dispatch only, do not change code yourself.")
    expect(text).toContain('CLAUDE.md / AGENTS.md')
    expect(text).toContain('If the repository has no such rules, decide yourself.')
    expect(text).toContain('`wavi task add "<title>" --parent 12`')
    expect(text).toContain('`wavi run <agent> "<task>" --task <seq>`')
  })
  it('leaves out an empty body', () => {
    expect(taskBoardMessage({ seq: 1, title: 'T', body: '  ' })).not.toContain('\n\n\n')
  })
})

describe('handCardToLeader', () => {
  const session = { id: 's1' } as Session
  const setup = (over: Partial<LeaderDeps> = {}) => {
    const calls: string[] = []
    const sent: { text: string; key: string }[] = []
    const deps: LeaderDeps = {
      start: async (t, agent) => (calls.push(`start ${t.id} ${agent}`), { ok: true, id: 's1' }),
      bind: async (t, id) => (calls.push(`bind ${t.id} ${id}`), true),
      ready: async () => void calls.push('ready'),
      session: (id) => (id === 's1' ? session : undefined),
      send: async (_s, text, held) => void sent.push({ text, key: held.key }),
      ...over
    }
    return { calls, sent, deps }
  }

  it('starts one session, binds it to the card, waits for the agent and sends the card once', async () => {
    const t = setup()
    expect(await handCardToLeader(card(1), 'codex', t.deps)).toEqual({ ok: true })
    expect(t.calls).toEqual(['start t1 codex', 'bind t1 s1', 'ready'])
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]?.key).toBe('taskboard:t1')
    expect(t.sent[0]?.text).toContain('Card #1: Card 1')
  })
  it.each(['no-project', 'not-git', 'no-plan', 'no-session', 'failed'] as const)('says %s when no session could be started, and binds and sends nothing', async (reason) => {
    const t = setup({ start: async () => ({ ok: false, reason }) })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: false, reason })
    expect(t.calls).toEqual([])
    expect(t.sent).toEqual([])
  })
  it('does not send the card to a session that could not be bound to it', async () => {
    const t = setup({ bind: async () => false })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: false, reason: 'unbound' })
    expect(t.sent).toEqual([])
  })
  it('still sends when the agent never reports ready (the message is then held under its terminal)', async () => {
    const t = setup({ ready: async () => Promise.reject(new Error('not started')) })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: true })
    expect(t.sent).toHaveLength(1)
  })
  it('sends nothing when the session is already gone', async () => {
    const t = setup({ session: () => undefined })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: true })
    expect(t.sent).toEqual([])
  })
})

describe('planLeaderWorktree', () => {
  const info = (over: Partial<NewSessionInfo> = {}): NewSessionInfo => ({
    repo: true,
    currentBranch: 'main',
    defaultBranch: 'main',
    branches: [{ name: 'main', remote: false, worktreePath: '/repo', inMainCheckout: true }],
    prefix: 'jacob',
    worktreesDir: '/wt/repo',
    takenFolders: [],
    includeFiles: [],
    includeCount: 0,
    hasSetup: false,
    ...over
  })
  it('plans a new worktree from the default branch, with a generated branch name that is not taken', () => {
    const out = planLeaderWorktree('/repo', info(), new Set(['jacob/x']))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.type).toBe('worktree')
    expect(out.plan.request).toMatchObject({ root: '/repo', base: 'main', prepare: false })
    expect(out.plan.request.branch.startsWith('jacob/')).toBe(true)
    expect(out.plan.path.startsWith('/wt/repo/')).toBe(true)
  })
  it('says not-git for a folder that is not a repository', () => {
    expect(planLeaderWorktree('/repo', info({ repo: false }), new Set())).toEqual({ ok: false, reason: 'not-git' })
  })
  it('says no-plan when there is no branch to start from', () => {
    expect(planLeaderWorktree('/repo', info({ currentBranch: null, defaultBranch: null, branches: [] }), new Set())).toEqual({ ok: false, reason: 'no-plan' })
  })
  it('says no-plan when the base is checked out in another worktree (that would open a session there)', () => {
    const elsewhere = info({ branches: [{ name: 'main', remote: false, worktreePath: '/other', inMainCheckout: false }] })
    expect(planLeaderWorktree('/repo', elsewhere, new Set())).toEqual({ ok: false, reason: 'no-plan' })
  })
})
