import { describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/task-board'
import type { NewSessionInfo } from '@shared/new-session'
import { handCardToLeader, planLeaderWorktree, taskBoardMessage, typeCard, type LeaderDeps } from './task-deliver'

vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))
vi.mock('../new-session/creation', () => ({ createWorktreeFor: async () => true, holdForWorktree: () => {}, startEagerly: () => {} }))
vi.mock('./store', () => ({ setLaunch: () => {} }))
vi.mock('../session-io', () => ({ submitPrompt: async () => {}, whenAgentReady: async () => {} }))

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
  const setup = (over: Partial<LeaderDeps> = {}, delivered = true) => {
    const calls: string[] = []
    const launched: string[] = []
    const deps: LeaderDeps = {
      start: async (t, agent) => (
        calls.push(`start ${t.id} ${agent}`),
        { ok: true, id: 's1', launch: async (prompt) => (calls.push('launch'), launched.push(prompt), delivered), discard: () => void calls.push('discard') }
      ),
      bind: async (t, id) => (calls.push(`bind ${t.id} ${id}`), true),
      ...over
    }
    return { calls, launched, deps }
  }

  it('adds one session, binds it to the card, then starts it once with the card as its first message', async () => {
    const t = setup()
    expect(await handCardToLeader(card(1), 'codex', t.deps)).toEqual({ ok: true })
    expect(t.calls).toEqual(['start t1 codex', 'bind t1 s1', 'launch'])
    expect(t.launched).toHaveLength(1)
    expect(t.launched[0]).toBe(taskBoardMessage(card(1)))
  })
  it('hands the picked model and effort to the new session', async () => {
    const seen: unknown[] = []
    const t = setup({ start: async (_t, _agent, options) => (seen.push(options), { ok: true, id: 's1', launch: async () => true, discard: () => {} }) })
    await handCardToLeader(card(1), 'pi', t.deps, { model: 'm', effort: 'high' })
    expect(seen).toEqual([{ model: 'm', effort: 'high' }])
  })
  it.each(['no-project', 'not-git', 'no-plan', 'no-session', 'failed'] as const)('says %s when no session could be added, and binds and starts nothing', async (reason) => {
    const t = setup({ start: async () => ({ ok: false, reason }) })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: false, reason })
    expect(t.calls).toEqual([])
    expect(t.launched).toEqual([])
  })
  it('does not start a session that could not be bound, and removes it', async () => {
    const t = setup({ bind: async () => false })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toEqual({ ok: false, reason: 'unbound' })
    expect(t.calls).toEqual(['start t1 claude', 'discard'])
    expect(t.launched).toEqual([])
  })
  it('says later that a typed card did not arrive, and nothing when it did', async () => {
    for (const delivered of [false, true]) {
      const t = setup({}, delivered)
      const late = vi.fn()
      expect(await handCardToLeader(card(1), 'kimi', t.deps, {}, late)).toEqual({ ok: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(late.mock.calls).toEqual(delivered ? [] : [['not-delivered']])
    }
  })
})

describe('typeCard', () => {
  it('types the card once the agent is ready', async () => {
    const calls: string[] = []
    expect(await typeCard('s1', 'card', { ready: async () => void calls.push('ready'), submit: async (id, text) => void calls.push(`${id} ${text}`) })).toBe(true)
    expect(calls).toEqual(['ready', 's1 card'])
  })
  it('answers false when the agent never gets ready or the submit fails', async () => {
    const submit = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await typeCard('s1', 'card', { ready: () => Promise.reject(new Error('timeout')), submit })).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(await typeCard('s1', 'card', { ready: async () => {}, submit: () => Promise.reject(new Error('gone')) })).toBe(false)
    vi.restoreAllMocks()
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
