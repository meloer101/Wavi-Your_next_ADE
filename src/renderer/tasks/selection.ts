// 任务 board's selection maths (PRD F9 v1.252 框选和多选): pure, no DOM. The selection is a list of card ids; the
// marquee is hit-tested in world coordinates (layout.ts), so it works at every zoom.
import type { Task, TaskId } from '@shared/task-board'
import { scaleFor, type Rect, type View } from './layout'

export interface Point {
  x: number
  y: number
}

/** The box between where the marquee started and where the pointer is, whichever way it was drawn. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** A point of the board element (px from its top-left) in the layout's coordinates. */
export function toWorld(view: View, point: Point): Point {
  const s = scaleFor(view.zoom)
  return { x: (point.x - view.x) / s, y: (point.y - view.y) / s }
}

/**
 * The marquee from where it started on the world to where the pointer is in the board now: the world box (what it
 * selects) and the board box (what is drawn). The start is held in world coordinates, so the box follows a pan or a zoom.
 */
export function marqueeBox(view: View, from: Point, to: Point): { world: Rect; screen: Rect } {
  const s = scaleFor(view.zoom)
  const start = { x: view.x + from.x * s, y: view.y + from.y * s }
  return { world: rectBetween(from, toWorld(view, to)), screen: rectBetween(start, to) }
}

/** Every card the box touches: overlapping is enough, it need not hold the whole card. */
export function cardsTouching(cards: readonly (Rect & { id: TaskId })[], box: Rect): TaskId[] {
  return cards.filter((c) => c.x < box.x + box.w && c.x + c.w > box.x && c.y < box.y + box.h && c.y + c.h > box.y).map((c) => c.id)
}

/** ⇧-click: the card joins the selection, or leaves it. */
export function toggleId(ids: readonly TaskId[], id: TaskId): TaskId[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]
}

/**
 * The selected cards none of whose ancestors is selected: what a group drag moves and a delete asks main to remove (the
 * rest go with their ancestor).
 */
export function topmost(tasks: readonly Pick<Task, 'id' | 'parentId'>[], ids: readonly TaskId[]): TaskId[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const chosen = new Set(ids)
  return ids.filter((id) => {
    if (!byId.has(id)) return false
    const seen = new Set<TaskId>([id])
    for (let at = byId.get(id)?.parentId; at !== undefined && !seen.has(at); at = byId.get(at)?.parentId) {
      if (chosen.has(at)) return false
      seen.add(at)
    }
    return true
  })
}

export interface DeletedSummary {
  /** The one card deleted from the top, when there was only one. */
  seq?: number
  /** Every card removed, that one included. */
  count: number
}

export function deletedSummary(removed: readonly Task[]): DeletedSummary {
  const ids = new Set(removed.map((t) => t.id))
  const tops = removed.filter((t) => t.parentId === undefined || !ids.has(t.parentId))
  return { count: removed.length, ...(tops.length === 1 ? { seq: tops[0]!.seq } : {}) }
}
