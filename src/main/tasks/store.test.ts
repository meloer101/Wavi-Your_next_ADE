import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseTaskDraft, parseTaskPatch } from './parse'
import { TaskBoard, TasksFile } from './store'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wavi-tasks-'))
  dirs.push(dir)
  const path = join(dir, 'tasks.json')
  let n = 0
  let clock = 1000
  const changes: number[] = []
  const open = () =>
    new TaskBoard(new TasksFile(path), {
      now: () => ++clock,
      newId: () => `t${++n}`,
      changed: (list) => changes.push(list.length)
    })
  return { dir, path, board: open(), open, changes }
}

describe('TaskBoard', () => {
  it('creates cards with growing seq, defaults and an on-disk copy', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: ' Ship it ' })
    expect(a).toMatchObject({ id: 't1', seq: 1, title: 'Ship it', body: '', createdBy: 'user', manual: 'todo' })
    const b = t.board.create({ projectId: 'p1', title: 'Part', parentId: a!.id, createdBy: 's9' })
    expect(b).toMatchObject({ seq: 2, parentId: 't1', createdBy: 's9' })
    expect(t.open().list().map((x) => x.seq)).toEqual([1, 2])
  })

  it('never reuses a seq after a card is removed, also after a reload', () => {
    const t = setup()
    t.board.create({ projectId: 'p1', title: 'a' })
    const b = t.board.create({ projectId: 'p1', title: 'b' })!
    t.board.remove(b.id)
    expect(t.board.create({ projectId: 'p1', title: 'c' })!.seq).toBe(3)
    t.board.remove('t3')
    expect(t.open().create({ projectId: 'p1', title: 'd' })!.seq).toBe(4)
  })

  it('refuses drafts: empty title, other project parent, too deep', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: 'a' })!
    expect(t.board.create({ projectId: 'p1', title: '  ' })).toBeNull()
    expect(t.board.create({ projectId: 'p2', title: 'x', parentId: a.id })).toBeNull()
    expect(t.board.create({ projectId: 'p1', title: 'x', parentId: 'nope' })).toBeNull()
    const b = t.board.create({ projectId: 'p1', title: 'b', parentId: a.id })!
    const c = t.board.create({ projectId: 'p1', title: 'c', parentId: b.id })!
    expect(t.board.create({ projectId: 'p1', title: 'd', parentId: c.id })).toBeNull()
    expect(t.board.list()).toHaveLength(3)
  })

  it('updates fields, bumps updatedAt and clears note and sessionId with null', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: 'a' })!
    const u = t.board.update(a.id, { title: 'A', body: 'text', note: 'half way', manual: 'done', sessionId: 's1' })!
    expect(u).toMatchObject({ title: 'A', body: 'text', note: 'half way', manual: 'done', sessionId: 's1' })
    expect(u.updatedAt).toBeGreaterThan(a.updatedAt)
    const cleared = t.board.update(a.id, { note: null, sessionId: null })!
    expect(cleared.note).toBeUndefined()
    expect(cleared.sessionId).toBeUndefined()
    expect(t.board.update(a.id, { title: '' })).toBeNull()
    expect(t.board.update(a.id, { title: 'x'.repeat(121) })).toBeNull()
    expect(t.board.update(a.id, { body: 'x'.repeat(8001) })).toBeNull()
    expect(t.board.update(a.id, { note: 'x'.repeat(600) })!.note).toHaveLength(500)
    expect(t.board.update('missing', { title: 'x' })).toBeNull()
  })

  it('validates parent changes: project, cycle, depth with the moved subtree', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: 'a' })!
    const b = t.board.create({ projectId: 'p1', title: 'b', parentId: a.id })!
    const c = t.board.create({ projectId: 'p1', title: 'c', parentId: b.id })!
    const other = t.board.create({ projectId: 'p2', title: 'o' })!
    const x = t.board.create({ projectId: 'p1', title: 'x' })!
    const y = t.board.create({ projectId: 'p1', title: 'y', parentId: x.id })!
    expect(t.board.update(a.id, { parentId: c.id })).toBeNull()
    expect(t.board.update(a.id, { parentId: a.id })).toBeNull()
    expect(t.board.update(c.id, { parentId: other.id })).toBeNull()
    // x has a child: moving it under b would put y at depth 3.
    expect(t.board.update(x.id, { parentId: b.id })).toBeNull()
    expect(t.board.update(y.id, { parentId: b.id })!.parentId).toBe(b.id)
    expect(t.board.update(c.id, { parentId: null })!.parentId).toBeUndefined()
  })

  it('removes a card with everything below it', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: 'a' })!
    const b = t.board.create({ projectId: 'p1', title: 'b', parentId: a.id })!
    t.board.create({ projectId: 'p1', title: 'c', parentId: b.id })
    t.board.create({ projectId: 'p1', title: 'keep' })
    expect(t.board.remove(a.id)).toBe(true)
    expect(t.board.list().map((x) => x.title)).toEqual(['keep'])
    expect(t.board.remove(a.id)).toBe(false)
  })

  it('calls changed once per change and not for refusals', () => {
    const t = setup()
    const a = t.board.create({ projectId: 'p1', title: 'a' })!
    t.board.create({ projectId: 'p1', title: '' })
    t.board.update(a.id, { note: 'n' })
    t.board.update(a.id, { title: '' })
    t.board.remove(a.id)
    t.board.remove(a.id)
    expect(t.changes).toEqual([1, 1, 0])
  })

  it('moves a corrupt file aside and starts empty; a missing file is just empty', () => {
    const t = setup()
    writeFileSync(t.path, '{not json')
    const board = t.open()
    expect(board.list()).toEqual([])
    expect(existsSync(t.path)).toBe(false)
    expect(readdirSync(t.dir).some((f) => f.startsWith('tasks.json.bad-'))).toBe(true)
    expect(board.create({ projectId: 'p1', title: 'a' })!.seq).toBe(1)
  })
})

describe('parseTaskDraft / parseTaskPatch', () => {
  it('accepts well-formed payloads and drops unknown fields', () => {
    expect(parseTaskDraft({ projectId: 'p', title: 't', body: 'b', parentId: 'x', createdBy: 'user', extra: 1 })).toEqual({ projectId: 'p', title: 't', body: 'b', parentId: 'x', createdBy: 'user' })
    expect(parseTaskPatch({ note: null, manual: 'done', sessionId: null, parentId: null, other: 1 })).toEqual({ note: null, manual: 'done', sessionId: null, parentId: null })
  })
  it('rejects malformed ones', () => {
    for (const bad of [null, 'x', [], {}, { projectId: 'p' }, { projectId: 'p', title: 3 }, { projectId: '', title: 't' }, { projectId: 'p', title: 't', parentId: 4 }]) {
      expect(parseTaskDraft(bad)).toBeNull()
    }
    for (const bad of [null, 'x', { title: 3 }, { manual: 'finished' }, { sessionId: 3 }, { parentId: '' }, { note: 5 }]) {
      expect(parseTaskPatch(bad)).toBeNull()
    }
  })
})
