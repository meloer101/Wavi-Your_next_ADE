// 任务 board's state (PRD F9 v1.249): the cards main holds, the viewport, what is selected and the 「动态」 log.
//
// Main is the only writer of tasks (src/main/tasks); this store reads `window.tr.tasks.list()` once and takes every
// `onChanged` after it. The viewport is a per-device convenience kept in localStorage, losing it is harmless. The log
// only knows what changed since the window opened (a reload starts it empty).
import { create } from 'zustand'
import { CLI_AGENTS } from '@shared/agents'
import { canLead, type DispatchAgent } from '@shared/dispatch'
import type { Task, TaskId } from '@shared/task-board'
import type { ProjectId } from '@shared/types'
import { DEFAULT_VIEW, parseView, type View } from './layout'
import { appendEvents, type ActivityEvent, type LeaderChoice } from './model'

export const VIEW_KEY = 'tr.tasks.view.v1'
export const ACTIVITY_KEY = 'tr.tasks.activity.v1'
export const LEADER_KEY = 'tr.tasks.leader.v1'

export type { LeaderChoice } from './model'

/** The last choice, kept on this device; the first time it is Claude Code. A stored agent that no longer exists reads as that. */
export function parseLeaderChoice(raw: string | null, known: readonly DispatchAgent[]): LeaderChoice {
  if (raw === 'none') return 'none'
  return known.find((id) => id === raw) ?? 'claude'
}
/** The 「动态」 panel starts collapsed on a canvas narrower than this (px). */
export const ACTIVITY_MIN_WIDTH = 1100

/** Whether 「动态」 is open: the user's own choice when they made one, else open only on a wide enough canvas. */
export function activityShown(pref: boolean | null, canvasWidth: number): boolean {
  return pref ?? canvasWidth >= ACTIVITY_MIN_WIDTH
}

function loadActivityPref(): boolean | null {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVITY_KEY)
    return raw === 'open' ? true : raw === 'closed' ? false : null
  } catch {
    return null
  }
}

function loadLeaderChoice(): LeaderChoice {
  try {
    return parseLeaderChoice(globalThis.localStorage?.getItem(LEADER_KEY) ?? null, CLI_AGENTS.filter((id) => canLead(id)))
  } catch {
    return 'claude'
  }
}

function loadView(): View {
  try {
    return parseView(JSON.parse(globalThis.localStorage?.getItem(VIEW_KEY) ?? 'null'))
  } catch {
    return DEFAULT_VIEW
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** The viewport moves on every wheel event: it is written once it settles. */
function saveView(view: View): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // Not saved; the default view comes back next time.
    }
  }, 250)
}

interface TaskBoardState {
  tasks: Task[]
  /** The first list arrived: before it the board is empty only because nothing is loaded. */
  loaded: boolean
  view: View
  /** Whether the user moved the view; until then the board fits itself to the window once. */
  viewTouched: boolean
  selectedId: TaskId | null
  /** The card open in the detail overlay (114B). */
  detailId: TaskId | null
  events: ActivityEvent[]
  /** The user's own toggle of 「动态」 (kept on this device); null = they never chose, the canvas width decides. */
  activityPref: boolean | null
  /** The project a pasted card went to last. */
  lastProjectId: ProjectId | null
  /** Who led the last pasted card; the new-card box starts with it. */
  leaderChoice: LeaderChoice
  setTasks(tasks: Task[]): void
  setView(view: View, touched?: boolean): void
  select(id: TaskId | null): void
  openDetail(id: TaskId | null): void
  pushEvents(drafts: Parameters<typeof appendEvents>[1]): void
  setActivity(open: boolean): void
  setLastProject(id: ProjectId): void
  setLeaderChoice(choice: LeaderChoice): void
}

export const useTaskBoard = create<TaskBoardState>()((set) => {
  const view = loadView()
  return {
    tasks: [],
    loaded: false,
    view,
    viewTouched: view !== DEFAULT_VIEW,
    selectedId: null,
    detailId: null,
    events: [],
    activityPref: loadActivityPref(),
    lastProjectId: null,
    leaderChoice: loadLeaderChoice(),
    setTasks: (tasks) => set((s) => ({ tasks, loaded: true, ...(s.selectedId !== null && !tasks.some((t) => t.id === s.selectedId) ? { selectedId: null } : {}), ...(s.detailId !== null && !tasks.some((t) => t.id === s.detailId) ? { detailId: null } : {}) })),
    setView(next, touched = true) {
      set({ view: next, viewTouched: touched })
      saveView(next)
    },
    select: (selectedId) => set({ selectedId }),
    openDetail: (detailId) => set(detailId === null ? { detailId } : { detailId, selectedId: detailId }),
    pushEvents: (drafts) => set((s) => ({ events: appendEvents(s.events, drafts) })),
    setActivity(open) {
      set({ activityPref: open })
      try {
        globalThis.localStorage?.setItem(ACTIVITY_KEY, open ? 'open' : 'closed')
      } catch {
        // Not saved; the width default comes back next time.
      }
    },
    setLastProject: (lastProjectId) => set({ lastProjectId }),
    setLeaderChoice(choice) {
      set({ leaderChoice: choice })
      try {
        globalThis.localStorage?.setItem(LEADER_KEY, choice)
      } catch {
        // Not saved; Claude Code comes back next time.
      }
    }
  }
})

/** Loads the cards and follows main's changes; returns the unsubscribe. Called while the tab is open. */
export function startTaskSync(): () => void {
  const api = window.tr.tasks
  let alive = true
  // A change that arrives before the first list wins: the list is older than it.
  let changed = false
  const off = api.onChanged((tasks) => {
    changed = true
    useTaskBoard.getState().setTasks(tasks)
  })
  void api
    .list()
    .then((tasks) => {
      if (alive && !changed) useTaskBoard.getState().setTasks(tasks)
    })
    .catch(() => {
      if (alive && !changed) useTaskBoard.getState().setTasks([])
    })
  return () => {
    alive = false
    off()
  }
}

/** Where a pasted card goes when the user did not pick a project: the last used, else the selected session's, else the first. */
export function defaultProject(
  projectIds: readonly ProjectId[],
  last: ProjectId | null,
  activeSessionProject: ProjectId | undefined
): ProjectId | undefined {
  if (last !== null && projectIds.includes(last)) return last
  if (activeSessionProject !== undefined && projectIds.includes(activeSessionProject)) return activeSessionProject
  return projectIds[0]
}
