import { describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/task-board'
import type { Session } from '@shared/types'
import { handCardToLeader, taskBoardMessage, type LeaderDeps } from './task-deliver'

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
      start: async (t, agent) => (calls.push(`start ${t.id} ${agent}`), 's1'),
      bind: async (t, id) => void calls.push(`bind ${t.id} ${id}`),
      ready: async () => void calls.push('ready'),
      session: (id) => (id === 's1' ? session : undefined),
      send: async (_s, text, held) => void sent.push({ text, key: held.key }),
      ...over
    }
    return { calls, sent, deps }
  }

  it('starts one session, binds it to the card, waits for the agent and sends the card once', async () => {
    const t = setup()
    expect(await handCardToLeader(card(1), 'codex', t.deps)).toBe(true)
    expect(t.calls).toEqual(['start t1 codex', 'bind t1 s1', 'ready'])
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]?.key).toBe('taskboard:t1')
    expect(t.sent[0]?.text).toContain('Card #1: Card 1')
  })
  it('starts nothing to bind or send when no session could be started', async () => {
    const t = setup({ start: async () => null })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toBe(false)
    expect(t.calls).toEqual([])
    expect(t.sent).toEqual([])
  })
  it('still sends when the agent never reports ready (the message is then held under its terminal)', async () => {
    const t = setup({ ready: async () => Promise.reject(new Error('not started')) })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toBe(true)
    expect(t.sent).toHaveLength(1)
  })
  it('sends nothing when the session is already gone', async () => {
    const t = setup({ session: () => undefined })
    expect(await handCardToLeader(card(1), 'claude', t.deps)).toBe(true)
    expect(t.sent).toEqual([])
  })
})
