import { describe, expect, it } from 'vitest'
import { buildTaskTree, type Task } from '@shared/task-board'
import {
  CHIP_BELOW,
  DIMS,
  DOT_BELOW,
  DEFAULT_VIEW,
  boundsOf,
  clampZoom,
  drawingFor,
  fitView,
  groupByProject,
  layoutBoard,
  modeFor,
  panBy,
  parseView,
  scaleFor,
  visibleWorld,
  zoomAround,
  type BoardLayout,
  type PlacedCard,
  type Rect
} from './layout'

let seq = 0
function task(id: string, projectId: string, parentId?: string, pos?: { x: number; y: number }): Task {
  seq++
  return { id, seq, projectId, title: id, body: '', createdBy: 'user', manual: 'todo', createdAt: seq, updatedAt: seq, ...(parentId ? { parentId } : {}), ...(pos ? { pos } : {}) }
}

function board(tasks: Task[], mode: 'note' | 'chip' = 'note', order: string[] = ['p'], overrides?: Map<string, { x: number; y: number }>): BoardLayout {
  return layoutBoard(groupByProject(tasks, order, buildTaskTree), mode, overrides)
}
const card = (l: BoardLayout, id: string): PlacedCard => l.cards.find((c) => c.id === id)!
const mid = (c: PlacedCard): number => c.y + c.h / 2
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// The 115A4 tree: #21 → 22, 23 (→ 24), 25 (→ 26), 27.
const tree = (): Task[] => [task('r', 'p'), task('a', 'p', 'r'), task('b', 'p', 'r'), task('b1', 'p', 'b'), task('c', 'p', 'r'), task('c1', 'p', 'c'), task('d', 'p', 'r')]

describe('layoutBoard · note mode', () => {
  it('puts each level 290 px to the right of the one before', () => {
    const l = board(tree())
    expect(card(l, 'r').x).toBe(0)
    expect(card(l, 'a').x).toBe(290)
    expect(card(l, 'b1').x).toBe(580)
  })

  it('sizes a card with children 118 high and one without 94', () => {
    const l = board(tree())
    expect(card(l, 'r')).toMatchObject({ w: 220, h: 118, parent: true })
    expect(card(l, 'a')).toMatchObject({ w: 220, h: 94, parent: false })
  })

  it('stacks siblings oldest first with the sibling gap between them', () => {
    const l = board(tree())
    const [a, b, d] = [card(l, 'a'), card(l, 'b'), card(l, 'd')]
    expect(b.y).toBe(a.y + a.h + DIMS.note.gap)
    expect(d.y).toBeGreaterThan(card(l, 'c').y)
  })

  it('centres a parent on its first and last child', () => {
    const l = board(tree())
    expect(mid(card(l, 'r'))).toBeCloseTo((mid(card(l, 'a')) + mid(card(l, 'd'))) / 2)
  })

  it('shifts an only child 30 px below its parent so the connector bends', () => {
    const l = board([task('r', 'p'), task('a', 'p', 'r')])
    expect(mid(card(l, 'a')) - mid(card(l, 'r'))).toBe(30)
    const link = l.links[0]!
    expect(link.y2 - link.y1).toBe(30)
  })

  it('keeps the whole tree at or below the top when the shift would lift a parent', () => {
    const l = board([task('r', 'p'), task('a', 'p', 'r'), task('a1', 'p', 'a')])
    expect(Math.min(...l.cards.map((c) => c.y))).toBe(0)
  })

  it('draws a link from the parent right-middle to the child left-middle', () => {
    const l = board(tree())
    const r = card(l, 'r')
    const a = card(l, 'a')
    const link = l.links.find((k) => k.toId === 'a')!
    expect(link).toMatchObject({ fromId: 'r', x1: r.x + r.w, y1: mid(r), x2: a.x, y2: mid(a) })
    expect(l.links).toHaveLength(6)
  })

  it('stacks the roots of one project and keeps their trees apart', () => {
    const l = board([task('r1', 'p'), task('k', 'p', 'r1'), task('r2', 'p')])
    expect(card(l, 'r2').y).toBeGreaterThanOrEqual(card(l, 'r1').y + card(l, 'r1').h + DIMS.note.rootGap)
  })

  it('never overlaps two cards, and never overlaps two clusters', () => {
    const tasks = [...tree(), ...['q1', 'q2', 'q3'].map((id) => task(id, 'q')), task('z', 'z'), task('z1', 'z', 'z'), task('z2', 'z', 'z')]
    const l = board(tasks, 'note', ['p', 'q', 'z'])
    for (let i = 0; i < l.cards.length; i++) for (let j = i + 1; j < l.cards.length; j++) expect(overlaps(l.cards[i]!, l.cards[j]!)).toBe(false)
    for (let i = 0; i < l.clusters.length; i++) for (let j = i + 1; j < l.clusters.length; j++) expect(overlaps(l.clusters[i]!, l.clusters[j]!)).toBe(false)
  })

  it('wraps clusters into a new row once the row is full', () => {
    const wide = (p: string): Task[] => [task(`${p}0`, p), task(`${p}1`, p, `${p}0`), task(`${p}2`, p, `${p}1`), task(`${p}3`, p, `${p}2`)]
    const l = layoutBoard(groupByProject(['a', 'b', 'c'].flatMap(wide), ['a', 'b', 'c'], buildTaskTree), 'note')
    const rows = new Set(l.clusters.map((c) => c.y))
    expect(rows.size).toBeGreaterThan(1)
  })

  it('gives a project without cards no room', () => {
    const l = board([], 'note', ['empty'])
    expect(l.clusters).toHaveLength(0)
    expect(l.cards).toHaveLength(0)
  })

  it('orders projects as given and appends projects it was not told about', () => {
    const l = board([task('x', 'later'), task('y', 'first')], 'note', ['first'])
    expect(l.clusters.map((c) => c.projectId)).toEqual(['first', 'later'])
  })
})

describe('layoutBoard · dragged cards', () => {
  it('puts a moved root at its position, and its subtree follows', () => {
    const auto = board([task('r', 'p'), task('a', 'p', 'r'), task('a1', 'p', 'a')])
    const l = board([task('r', 'p', undefined, { x: 500, y: 400 }), task('a', 'p', 'r'), task('a1', 'p', 'a')])
    expect(card(l, 'r')).toMatchObject({ x: 500, y: 400 })
    expect(card(l, 'a').x - card(l, 'r').x).toBe(card(auto, 'a').x - card(auto, 'r').x)
    expect(card(l, 'a1').y - card(l, 'r').y).toBe(card(auto, 'a1').y - card(auto, 'r').y)
  })

  it('puts a moved child at its parent plus its position, and leaves its siblings where the tree put them', () => {
    const auto = board(tree())
    const tasks = tree().map((t) => (t.id === 'b' ? { ...t, pos: { x: 40, y: 300 } } : t))
    const l = board(tasks)
    expect(card(l, 'b')).toMatchObject({ x: card(l, 'r').x + 40, y: card(l, 'r').y + 300 })
    expect(card(l, 'b1').x - card(l, 'b').x).toBe(DIMS.note.pitch)
    expect(card(l, 'b1').y - card(l, 'b').y).toBe(card(auto, 'b1').y - card(auto, 'b').y)
    expect(card(l, 'a')).toMatchObject({ x: card(auto, 'a').x, y: card(auto, 'a').y })
  })

  it('moves a child with a moved parent: its position stays relative to the parent', () => {
    const tasks = tree().map((t) => (t.id === 'r' ? { ...t, pos: { x: 100, y: 100 } } : t.id === 'a' ? { ...t, pos: { x: 300, y: 10 } } : t))
    const l = board(tasks)
    expect(card(l, 'a')).toMatchObject({ x: 400, y: 110 })
  })

  it('does not reserve the root slot of a moved root: the next root takes its place', () => {
    const l = board([task('r1', 'p', undefined, { x: 900, y: 900 }), task('r2', 'p')])
    expect(card(l, 'r2')).toMatchObject({ x: 0, y: 0 })
  })

  it('draws the links between the placed rects and includes moved cards in the bounds', () => {
    const l = board([task('r', 'p'), task('a', 'p', 'r', { x: 700, y: 900 })])
    const r = card(l, 'r')
    const a = card(l, 'a')
    expect(l.links[0]).toMatchObject({ fromId: 'r', toId: 'a', x1: r.x + r.w, y1: mid(r), x2: a.x, y2: mid(a) })
    expect(l.bounds.x + l.bounds.w).toBe(a.x + a.w)
    expect(l.bounds.y + l.bounds.h).toBe(a.y + a.h)
  })

  it('takes a drag in progress over the saved position', () => {
    const l = board([task('r', 'p', undefined, { x: 10, y: 10 })], 'note', ['p'], new Map([['r', { x: 33, y: 44 }]]))
    expect(card(l, 'r')).toMatchObject({ x: 33, y: 44 })
  })

  it('scales positions with the chip pitch in chip mode', () => {
    const l = board([task('r', 'p'), task('a', 'p', 'r', { x: 290, y: 100 })], 'chip')
    const ratio = DIMS.chip.pitch / DIMS.note.pitch
    expect(card(l, 'a').x - card(l, 'r').x).toBeCloseTo(290 * ratio)
    expect(card(l, 'a').y - card(l, 'r').y).toBeCloseTo(100 * ratio)
  })
})

describe('layoutBoard · chip mode', () => {
  it('uses 156 × 28 chips 176 apart with an 8 px gap between siblings', () => {
    const l = board(tree(), 'chip')
    expect(card(l, 'r')).toMatchObject({ w: 156, h: 28 })
    expect(card(l, 'a').x - card(l, 'r').x).toBe(176)
    expect(card(l, 'b').y - card(l, 'a').y).toBe(36)
  })

  it('still centres a parent and bends the connector of an only child', () => {
    const l = board(tree(), 'chip')
    expect(mid(card(l, 'r'))).toBeCloseTo((mid(card(l, 'a')) + mid(card(l, 'd'))) / 2)
    expect(mid(card(l, 'b1')) - mid(card(l, 'b'))).toBe(DIMS.chip.leafShift)
  })

  it('does not overlap cards in a dense board', () => {
    const l = board(tree(), 'chip')
    for (let i = 0; i < l.cards.length; i++) for (let j = i + 1; j < l.cards.length; j++) expect(overlaps(l.cards[i]!, l.cards[j]!)).toBe(false)
  })
})

describe('drawing by zoom', () => {
  it('draws notes from 65 %, chips from 30 %, dots below', () => {
    expect(drawingFor(1)).toBe('note')
    expect(drawingFor(CHIP_BELOW)).toBe('note')
    expect(drawingFor(CHIP_BELOW - 0.01)).toBe('chip')
    expect(drawingFor(0.5)).toBe('chip')
    expect(drawingFor(DOT_BELOW)).toBe('chip')
    expect(drawingFor(DOT_BELOW - 0.01)).toBe('dot')
    expect(modeFor(0.28)).toBe('chip')
  })

  it('scales a chip layout to twice the zoom, so a chip is 156 px wide at 50 %', () => {
    expect(scaleFor(0.5) * DIMS.chip.w).toBe(156)
    expect(scaleFor(1)).toBe(1)
  })
})

describe('viewport', () => {
  const bounds = { note: { x: 0, y: 0, w: 1000, h: 800 }, chip: { x: 0, y: 0, w: 500, h: 300 } }

  it('clamps zoom to 25 %–200 %', () => {
    expect(clampZoom(0.1)).toBe(0.25)
    expect(clampZoom(5)).toBe(2)
    expect(clampZoom(1.2)).toBe(1.2)
  })

  it('pans by a delta', () => {
    expect(panBy({ x: 10, y: 20, zoom: 1 }, -4, 6)).toEqual({ x: 6, y: 26, zoom: 1 })
  })

  it('zooms around the pointer: the world point under it does not move', () => {
    const view = { x: 50, y: 30, zoom: 1 }
    const anchor = { x: 400, y: 300 }
    const next = zoomAround(view, 1.5, anchor, bounds)
    expect((anchor.x - view.x) / 1).toBeCloseTo((anchor.x - next.x) / 1.5)
    expect((anchor.y - view.y) / 1).toBeCloseTo((anchor.y - next.y) / 1.5)
    expect(next.zoom).toBe(1.5)
  })

  it('clamps the zoom it zooms to', () => {
    expect(zoomAround(DEFAULT_VIEW, 9, { x: 0, y: 0 }, bounds).zoom).toBe(2)
    expect(zoomAround(DEFAULT_VIEW, 0.01, { x: 0, y: 0 }, bounds).zoom).toBe(0.25)
  })

  it('keeps the relative place in the layout when zooming across the note / chip threshold', () => {
    // The point at 60 % of the note layout's width stays at 60 % of the chip layout's width, under the pointer.
    const view = { x: 0, y: 0, zoom: 0.7 }
    const anchor = { x: 0.6 * 1000 * 0.7, y: 0.5 * 800 * 0.7 }
    const next = zoomAround(view, 0.6, anchor, bounds)
    const s = scaleFor(0.6)
    expect((anchor.x - next.x) / s).toBeCloseTo(0.6 * 500)
    expect((anchor.y - next.y) / s).toBeCloseTo(0.5 * 300)
  })

  it('fits all cards in the window and never zooms in past 100 %', () => {
    const size = { w: 1000, h: 700 }
    const big = fitView({ note: { x: 0, y: 0, w: 2400, h: 1400 }, chip: { x: 0, y: 0, w: 900, h: 400 } }, size)
    expect(big.zoom).toBeLessThan(1)
    const small = fitView({ note: { x: 0, y: 0, w: 300, h: 200 }, chip: { x: 0, y: 0, w: 156, h: 28 } }, size)
    expect(small.zoom).toBe(1)
    // The fitted rectangle is centred.
    expect(small.x).toBeCloseTo((1000 - 300) / 2)
    expect(small.y).toBeCloseTo((700 - 200) / 2)
  })

  it('fits a board too wide for notes with chips', () => {
    const size = { w: 1000, h: 700 }
    const v = fitView({ note: { x: 0, y: 0, w: 6000, h: 3000 }, chip: { x: 0, y: 0, w: 1400, h: 600 } }, size)
    expect(drawingFor(v.zoom)).not.toBe('note')
    expect(v.zoom).toBeGreaterThanOrEqual(0.25)
    expect(1400 * scaleFor(v.zoom)).toBeLessThanOrEqual(size.w)
  })

  it('keeps the default view for an empty board', () => {
    const none = { x: 0, y: 0, w: 0, h: 0 }
    expect(fitView({ note: none, chip: none }, { w: 800, h: 600 })).toEqual(DEFAULT_VIEW)
  })

  it('tells which world rectangle is on screen', () => {
    expect(visibleWorld({ x: -100, y: -50, zoom: 2 }, { w: 500, h: 400 })).toEqual({ x: 50, y: 25, w: 250, h: 200 })
    // Chips are drawn at twice the zoom: at 50 % one world unit is one screen px.
    expect(visibleWorld({ x: -100, y: -50, zoom: 0.5 }, { w: 500, h: 400 })).toEqual({ x: 100, y: 50, w: 500, h: 400 })
  })

  it('reads a saved view, falls back on anything else and clamps the zoom', () => {
    expect(parseView({ x: 1, y: 2, zoom: 1.5 })).toEqual({ x: 1, y: 2, zoom: 1.5 })
    expect(parseView({ x: 1, y: 2, zoom: 40 }).zoom).toBe(2)
    expect(parseView(null)).toEqual(DEFAULT_VIEW)
    expect(parseView({ x: 'a', y: 2, zoom: 1 })).toEqual(DEFAULT_VIEW)
  })

  it('computes bounds of rectangles', () => {
    expect(boundsOf([{ x: 10, y: 5, w: 10, h: 10 }, { x: 0, y: 20, w: 5, h: 5 }])).toEqual({ x: 0, y: 5, w: 20, h: 20 })
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
