// What the board does to cards (PRD F9 v1.252): dispatch a root card to its leader, delete with undo, cancel and
// restore, put back in the tree's place. Main stays the only writer; these call `window.tr.tasks`.
import type { DispatchAgent } from '@shared/dispatch'
import type { Task, TaskId } from '@shared/task-board'
import { startCardLeader, type LeaderFailure, type LeaderOptions } from '../dispatch/task-deliver'
import { isLeaderFailureNote, leaderFailureNote } from './model'
import { subtreesOf, topmost } from './selection'
import { useTaskBoard } from './store'

/**
 * Starts the card's leader (贴上 with an agent, or 派发 later). A failure is said on the card (its note) and in 「动态」,
 * and the card stays 待派发; a success clears an earlier failure's note.
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
    const result = await startCardLeader(task, agent, options)
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

/** Deletes the cards and everything below them, without asking; the removed cards are kept for ⌘Z. */
export async function deleteCards(ids: readonly TaskId[]): Promise<void> {
  const { tasks, setDeleted } = useTaskBoard.getState()
  const removed = subtreesOf(tasks, ids)
  if (removed.length === 0) return
  setDeleted(removed)
  // Sent together, so main has every remove before a ⌘Z's restore can reach it.
  await Promise.all(topmost(tasks, ids).map((id) => window.tr.tasks.remove(id)))
}

/** Puts the last deleted cards back as they were, and selects the ones that were picked. */
export async function undoDelete(): Promise<void> {
  const { deleted, setDeleted } = useTaskBoard.getState()
  if (!deleted) return
  // Taken at once: a second ⌘Z while main answers has nothing to put back twice.
  setDeleted(null)
  const ok = await window.tr.tasks.restore(deleted.cards).catch(() => false)
  if (!ok) {
    console.error('[tasks] the deleted cards could not be put back')
    return
  }
  const ids = new Set(deleted.cards.map((c) => c.id))
  useTaskBoard.getState().selectMany(deleted.cards.filter((c) => c.parentId === undefined || !ids.has(c.parentId)).map((c) => c.id))
}

export function setManual(ids: readonly TaskId[], manual: 'todo' | 'canceled'): void {
  for (const id of ids) void window.tr.tasks.update(id, { manual })
}

/** 恢复自动排: the cards go back where their tree puts them. */
export function resetPlaces(ids: readonly TaskId[]): void {
  for (const id of ids) void window.tr.tasks.update(id, { pos: null })
}
