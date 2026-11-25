import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task, TaskApi } from '@shared/task-board'
import { joinCards } from './model'
import { ACTIVITY_KEY, activityShown, defaultProject, startTaskSync, useTaskBoard } from './store'

let n = 0
function task(over: Partial<Task> = {}): Task {
  n++
  return { id: `t${n}`, seq: n, projectId: 'p', title: `Task ${n}`, body: '', createdBy: 'user', manual: 'todo', createdAt: n, updatedAt: n, ...over }
}

/** A fake of `window.tr.tasks`: `list` answers when told to, `emit` is main announcing a change. */
function fakeApi(initial: Task[]) {
  let listener: ((tasks: Task[]) => void) | null = null
  let release: (tasks: Task[]) => void = () => undefined
  const gate = new Promise<Task[]>((resolve) => (release = resolve))
  const api: TaskApi = {
    list: () => (initial.length >= 0 ? gate : Promise.resolve([])),
    create: vi.fn(async () => null),
    update: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    onChanged(l) {
      listener = l
      return () => {
        listener = null
      }
    }
  }
  return { api, answer: () => release(initial), emit: (tasks: Task[]) => listener?.(tasks), subscribed: () => listener !== null }
}

beforeEach(() => {
  useTaskBoard.setState({ tasks: [], loaded: false, selectedId: null, detailId: null, events: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('startTaskSync', () => {
  it('loads the list main holds', async () => {
    const fake = fakeApi([task(), task()])
    vi.stubGlobal('window', { tr: { tasks: fake.api } })
    const stop = startTaskSync()
    fake.answer()
    await Promise.resolve()
    await Promise.resolve()
    expect(useTaskBoard.getState().tasks).toHaveLength(2)
    expect(useTaskBoard.getState().loaded).toBe(true)
    stop()
  })

  it('follows every change after that', async () => {
    const fake = fakeApi([task()])
    vi.stubGlobal('window', { tr: { tasks: fake.api } })
    const stop = startTaskSync()
    fake.answer()
    await Promise.resolve()
    await Promise.resolve()
    fake.emit([task(), task(), task()])
    expect(useTaskBoard.getState().tasks).toHaveLength(3)
    stop()
  })

  it('does not let an older list overwrite a change that arrived first', async () => {
    const fake = fakeApi([task()])
    vi.stubGlobal('window', { tr: { tasks: fake.api } })
    const stop = startTaskSync()
    fake.emit([task(), task()])
    fake.answer()
    await Promise.resolve()
    await Promise.resolve()
    expect(useTaskBoard.getState().tasks).toHaveLength(2)
    stop()
  })

  it('stops listening, and ignores a late list, once stopped', async () => {
    const fake = fakeApi([task()])
    vi.stubGlobal('window', { tr: { tasks: fake.api } })
    startTaskSync()()
    expect(fake.subscribed()).toBe(false)
    fake.answer()
    await Promise.resolve()
    await Promise.resolve()
    expect(useTaskBoard.getState().loaded).toBe(false)
  })

  it('drops the selection and the open detail of a card main removed', () => {
    const a = task()
    useTaskBoard.setState({ tasks: [a], selectedId: a.id, detailId: a.id })
    useTaskBoard.getState().setTasks([])
    expect(useTaskBoard.getState()).toMatchObject({ selectedId: null, detailId: null })
  })
})

describe('the join with sessions', () => {
  it('gives each card its session’s state', () => {
    const cards = joinCards([task({ sessionId: 's1' })], [{ id: 's1', status: 'needs_you' }])
    expect(cards[0]?.state).toBe('attention')
  })
})

describe('defaultProject', () => {
  it('prefers the last used project, then the active session’s, then the first', () => {
    expect(defaultProject(['a', 'b', 'c'], 'c', 'b')).toBe('c')
    expect(defaultProject(['a', 'b', 'c'], null, 'b')).toBe('b')
    expect(defaultProject(['a', 'b', 'c'], null, undefined)).toBe('a')
  })

  it('skips a project that is gone and answers undefined with none', () => {
    expect(defaultProject(['a'], 'gone', 'gone2')).toBe('a')
    expect(defaultProject([], null, undefined)).toBeUndefined()
  })
})

describe('the 「动态」 panel default', () => {
  it('is collapsed on a canvas narrower than 1100 px and open from 1100 px', () => {
    expect(activityShown(null, 1099)).toBe(false)
    expect(activityShown(null, 1100)).toBe(true)
    expect(activityShown(null, 1500)).toBe(true)
  })

  it('lets the user’s own choice win over the width, either way', () => {
    expect(activityShown(true, 600)).toBe(true)
    expect(activityShown(false, 1800)).toBe(false)
  })

  it('remembers the choice in localStorage', () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) })
    useTaskBoard.getState().setActivity(false)
    expect(saved.get(ACTIVITY_KEY)).toBe('closed')
    expect(useTaskBoard.getState().activityPref).toBe(false)
    useTaskBoard.getState().setActivity(true)
    expect(saved.get(ACTIVITY_KEY)).toBe('open')
  })
})
