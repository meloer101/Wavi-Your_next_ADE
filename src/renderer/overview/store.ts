// 看板 UI state (PRD F9): which tab, what is selected, the board overlay, the filter and the batch.
// The tab and the overlay's place are per-viewer conveniences kept in localStorage; losing them is harmless.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { addToLayout, layoutIds, MAX_PANES, PICKER_SLOT, removeFromLayout, replaceInLayout, singleLayout, type PaneLayout, type Rect } from './pane-layout'

/** 进度: the sessions by status (the board); 任务: the task notes on an infinite canvas (v1.249); GitHub: each project's open issues and PRs (v1.184). */
export type BoardTab = 'progress' | 'tasks' | 'github'

const PREFS_KEY = 'tr.overview.v1'

interface Prefs {
  tab: BoardTab
  /** Where the board overlay sits once its edges were dragged (window px); null = the default, centered (PRD F9). */
  overlayRect: Rect | null
}

const DEFAULT_PREFS: Prefs = { tab: 'progress', overlayRect: null }

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
    const value = raw as Partial<Prefs>
    // Saved before v1.184 there was `view` (列表 / 看板) instead: both are 进度 now.
    return { tab: value.tab === 'github' || value.tab === 'tasks' ? value.tab : 'progress', overlayRect: isRect(value.overlayRect) ? value.overlayRect : null }
  } catch {
    return DEFAULT_PREFS
  }
}

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Partial<Rect>
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))
}

function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Not saved; the defaults come back next time.
  }
}

interface OverviewState extends Prefs {
  selectedId: SessionId | null
  /** The sessions tiled in the overlay over the board (at most four, pane-layout.ts); null = closed. */
  layout: PaneLayout | null
  /** The overlay shows one more tile for picking the next session to add; it sits in `layout` as PICKER_SLOT. */
  picking: boolean
  filter: string
  /** 一题多解: the attempt group the overlay compares (its members' tiles get a compare bar); null otherwise. */
  compareGroup: string | null
  /** Sessions picked with ⌘ / ⇧ for a batch action (F9 批量操作), in the order they were picked. */
  picked: SessionId[]
  /** Where a ⇧-click range starts: the last session clicked with or without ⌘. */
  pickAnchor: SessionId | null

  setTab(tab: BoardTab): void
  select(id: SessionId | null): void
  /** Opens the board's overlay on just this session (a card click), or closes it with null. */
  openOverlay(id: SessionId | null): void
  setLayout(layout: PaneLayout): void
  addPane(id: SessionId): void
  closePane(id: SessionId): void
  setPicking(picking: boolean): void
  setFilter(filter: string): void
  setOverlayRect(rect: Rect | null): void
  /** Opens the overlay on an attempt group's members, side by side. */
  openCompare(groupId: string, ids: readonly SessionId[]): void
  setPicked(ids: SessionId[], anchor?: SessionId | null): void
}

export const useOverviewStore = create<OverviewState>()((set, get) => ({
  ...loadPrefs(),
  selectedId: null,
  layout: null,
  picking: false,
  filter: '',
  compareGroup: null,
  picked: [],
  pickAnchor: null,

  setTab(tab) {
    // The session overlay belongs to 进度: switching to GitHub closes it.
    set({ tab, layout: null, picking: false, compareGroup: null, filter: '' })
    savePrefs({ ...prefsOf(get()), tab })
  },
  select: (id) => set({ selectedId: id }),
  openOverlay: (id) => set({ layout: id ? singleLayout(id) : null, picking: false, compareGroup: null, ...(id ? { selectedId: id } : {}) }),
  setLayout: (layout) => set({ layout }),
  addPane(id) {
    const { layout, picking } = get()
    const next = !layout ? singleLayout(id) : picking ? replaceInLayout(layout, PICKER_SLOT, id) : addToLayout(layout, id)
    set({ layout: next, picking: false, selectedId: id })
  },
  closePane(id) {
    const layout = get().layout
    const next = layout ? removeFromLayout(layout, id) : null
    // Closing the last terminal closes the overlay, picker included.
    set(next && layoutIds(next).length > 0 ? { layout: next } : { layout: null, picking: false, compareGroup: null })
  },
  setPicking(picking) {
    const layout = get().layout
    if (!layout || picking === get().picking) return
    // The picker is a tile of the layout while it shows, so the gaps around it resize like any other.
    set({ picking, layout: picking ? addToLayout(layout, PICKER_SLOT) : removeFromLayout(layout, PICKER_SLOT) })
  },
  setFilter: (filter) => set({ filter }),
  setOverlayRect(overlayRect) {
    set({ overlayRect })
    savePrefs({ ...prefsOf(get()), overlayRect })
  },
  openCompare(groupId, ids) {
    const [first, ...rest] = ids.slice(0, MAX_PANES)
    if (!first) return
    // A comparison is a 进度 overlay: it opens there whichever tab was showing.
    set({ tab: 'progress', layout: rest.reduce(addToLayout, singleLayout(first)), picking: false, compareGroup: groupId, selectedId: first })
  },
  setPicked: (picked, anchor) => set({ picked, ...(anchor !== undefined ? { pickAnchor: anchor } : {}) })
}))

function prefsOf({ tab, overlayRect }: Prefs): Prefs {
  return { tab, overlayRect }
}

/** ⌘⇧A, the sidebar entry and ⌘K: show 看板, or go back to the session it was opened from. */
export function toggleOverview(): void {
  const workspace = useWorkspace.getState()
  workspace.setMainView(workspace.mainView === 'overview' ? 'session' : 'overview')
}

/** Leaves the overview for a session's terminal. */
export function enterSession(id: SessionId): void {
  useOverviewStore.setState({ layout: null, picking: false, compareGroup: null })
  useWorkspace.getState().setActiveSession(id)
}

/** 一题多解: the overview, with the overlay comparing the group's members (the main window comes forward). */
export function showCompare(groupId: string, ids: readonly SessionId[]): void {
  useOverviewStore.getState().openCompare(groupId, ids)
  useWorkspace.getState().setMainView('overview')
}
