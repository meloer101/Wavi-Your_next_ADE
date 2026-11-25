import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/task-board'
import { actionLine, appendEvents, boardCounts, diffActivity, joinCards, matchesFilter, snapshotOf, splitCard, type CardSession } from './model'

let n = 0
function task(over: Partial<Task> = {}): Task {
  n++
  return { id: `t${n}`, seq: n, projectId: 'p', title: `Task ${n}`, body: '', createdBy: 'user', manual: 'todo', createdAt: n, updatedAt: n, ...over }
}
const session = (id: string, status: CardSession['status']): CardSession => ({ id, status })

describe('joinCards', () => {
  it('takes a card’s state from its session', () => {
    const cards = joinCards(
      [task({ sessionId: 's1' }), task({ sessionId: 's2' }), task({ sessionId: 's3' }), task({ sessionId: 's4' })],
      [session('s1', 'running'), session('s2', 'needs_you'), session('s3', 'done_unread'), session('s4', 'error')]
    )
    expect(cards.map((c) => c.state)).toEqual(['working', 'attention', 'done', 'error'])
  })

  it('shows a card with no session, or whose session is gone, as waiting', () => {
    const cards = joinCards([task(), task({ sessionId: 'gone' })], [])
    expect(cards.map((c) => c.state)).toEqual(['idle', 'idle'])
    expect(cards.every((c) => c.session === undefined)).toBe(true)
  })

  it('keeps a done mark over an idle session and a cancel over everything', () => {
    const cards = joinCards([task({ sessionId: 's1', manual: 'done' }), task({ sessionId: 's2', manual: 'canceled' })], [session('s1', 'idle'), session('s2', 'running')])
    expect(cards.map((c) => c.state)).toEqual(['done', 'canceled'])
  })

  it('a session that needs you outranks done set by the agent', () => {
    const [card] = joinCards([task({ sessionId: 's1', manual: 'done' })], [session('s1', 'needs_you')])
    expect(card?.state).toBe('attention')
  })

  it('hands the session on', () => {
    const [card] = joinCards([task({ sessionId: 's1' })], [session('s1', 'running')])
    expect(card?.session?.id).toBe('s1')
  })
})

describe('matchesFilter', () => {
  const t = task({ title: 'Cookie 会话迁移', seq: 21, note: '读 src/auth/refresh.ts' })
  it('matches everything when empty', () => expect(matchesFilter(t, 'acme', '  ')).toBe(true))
  it('matches the title, #seq and note, case-insensitively', () => {
    expect(matchesFilter(t, 'acme-web', 'cookie')).toBe(true)
    expect(matchesFilter(t, 'acme-web', '#21')).toBe(true)
    expect(matchesFilter(t, 'acme-web', 'REFRESH')).toBe(true)
  })
  it('matches the project only with p:', () => {
    expect(matchesFilter(t, 'acme-web', 'p:acme')).toBe(true)
    expect(matchesFilter(t, 'acme-web', 'p:other')).toBe(false)
    expect(matchesFilter(t, 'acme-web', 'acme')).toBe(false)
  })
  it('needs every word', () => {
    expect(matchesFilter(t, 'acme', 'cookie 会话')).toBe(true)
    expect(matchesFilter(t, 'acme', 'cookie nope')).toBe(false)
  })
})

describe('boardCounts', () => {
  it('counts live tasks and the ones waiting on you', () => {
    const cards = joinCards([task({ sessionId: 's1' }), task(), task({ manual: 'canceled' })], [session('s1', 'needs_you')])
    expect(boardCounts(cards, 3)).toEqual({ projects: 3, tasks: 2, attention: 1 })
  })
})

describe('diffActivity', () => {
  const look = (tasks: Task[], sessions: CardSession[] = []) => snapshotOf(joinCards(tasks, sessions))

  it('is silent on the first look', () => {
    expect(diffActivity(null, look([task()]), 1)).toEqual([])
  })

  it('reports a pasted card', () => {
    const a = task()
    const b = task({ title: 'New' })
    expect(diffActivity(look([a]), look([a, b]), 5)).toEqual([{ at: 5, kind: 'added', seq: b.seq, title: 'New' }])
  })

  it('reports several children of one parent as one split', () => {
    const root = task()
    const c1 = task({ parentId: root.id })
    const c2 = task({ parentId: root.id })
    const c3 = task({ parentId: root.id })
    const events = diffActivity(look([root]), look([root, c1, c2, c3]), 7)
    expect(events).toEqual([{ at: 7, kind: 'split', seq: c1.seq, title: c1.title, parentSeq: root.seq, toSeq: c3.seq }])
  })

  it('names the state a card changed to', () => {
    const a = task({ sessionId: 's1' })
    const before = look([a], [session('s1', 'running')])
    expect(diffActivity(before, look([a], [session('s1', 'needs_you')]), 1).map((e) => e.kind)).toEqual(['attention'])
    expect(diffActivity(before, look([a], [session('s1', 'done_unread')]), 1).map((e) => e.kind)).toEqual(['done'])
    expect(diffActivity(before, look([a], [session('s1', 'error')]), 1).map((e) => e.kind)).toEqual(['error'])
  })

  it('reports a dispatch when a session gets bound, then that it started', () => {
    const a = task()
    const bound = { ...a, sessionId: 's1' }
    const events = diffActivity(look([a]), look([bound], [session('s1', 'running')]), 2)
    expect(events.map((e) => e.kind)).toEqual(['dispatched', 'started'])
  })

  it('says nothing when nothing changed', () => {
    const a = task()
    expect(diffActivity(look([a]), look([a]), 3)).toEqual([])
  })
})

describe('appendEvents', () => {
  it('puts the newest first, numbers them on and caps the list', () => {
    const one = appendEvents([], [{ at: 1, kind: 'added', seq: 1, title: 'a' }, { at: 1, kind: 'added', seq: 2, title: 'b' }])
    expect(one.map((e) => e.seq)).toEqual([2, 1])
    const two = appendEvents(one, [{ at: 2, kind: 'done', seq: 1, title: 'a' }])
    expect(two[0]).toMatchObject({ kind: 'done', id: 3 })
    const many = appendEvents([], Array.from({ length: 60 }, (_, i) => ({ at: i, kind: 'added' as const, seq: i, title: 't' })))
    expect(many).toHaveLength(40)
    expect(many[0]?.seq).toBe(59)
  })
})

describe('actionLine', () => {
  type S = { id: string; status: CardSession['status']; currentAction?: string; lastReply?: string }
  const cardOf = (t: Task, s?: S) => joinCards([t], s ? [s] : [])[0]!
  const root = { waitingBelow: 0 }

  it('puts a parent’s waiting descendants first', () => {
    expect(actionLine(cardOf(task()), { ...root, waitingBelow: 2 })).toEqual({ kind: 'waiting', count: 2 })
  })

  it('says what the agent is doing, before its last sentence, before the note', () => {
    const t = task({ sessionId: 's', note: 'a note' })
    expect(actionLine(cardOf(t, { id: 's', status: 'running', currentAction: '编辑 a.ts', lastReply: 'said' }), root)).toEqual({ kind: 'text', text: '编辑 a.ts' })
    expect(actionLine(cardOf(t, { id: 's', status: 'running', lastReply: 'said' }), root)).toEqual({ kind: 'text', text: 'said' })
    expect(actionLine(cardOf(t, { id: 's', status: 'running' }), root)).toEqual({ kind: 'text', text: 'a note' })
  })

  it('shows the note of a card with no session', () => {
    expect(actionLine(cardOf(task({ note: '等 #3' })), root)).toEqual({ kind: 'text', text: '等 #3' })
  })

  it('says a card without a session waits to be dispatched', () => {
    expect(actionLine(cardOf(task()), root)).toEqual({ kind: 'key', key: 'unassigned' })
  })

  it('names done, done and unread, and canceled', () => {
    expect(actionLine(cardOf(task({ manual: 'done' })), root)).toEqual({ kind: 'key', key: 'done' })
    expect(actionLine(cardOf(task({ sessionId: 's' }), { id: 's', status: 'done_unread' }), root)).toEqual({ kind: 'key', key: 'doneReview' })
    expect(actionLine(cardOf(task({ manual: 'canceled' })), root)).toEqual({ kind: 'key', key: 'canceled' })
  })

  it('has a word for a running or idle session that has said nothing', () => {
    const t = task({ sessionId: 's' })
    expect(actionLine(cardOf(t, { id: 's', status: 'running' }), root)).toEqual({ kind: 'key', key: 'working' })
    expect(actionLine(cardOf(t, { id: 's', status: 'idle' }), root)).toEqual({ kind: 'key', key: 'idle' })
  })
})

describe('splitCard', () => {
  it('takes the first line as the title and the rest as the body', () => {
    expect(splitCard('改登录\n第二行\n第三行')).toEqual({ title: '改登录', body: '第二行\n第三行' })
    expect(splitCard('  只有标题  ')).toEqual({ title: '只有标题', body: '' })
  })
  it('drops blank lines before the text and after it', () => {
    expect(splitCard('\n\n标题\n\n正文\n\n')).toEqual({ title: '标题', body: '正文' })
  })
  it('lets what is over 120 characters in the first line start the body', () => {
    const out = splitCard(`${'a'.repeat(120)}bcd\nnext`)!
    expect(out.title).toBe('a'.repeat(120))
    expect(out.body).toBe('bcd\nnext')
  })
  it('is null without text', () => {
    expect(splitCard('')).toBeNull()
    expect(splitCard(' \n \n')).toBeNull()
  })
})
