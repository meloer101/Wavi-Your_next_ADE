// 任务 board's state (PRD F9 v1.249): the cards main holds, the viewport, what is selected and the 「动态」 log.
//
// Main is the only writer of tasks (src/main/tasks); this store reads `window.tr.tasks.list()` once and takes every
// `onChanged` after it. The viewport is a per-device convenience kept in localStorage, losing it is harmless. The log
// only knows what changed since the window opened (a reload starts it empty).
import { create } from 'zustand'
import { CLI_AGENTS } from '@shared/agents'
import type { DispatchAgent } from '@shared/dispatch'
import type { Task, TaskId } from '@shared/task-board'
import type { ProjectId } from '@shared/types'
import { DEFAULT_VIEW, parseView, type View } from './layout'
import { appendEvents, type ActivityEvent, type LeaderChoice } from './model'
import { NO_PICKS, parseLeaderPicks, type LeaderPicks } from './picks'
import { toggleId } from './selection'

export const VIEW_KEY = 'tr.tasks.view.v1'
export const ACTIVITY_KEY = 'tr.tasks.activity.v1'
export const LEADER_KEY = 'tr.tasks.leader.v1'
export const PICKS_KEY = 'tr.tasks.picks.v1'
/** How long the undo bar stays after a delete (⌘Z still works after it has gone). */
export const UNDO_BAR_MS = 6_000

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
    return parseLeaderChoice(globalThis.localStorage?.getItem(LEADER_KEY) ?? null, CLI_AGENTS)
  } catch {
    return 'claude'
  }
}

function loadLeaderPicks(): LeaderPicks {
  try {
    return parseLeaderPicks(JSON.parse(globalThis.localStorage?.getItem(PICKS_KEY) ?? 'null'))
  } catch {
    return NO_PICKS
  }
}

function store(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Not saved; the default comes back next time.
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
  /** The selected cards, in the order they were picked (PRD F9 v1.252 框选和多选). */
  selected: readonly TaskId[]
  /** The card open in the detail overlay (114B). */
  detailId: TaskId | null
  /** The overlay opens with the title being edited (⌘E, 编辑). */
  detailEdit: boolean
  /** The last delete, for ⌘Z and the bar above the toolbar (`bar`: still shown). */
  deleted: { cards: Task[]; bar: boolean } | null
  /** Cards whose leader is starting: they are not offered 派发 a second time. */
  dispatching: readonly TaskId[]
  events: ActivityEvent[]
  /** The user's own toggle of 「动态」 (kept on this device); null = they never chose, the canvas width decides. */
  activityPref: boolean | null
  /** The project a pasted card went to last. */
  lastProjectId: ProjectId | null
  /** Who led the last pasted card; the new-card box starts with it. */
  leaderChoice: LeaderChoice
  /** Each agent's last model and effort. */
  leaderPicks: LeaderPicks
  setTasks(tasks: Task[]): void
  setView(view: View, touched?: boolean): void
  /** Selects this card alone, or nothing. */
  select(id: TaskId | null): void
  toggle(id: TaskId): void
  selectMany(ids: readonly TaskId[]): void
  openDetail(id: TaskId | null, edit?: boolean): void
  /** Remembers what a delete took (null: undone, nothing left to undo). */
  setDeleted(cards: Task[] | null): void
  setDispatching(id: TaskId, on: boolean): void
  pushEvents(drafts: Parameters<typeof appendEvents>[1]): void
  setActivity(open: boolean): void
  setLastProject(id: ProjectId): void
  setLeaderChoice(choice: LeaderChoice): void
  /** `null` goes back to 默认. */
  setLeaderPick(kind: 'models' | 'efforts', agent: DispatchAgent, value: string | null): void
}

let undoTimer: ReturnType<typeof setTimeout> | undefined

export const useTaskBoard = create<TaskBoardState>()((set, get) => {
  const view = loadView()
  return {
    tasks: [],
    loaded: false,
    view,
    viewTouched: view !== DEFAULT_VIEW,
    selected: [],
    detailId: null,
    detailEdit: false,
    deleted: null,
    dispatching: [],
    events: [],
    activityPref: loadActivityPref(),
    lastProjectId: null,
    leaderChoice: loadLeaderChoice(),
    leaderPicks: loadLeaderPicks(),
    setTasks: (tasks) =>
      set((s) => {
        const ids = new Set(tasks.map((t) => t.id))
        const kept = s.selected.filter((id) => ids.has(id))
        return { tasks, loaded: true, ...(kept.length !== s.selected.length ? { selected: kept } : {}), ...(s.detailId !== null && !ids.has(s.detailId) ? { detailId: null } : {}) }
      }),
    setView(next, touched = true) {
      set({ view: next, viewTouched: touched })
      saveView(next)
    },
    select: (id) => set({ selected: id === null ? [] : [id] }),
    toggle: (id) => set((s) => ({ selected: toggleId(s.selected, id) })),
    selectMany(ids) {
      const now = get().selected
      if (ids.length !== now.length || ids.some((id, i) => now[i] !== id)) set({ selected: ids })
    },
    openDetail: (detailId, edit = false) => set(detailId === null ? { detailId, detailEdit: false } : { detailId, detailEdit: edit, selected: [detailId] }),
    setDeleted(cards) {
      clearTimeout(undoTimer)
      set({ deleted: cards ? { cards, bar: true } : null })
      if (cards) undoTimer = setTimeout(() => set((s) => (s.deleted ? { deleted: { ...s.deleted, bar: false } } : {})), UNDO_BAR_MS)
    },
    setDispatching: (id, on) => set((s) => ({ dispatching: on ? [...s.dispatching, id] : s.dispatching.filter((other) => other !== id) })),
    pushEvents: (drafts) => set((s) => ({ events: appendEvents(s.events, drafts) })),
    setActivity(open) {
      set({ activityPref: open })
      store(ACTIVITY_KEY, open ? 'open' : 'closed')
    },
    setLastProject: (lastProjectId) => set({ lastProjectId }),
    setLeaderChoice(choice) {
      set({ leaderChoice: choice })
      store(LEADER_KEY, choice)
    },
    setLeaderPick(kind, agent, value) {
      const picks = get().leaderPicks
      const { [agent]: _old, ...others } = picks[kind]
      const next = { ...picks, [kind]: value === null ? others : { ...others, [agent]: value } }
      set({ leaderPicks: next })
      store(PICKS_KEY, JSON.stringify(next))
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
