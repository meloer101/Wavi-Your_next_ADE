// What the board does to cards (PRD F9 v1.252): dispatch a root card to its leader, delete with undo, cancel and
// restore, put back in the tree's place. Main stays the only writer; these call `window.tr.tasks`.
import type { DispatchAgent } from '@shared/dispatch'
import type { Task, TaskId } from '@shared/task-board'
import { startCardLeader, type LeaderFailure, type LeaderOptions } from '../dispatch/task-deliver'
import { isLeaderFailureNote, leaderFailureNote } from './model'
import { topmost } from './selection'
import { useTaskBoard } from './store'

/**
 * Starts the card's leader (贴上 with an agent, or 派发 later). A failure is said on the card (its note) and in 「动态」;
 * a success clears an earlier failure's note.
 */
export async function dispatchLeader(task: Task, agent: DispatchAgent, options: LeaderOptions): Promise<void> {
  const state = useTaskBoard.getState()
  if (state.dispatching.includes(task.id)) return
  state.setDispatching(task.id, true)
  const failed = async (reason: LeaderFailure): Promise<void> => {
    state.pushEvents([{ at: Date.now(), kind: 'notDispatched', seq: task.seq, title: task.title, reason }])
    await window.tr.tasks.update(task.id, { note: leaderFailureNote(reason) })
  }
  try {
    // A card typed after the start can still fail to arrive, long after this returns.
    const result = await startCardLeader(task, agent, options, (reason) => void failed(reason).catch(() => {}))
    if (!result.ok) await failed(result.reason)
    // The card as it is now: an agent may have written its own note meanwhile.
    else if (isLeaderFailureNote(useTaskBoard.getState().tasks.find((t) => t.id === task.id)?.note)) await window.tr.tasks.update(task.id, { note: null })
  } catch (error) {
    console.error('[tasks] the leader did not start:', error)
    await failed('failed').catch(() => {})
  } finally {
    state.setDispatching(task.id, false)
  }
}

// Deletes and undos run one after another: a ⌘Z right after ⌫ waits for main's answer, and each ⌘Z takes the next one.
let queue: Promise<void> = Promise.resolve()
const inTurn = (work: () => Promise<void>): Promise<void> => (queue = queue.then(work).catch((error: unknown) => console.error('[tasks] delete or undo failed:', error)))

/**
 * Deletes the cards and everything below them, without asking. What ⌘Z puts back is what main says it removed, so a
 * card an agent added a moment ago comes back too.
 */
export function deleteCards(ids: readonly TaskId[]): Promise<void> {
  return inTurn(async () => {
    const removed: Task[] = []
    for (const id of topmost(useTaskBoard.getState().tasks, ids)) removed.push(...(await window.tr.tasks.remove(id)))
    if (removed.length > 0) useTaskBoard.getState().pushDeleted(removed)
  })
}

/** Puts the latest delete's cards back as they were, and selects the ones at the top of it. */
export function undoDelete(): Promise<void> {
  return inTurn(async () => {
    const cards = useTaskBoard.getState().undo.stack.at(-1)
    if (!cards) return
    const ok = await window.tr.tasks.restore(cards).catch(() => false)
    if (!ok) {
      useTaskBoard.getState().undoFailed()
      return
    }
    useTaskBoard.getState().popDeleted(cards)
    const ids = new Set(cards.map((c) => c.id))
    useTaskBoard.getState().selectMany(cards.filter((c) => c.parentId === undefined || !ids.has(c.parentId)).map((c) => c.id))
  })
}

export function setManual(ids: readonly TaskId[], manual: 'todo' | 'canceled'): void {
  for (const id of ids) void window.tr.tasks.update(id, { manual })
}

/** 恢复自动排: the cards go back where their tree puts them. */
export function resetPlaces(ids: readonly TaskId[]): void {
  for (const id of ids) void window.tr.tasks.update(id, { pos: null })
}
