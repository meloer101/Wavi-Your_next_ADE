// What moved on the board since the last look, for the motion of PRD F9 v1.250 (动效): a card that appeared, a session that
// was bound (the pin), a card that began waiting on the user or finished, one canceled, one that is gone. Pure: it only
// compares two snapshots (model.ts `snapshotOf`), so nothing plays on the first load, on a tab switch, or on pan and zoom.
import { useSyncExternalStore } from 'react'
import type { TaskId } from '@shared/task-board'
import type { Snapshot } from './model'

export interface MotionEvents {
  /** New cards pasted as roots: they land on the board. */
  land: TaskId[]
  /** New cards below another: they slide out of it along a line that draws in. `order` staggers a batch (60 ms each). */
  slide: Array<{ id: TaskId; order: number }>
  /** Cards that just got a session (the pin drops). */
  pin: TaskId[]
  /** Cards that now wait on the user. */
  attention: TaskId[]
  /** Cards that now are done. */
  done: TaskId[]
  /** Cards that were canceled. */
  cancel: TaskId[]
  /** Cards that are gone (deleted, with what hung below them). */
  removed: TaskId[]
}

export const STAGGER_MS = 60

const EMPTY: MotionEvents = { land: [], slide: [], pin: [], attention: [], done: [], cancel: [], removed: [] }

export const hasMotion = (e: MotionEvents): boolean => Object.values(e).some((list) => list.length > 0)

export function diffMotion(prev: Snapshot | null, next: Snapshot): MotionEvents {
  if (!prev) return EMPTY
  const out: MotionEvents = { land: [], slide: [], pin: [], attention: [], done: [], cancel: [], removed: [] }
  const born: Array<{ id: TaskId; seq: number }> = []
  for (const [id, now] of next) {
    const before = prev.get(id)
    if (!before) {
      if (now.parentId !== undefined && next.has(now.parentId)) born.push({ id, seq: now.seq })
      else out.land.push(id)
      continue
    }
    if (now.sessionId !== undefined && before.sessionId === undefined) out.pin.push(id)
    if (now.state === before.state) continue
    if (now.state === 'attention') out.attention.push(id)
    else if (now.state === 'done') out.done.push(id)
    else if (now.state === 'canceled') out.cancel.push(id)
  }
  out.slide = born.sort((a, b) => a.seq - b.seq).map((b, order) => ({ id: b.id, order }))
  for (const id of prev.keys()) if (!next.has(id)) out.removed.push(id)
  return out
}

const REDUCED = '(prefers-reduced-motion: reduce)'

/** The system's 「减少动态效果」: no ripples, no tilt, no panning of the view (the CSS shortens the rest to a fade). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED)
      query.addEventListener('change', notify)
      return () => query.removeEventListener('change', notify)
    },
    () => window.matchMedia(REDUCED).matches
  )
}
