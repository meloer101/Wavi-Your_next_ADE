import { describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/task-board'
import type { Session } from '@shared/types'
import { boundCardOf, claimCard, releaseCard, listText, mayTouch, planAdd, planRunCard, showText, type TaskCaller } from './task-commands'

vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [], projects: [] }) } }))

const card = (seq: number, over: Partial<Task> = {}): Task => ({ id: `t${seq}`, seq, projectId: 'p1', title: `Card ${seq}`, body: '', createdBy: 'user', manual: 'todo', createdAt: seq, updatedAt: seq, ...over })
const session = (id: string, over: Partial<Session> = {}): Session => ({ id, worktreeId: 'w1', kind: 'claude', title: id, status: 'idle', startedAt: 1, lastActivityAt: 1, ...over })

// #1 root (bound to `lead`'s dispatch child `kid`), #2 under #1, #3 under #2, #4 another root, #5 another project.
const tasks: Task[] = [card(1, { sessionId: 'kid' }), card(2, { parentId: 't1' }), card(3, { parentId: 't2' }), card(4), card(5, { projectId: 'p2' })]
const lead: TaskCaller = { sessionId: 'lead', projectId: 'p1', leader: true, depth: 0 }
const kid: TaskCaller = { sessionId: 'kid', projectId: 'p1', leader: false, depth: 1 }
const grand: TaskCaller = { sessionId: 'grand', projectId: 'p1', leader: false, depth: 2 }
const stranger: TaskCaller = { sessionId: 'top', projectId: 'p1', leader: false, depth: 0 }
const add = (title: string, over: { parent?: number; body?: string } = {}) => ({ name: 'task-add' as const, title, ...over })

describe('which cards a session may touch', () => {
  it('lets a leader touch every card of its project and a bound session only its card and the ones below', () => {
    expect(boundCardOf(tasks, 'kid')?.seq).toBe(1)
    expect(tasks.filter((t) => mayTouch(tasks, lead, t)).map((t) => t.seq)).toEqual([1, 2, 3, 4])
    expect(tasks.filter((t) => mayTouch(tasks, kid, t)).map((t) => t.seq)).toEqual([1, 2, 3])
    expect(tasks.filter((t) => mayTouch(tasks, stranger, t))).toEqual([])
  })
})

describe('wavi task add', () => {
  it('puts the card under the caller’s own card, or under --parent when that is its own or below it', () => {
    expect(planAdd(tasks, kid, add('Form'))).toMatchObject({ projectId: 'p1', parentId: 't1', createdBy: 'kid', title: 'Form' })
    expect(planAdd(tasks, kid, add('Form', { parent: 2, body: 'Fields' }))).toMatchObject({ parentId: 't2', body: 'Fields' })
  })
  it('refuses a parent outside the caller’s subtree, in another project, or missing', () => {
    expect(planAdd(tasks, kid, add('x', { parent: 4 }))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(planAdd(tasks, kid, add('x', { parent: 5 }))).toMatchObject({ ok: false, failure: 'not_found' })
    expect(planAdd(tasks, lead, add('x', { parent: 99 }))).toMatchObject({ ok: false, failure: 'not_found' })
  })
  it('lets only a leader make a root card; others are told to pass --parent', () => {
    expect(planAdd(tasks, lead, add('Root'))).toEqual({ projectId: 'p1', title: 'Root', createdBy: 'lead' })
    expect(planAdd(tasks, lead, add('Anywhere', { parent: 4 }))).toMatchObject({ parentId: 't4' })
    expect(planAdd(tasks, stranger, add('Root'))).toMatchObject({ ok: false, text: expect.stringContaining('--parent') })
  })
  it('refuses a session at the last level and a card that would nest too deep', () => {
    expect(planAdd(tasks, grand, add('x', { parent: 1 }))).toMatchObject({ ok: false, failure: 'not_allowed', text: expect.stringContaining("can't split further") })
    expect(planAdd(tasks, lead, add('too deep', { parent: 3 }))).toMatchObject({ ok: false, text: expect.stringContaining('two levels') })
  })
  it('refuses an empty title', () => {
    expect(planAdd(tasks, lead, add(' '))).toMatchObject({ ok: false })
  })
})

describe('wavi run --task', () => {
  const exists = (ids: string[]) => (id: string) => ids.includes(id)
  it('lets a leader bind any waiting card of its project', () => {
    expect(planRunCard(tasks, lead, 2, exists([]))).toMatchObject({ seq: 2 })
    expect(planRunCard(tasks, lead, 5, exists([]))).toMatchObject({ ok: false, failure: 'not_found' })
  })
  it('lets a bound session bind the cards below its own, not its own and not others', () => {
    expect(planRunCard(tasks, kid, 3, exists([]))).toMatchObject({ seq: 3 })
    expect(planRunCard(tasks, kid, 1, exists([]))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(planRunCard(tasks, kid, 4, exists([]))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(planRunCard(tasks, stranger, 2, exists([]))).toMatchObject({ ok: false, failure: 'not_allowed' })
  })
  it('refuses a card that is done or canceled, or already has a live session', () => {
    const board = [...tasks, card(6, { manual: 'done' }), card(7, { manual: 'canceled' }), card(8, { sessionId: 's8' })]
    expect(planRunCard(board, lead, 6, exists([]))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(planRunCard(board, lead, 7, exists([]))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(planRunCard(board, lead, 8, exists(['s8']))).toMatchObject({ ok: false, failure: 'duplicate' })
    expect(planRunCard(board, lead, 8, exists([]))).toMatchObject({ seq: 8 })
  })
})

describe('what the agent reads', () => {
  const sessions = [session('kid', { status: 'running', title: 'Login work' })]
  it('lists the cards the caller may touch, with their states', () => {
    const own = listText(tasks, kid, false, sessions)
    expect(own).toMatchObject({ ok: true })
    expect(own.text).toContain('#1 · "Card 1" · working · session kid "Login work"')
    expect(own.text).toContain('#2 · "Card 2" · not started · under #1')
    expect(own.text).not.toContain('Card 4')
    expect(own.text).not.toContain('Card 5')
    expect(listText(tasks, stranger, false, sessions).text).toContain('No cards for you')
  })
  it('lets a leader list its whole project, finished and canceled cards too, and never another project', () => {
    const board = [...tasks, card(6, { manual: 'done' }), card(7, { manual: 'canceled' })]
    for (const all of [false, true]) {
      const text = listText(board, lead, all, sessions).text
      expect([1, 2, 3, 4, 6, 7].every((n) => text.includes(`#${n} `))).toBe(true)
      expect(text).not.toContain('Card 5')
    }
    expect(listText(tasks, kid, true, sessions)).toMatchObject({ ok: false, failure: 'not_allowed' })
  })
  it('shows a card with body, note and sub-cards, only to those who may touch it', () => {
    const board = [card(1, { body: 'Build the form.', note: 'half done' }), card(2, { parentId: 't1' })]
    const shown = showText(board, lead, 1, [])
    expect(shown.text).toContain('Build the form.')
    expect(shown.text).toContain('Note: half done')
    expect(shown.text).toContain('- #2 · "Card 2"')
    expect(showText(tasks, kid, 4, [])).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(showText(tasks, kid, 5, [])).toMatchObject({ ok: false, failure: 'not_found' })
  })
})

describe('a card being started', () => {
  it('can be claimed by one start at a time until it is released', () => {
    expect(claimCard('t1')).toBe(true)
    expect(claimCard('t1')).toBe(false)
    expect(claimCard('t2')).toBe(true)
    releaseCard('t1')
    expect(claimCard('t1')).toBe(true)
    releaseCard('t1')
    releaseCard('t2')
  })
})
