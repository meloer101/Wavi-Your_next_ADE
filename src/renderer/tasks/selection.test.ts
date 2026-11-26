import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/task-board'
import { cardsTouching, deletedSummary, marqueeBox, rectBetween, toggleId, topmost, toWorld } from './selection'

const task = (id: string, seq: number, parentId?: string): Task => ({ id, seq, projectId: 'p', title: id, body: '', createdBy: 'user', manual: 'todo', createdAt: seq, updatedAt: seq, ...(parentId ? { parentId } : {}) })

// root a → b → c, and a second root d
const tasks = [task('a', 1), task('b', 2, 'a'), task('c', 3, 'b'), task('d', 4)]

describe('the marquee', () => {
  const cards = [
    { id: 'a', x: 0, y: 0, w: 220, h: 94 },
    { id: 'b', x: 290, y: 0, w: 220, h: 94 },
    { id: 'c', x: 290, y: 130, w: 220, h: 94 }
  ]
  it('is the same box whichever corner it starts from', () => {
    expect(rectBetween({ x: 10, y: 50 }, { x: 4, y: 20 })).toEqual({ x: 4, y: 20, w: 6, h: 30 })
  })
  it('takes every card it touches, not only the ones it holds whole', () => {
    expect(cardsTouching(cards, { x: 200, y: 80, w: 100, h: 60 })).toEqual(['a', 'b', 'c'])
    expect(cardsTouching(cards, { x: 300, y: 10, w: 5, h: 5 })).toEqual(['b'])
  })
  it('takes none in the gap between cards, nor at a shared edge', () => {
    expect(cardsTouching(cards, { x: 230, y: 0, w: 50, h: 300 })).toEqual([])
    expect(cardsTouching(cards, { x: 220, y: 0, w: 70, h: 94 })).toEqual([])
  })
  it('maps board pixels to the layout through the viewport, chips at double scale', () => {
    expect(toWorld({ x: 100, y: 50, zoom: 1 }, { x: 150, y: 90 })).toEqual({ x: 50, y: 40 })
    expect(toWorld({ x: 0, y: 0, zoom: 0.5 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(toWorld({ x: 0, y: 0, zoom: 2 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 })
  })
  it('stays where it started on the world when the view pans or zooms during the drag', () => {
    const from = { x: 100, y: 50 }
    expect(marqueeBox({ x: 0, y: 0, zoom: 1 }, from, { x: 300, y: 200 })).toEqual({ world: { x: 100, y: 50, w: 200, h: 150 }, screen: { x: 100, y: 50, w: 200, h: 150 } })
    // Scrolled 500 down with the pointer still: the start moved up with the canvas, the far corner took in more of it.
    expect(marqueeBox({ x: 0, y: -500, zoom: 1 }, from, { x: 300, y: 200 })).toEqual({ world: { x: 100, y: 50, w: 200, h: 650 }, screen: { x: 100, y: -450, w: 200, h: 650 } })
    expect(marqueeBox({ x: 0, y: 0, zoom: 2 }, from, { x: 300, y: 200 })).toEqual({ world: { x: 100, y: 50, w: 50, h: 50 }, screen: { x: 200, y: 100, w: 100, h: 100 } })
  })
})

describe('the selection', () => {
  it('⇧-click adds and takes away', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('keeps only the topmost of a selected branch, a skipped generation included', () => {
    expect(topmost(tasks, ['c', 'a', 'd'])).toEqual(['a', 'd'])
    expect(topmost(tasks, ['b', 'c'])).toEqual(['b'])
    expect(topmost(tasks, ['gone'])).toEqual([])
  })
  it('says what a delete took away', () => {
    expect(deletedSummary(tasks.slice(0, 3))).toEqual({ seq: 1, count: 3 })
    expect(deletedSummary(tasks.slice(1, 3))).toEqual({ seq: 2, count: 2 })
    expect(deletedSummary(tasks)).toEqual({ count: 4 })
  })
})
