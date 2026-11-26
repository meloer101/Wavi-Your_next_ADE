import { describe, expect, it } from 'vitest'
import type { TaskState } from '@shared/task-board'
import { diffMotion, hasMotion } from './motion'
import type { Snapshot } from './model'

type Seen = { seq: number; title: string; state: TaskState; parentId?: string; sessionId?: string }
const snap = (cards: Record<string, Seen>): Snapshot => new Map(Object.entries(cards))
const c = (seq: number, over: Partial<Seen> = {}): Seen => ({ seq, title: `c${seq}`, state: 'idle', ...over })

describe('diffMotion', () => {
  it('plays nothing on the first look', () => {
    expect(hasMotion(diffMotion(null, snap({ a: c(1) })))).toBe(false)
  })
  it('plays nothing when nothing changed', () => {
    const s = snap({ a: c(1), b: c(2, { parentId: 'a', sessionId: 's', state: 'working' }) })
    expect(hasMotion(diffMotion(s, snap({ a: c(1), b: c(2, { parentId: 'a', sessionId: 's', state: 'working' }) })))).toBe(false)
  })
  it('lands a new root card and slides a new child, staggered by creation order', () => {
    const prev = snap({ a: c(1) })
    const out = diffMotion(prev, snap({ a: c(1), r: c(5), k2: c(3, { parentId: 'a' }), k1: c(2, { parentId: 'a' }) }))
    expect(out.land).toEqual(['r'])
    expect(out.slide).toEqual([{ id: 'k1', order: 0 }, { id: 'k2', order: 1 }])
  })
  it('drops the pin when a card gets its session, once', () => {
    const prev = snap({ a: c(1) })
    const next = snap({ a: c(1, { sessionId: 's1' }) })
    expect(diffMotion(prev, next).pin).toEqual(['a'])
    expect(diffMotion(next, next).pin).toEqual([])
  })
  it('names a card that now waits on the user, finished, or was canceled', () => {
    const prev = snap({ a: c(1, { state: 'working' }), b: c(2, { state: 'working' }), d: c(3, { state: 'idle' }) })
    const out = diffMotion(prev, snap({ a: c(1, { state: 'attention' }), b: c(2, { state: 'done' }), d: c(3, { state: 'canceled' }) }))
    expect(out).toMatchObject({ attention: ['a'], done: ['b'], cancel: ['d'] })
  })
  it('lists the cards that are gone', () => {
    expect(diffMotion(snap({ a: c(1), b: c(2, { parentId: 'a' }) }), snap({})).removed.sort()).toEqual(['a', 'b'])
  })
})
