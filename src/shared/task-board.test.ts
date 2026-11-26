import { describe, expect, it } from 'vitest'
import {
  buildTaskTree,
  checkDraft,
  childSegments,
  parseTasksFile,
  taskDepth,
  taskProgress,
  taskState,
  waitingBelow,
  withDescendants,
  TASK_LIMITS,
  type Task,
  type TaskState
} from './task-board'

const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing')
  return v
}

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id,
  seq: Number(id.replace(/\D/g, '')) || 1,
  projectId: 'p1',
  title: `card ${id}`,
  body: '',
  createdBy: 'user',
  manual: 'todo',
  createdAt: 1,
  updatedAt: 1,
  ...o
})

describe('taskState', () => {
  it('shows what needs the user or failed even when the agent marked the card done', () => {
    expect(taskState({ manual: 'done' }, 'needs_you')).toBe('attention')
    expect(taskState({ manual: 'done' }, 'error')).toBe('error')
  })
  it('canceled wins over everything', () => {
    expect(taskState({ manual: 'canceled' }, 'needs_you')).toBe('canceled')
  })
  it('done set by the agent wins over a running or idle session', () => {
    expect(taskState({ manual: 'done' }, 'running')).toBe('done')
    expect(taskState({ manual: 'done' }, undefined)).toBe('done')
  })
  it('follows the session otherwise', () => {
    expect(taskState({ manual: 'todo' }, 'running')).toBe('working')
    expect(taskState({ manual: 'todo' }, 'done_unread')).toBe('done')
    expect(taskState({ manual: 'todo' }, 'idle')).toBe('idle')
    expect(taskState({ manual: 'todo' }, 'exited')).toBe('idle')
  })
  it('waits when there is no session', () => {
    expect(taskState({ manual: 'todo' }, undefined)).toBe('idle')
  })
})

describe('buildTaskTree', () => {
  it('nests by parentId, oldest first, and treats a missing parent as a root', () => {
    const tree = buildTaskTree([task('3', { parentId: '1', createdAt: 3 }), task('2', { parentId: '1', createdAt: 2 }), task('1'), task('4', { parentId: 'gone' })])
    expect(tree.map((n) => n.task.id)).toEqual(['1', '4'])
    const first = must(tree[0])
    expect(first.children.map((n) => n.task.id)).toEqual(['2', '3'])
    expect(must(first.children[0]).depth).toBe(1)
  })
})

describe('checkDraft', () => {
  const tasks = [task('1'), task('2', { parentId: '1' }), task('3', { parentId: '2' })]
  it('accepts a root and a child', () => {
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x' })).toEqual({ ok: true })
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x', parentId: '1' })).toEqual({ ok: true })
  })
  it('refuses a third level below a root', () => {
    expect(taskDepth(tasks, '3')).toBe(2)
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x', parentId: '3' })).toEqual({ ok: false, reason: 'depth' })
  })
  it('refuses a parent that is missing or in another project', () => {
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x', parentId: 'nope' })).toEqual({ ok: false, reason: 'parent' })
    expect(checkDraft(tasks, { projectId: 'p2', title: 'x', parentId: '1' })).toEqual({ ok: false, reason: 'parent' })
  })
  it('refuses an empty or long title and a long body', () => {
    expect(checkDraft(tasks, { projectId: 'p1', title: '  ' })).toEqual({ ok: false, reason: 'title' })
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x'.repeat(TASK_LIMITS.title + 1) })).toEqual({ ok: false, reason: 'title' })
    expect(checkDraft(tasks, { projectId: 'p1', title: 'x', body: 'x'.repeat(TASK_LIMITS.body + 1) })).toEqual({ ok: false, reason: 'body' })
  })
  it('refuses past the per-project limit', () => {
    const many = Array.from({ length: TASK_LIMITS.perProject }, (_, i) => task(`t${i}`, { seq: i + 1 }))
    expect(checkDraft(many, { projectId: 'p1', title: 'x' })).toEqual({ ok: false, reason: 'limit' })
    expect(checkDraft(many, { projectId: 'p2', title: 'x' })).toEqual({ ok: true })
  })
})

describe('progress', () => {
  const tree = must(buildTaskTree([task('1'), task('2', { parentId: '1' }), task('3', { parentId: '1' }), task('4', { parentId: '1' }), task('5', { parentId: '1' })])[0])
  const states: Record<string, TaskState> = { '1': 'working', '2': 'done', '3': 'attention', '4': 'canceled', '5': 'idle' }
  const stateOf = (t: Task): TaskState => states[t.id] ?? 'idle'
  it('counts canceled children in neither done nor total', () => {
    expect(taskProgress(tree, stateOf)).toEqual({ done: 1, total: 3 })
  })
  it('lists the children states in order and counts the ones waiting on the user', () => {
    expect(childSegments(tree, stateOf)).toEqual(['done', 'attention', 'canceled', 'idle'])
    expect(waitingBelow(tree, stateOf)).toBe(1)
  })
})

describe('parseTasksFile', () => {
  it('reads an empty or broken file as no cards', () => {
    expect(parseTasksFile(null)).toEqual({ version: 1, nextSeq: 1, tasks: [] })
    expect(parseTasksFile({ tasks: 'no' }).tasks).toEqual([])
  })
  it('drops malformed cards and duplicate ids or seqs', () => {
    const ok = task('1')
    const out = parseTasksFile({ version: 1, nextSeq: 2, tasks: [ok, { id: 'x' }, { ...ok }, { ...ok, id: 'other' }, 'str'] })
    expect(out.tasks.map((t) => t.id)).toEqual(['1'])
  })
  it('keeps nextSeq above every seq', () => {
    expect(parseTasksFile({ nextSeq: 2, tasks: [task('9', { seq: 9 })] }).nextSeq).toBe(10)
  })
  it('makes a card a root when its parent is missing, in another project, in a cycle, or too deep', () => {
    const out = parseTasksFile({
      tasks: [
        task('1', { parentId: '9' }),
        task('2', { parentId: '3' }),
        task('3', { parentId: '2' }),
        task('4', { projectId: 'p2' }),
        task('5', { parentId: '4' }),
        task('6'),
        task('7', { parentId: '6' }),
        task('8', { parentId: '7' }),
        task('10', { parentId: '8' })
      ]
    })
    const parent = (id: string): string | undefined => out.tasks.find((t) => t.id === id)?.parentId
    expect(parent('1')).toBeUndefined()
    expect(parent('5')).toBeUndefined()
    expect(parent('8')).toBe('7')
    expect(parent('10')).toBeUndefined()
    // a cycle cannot be walked to a root: both ends are cut free of it
    expect(taskDepth(out.tasks, '2')).toBeLessThanOrEqual(TASK_LIMITS.maxDepth)
    expect(taskDepth(out.tasks, '3')).toBeLessThanOrEqual(TASK_LIMITS.maxDepth)
  })
  it('keeps a position only when both numbers are finite and within 1e6', () => {
    const pos = (v: unknown) => parseTasksFile({ tasks: [task('1', { pos: v as never })] }).tasks[0]?.pos
    expect(pos({ x: -120.5, y: 30 })).toEqual({ x: -120.5, y: 30 })
    expect(pos({ x: 1e6, y: -1e6 })).toEqual({ x: 1e6, y: -1e6 })
    for (const bad of [{ x: 1 }, { x: 1, y: 'a' }, { x: Infinity, y: 0 }, { x: 0, y: NaN }, { x: 1e6 + 1, y: 0 }, null, 5]) expect(pos(bad)).toBeUndefined()
  })
  it('clips long text', () => {
    const out = must(parseTasksFile({ tasks: [task('1', { title: 'x'.repeat(500), body: 'y'.repeat(20_000), note: 'z'.repeat(2_000) })] }).tasks[0])
    expect(out.title).toHaveLength(TASK_LIMITS.title)
    expect(out.body).toHaveLength(TASK_LIMITS.body)
    expect(out.note).toHaveLength(TASK_LIMITS.note)
  })
})

describe('withDescendants', () => {
  it('lists a card and everything below it', () => {
    const tasks = [task('1'), task('2', { parentId: '1' }), task('3', { parentId: '2' }), task('4')]
    expect(withDescendants(tasks, '1').sort()).toEqual(['1', '2', '3'])
    expect(withDescendants(tasks, '4')).toEqual(['4'])
  })
})
