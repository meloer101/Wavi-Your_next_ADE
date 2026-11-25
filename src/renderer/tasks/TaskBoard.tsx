// 「任务」 (PRD F9 v1.249 · Figma 115A4): every project's cards on one infinite canvas. Drag empty canvas (or hold Space
// and drag), or scroll with two fingers, to pan; ⌘-scroll and pinch zoom around the pointer. Notes shrink to chips and
// dots as it zooms out. Layout and viewport maths are in layout.ts, the dot grid in DotField.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { buildTaskTree, childSegments, taskProgress, waitingBelow, type TaskId, type TaskNode, type TaskState } from '@shared/task-board'
import { useShallow } from 'zustand/react/shallow'
import { subscribeClock } from '../sidebar/clock'
import { useOverviewStore } from '../overview/store'
import { useWorkspace } from '../state/workspace'
import { Compose } from './Compose'
import { Detail } from './Detail'
import { DotField } from './DotField'
import { drawingFor, fitView, groupByProject, layoutBoard, panBy, scaleFor, zoomAround, type LayoutMode, type Rect, type Size } from './layout'
import { diffActivity, matchesFilter, snapshotOf, type Snapshot } from './model'
import { Note, type NoteInfo } from './Note'
import { ActivityPanel, Toolbar, ZoomControl } from './Panes'
import { activityShown, defaultProject, startTaskSync, useTaskBoard } from './store'
import { useCards } from './use-cards'
import styles from './TaskBoard.module.css'

const ZOOM_STEP = 1.25
const DRAG_SLOP = 3
const TICK_MS = 15_000

/** The last look at the cards, kept across tab switches so what happened while the tab was away still shows up. */
let lastSnapshot: Snapshot | null = null

const EMPTY_INFO: NoteInfo = { segments: [], progress: { done: 0, total: 0 }, waiting: 0 }

export function TaskBoard() {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [composing, setComposing] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const { view, selectedId, detailId, events, activityPref, lastProjectId, loaded } = useTaskBoard(
    useShallow((s) => ({ view: s.view, selectedId: s.selectedId, detailId: s.detailId, events: s.events, activityPref: s.activityPref, lastProjectId: s.lastProjectId, loaded: s.loaded }))
  )
  const tasks = useTaskBoard((s) => s.tasks)
  const filter = useOverviewStore((s) => s.filter)
  const cards = useCards()
  const { projects, worktrees, sessions, activeSessionId } = useWorkspace(
    useShallow((s) => ({ projects: s.projects, worktrees: s.worktrees, sessions: s.sessions, activeSessionId: s.activeSessionId }))
  )

  useEffect(() => startTaskSync(), [])
  // Coming to the tab from its button leaves the focus on the button: the board's keys (N, ⇧1, ⌥D, Space) live on the
  // tab's body, so take it, unless the user is already typing somewhere.
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('input, textarea, select')) return
    host.current?.parentElement?.focus()
  }, [])
  useEffect(() => subscribeClock(() => setNow(Math.floor(Date.now() / TICK_MS) * TICK_MS)), [])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Space is "down" only while the key is: a window that loses focus never sees the keyup (blur clears it), and while a
  // dialog or the input note is open it does not count (`spacePans`).
  useEffect(() => {
    const release = (): void => setSpaceDown(false)
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') release()
    }
    window.addEventListener('blur', release)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('blur', release)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ── Layout ──
  const stateOf = useMemo(() => {
    const byId = new Map<TaskId, TaskState>(cards.map((c) => [c.task.id, c.state]))
    return (id: TaskId): TaskState => byId.get(id) ?? 'idle'
  }, [cards])
  const trees = useMemo(() => groupByProject(tasks, projects.map((p) => p.id), buildTaskTree), [tasks, projects])
  const layouts = useMemo(() => ({ note: layoutBoard(trees, 'note'), chip: layoutBoard(trees, 'chip') }), [trees])
  const bounds = useMemo<Record<LayoutMode, Rect>>(() => ({ note: layouts.note.bounds, chip: layouts.chip.bounds }), [layouts])
  const drawing = drawingFor(view.zoom)
  const layout = drawing === 'note' ? layouts.note : layouts.chip
  const scale = scaleFor(view.zoom)

  const infos = useMemo(() => {
    const out = new Map<TaskId, NoteInfo>()
    const walk = (node: TaskNode): void => {
      const stateFn = (t: { id: TaskId }): TaskState => stateOf(t.id)
      out.set(node.task.id, {
        segments: childSegments(node, stateFn),
        progress: taskProgress(node, stateFn),
        waiting: waitingBelow(node, stateFn)
      })
      for (const child of node.children) walk(child)
    }
    for (const t of trees) for (const root of t.roots) walk(root)
    return out
  }, [trees, stateOf])

  const cardById = useMemo(() => new Map(cards.map((c) => [c.task.id, c])), [cards])
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const activeProject = useMemo(() => {
    const worktreeId = sessions.find((s) => s.id === activeSessionId)?.worktreeId
    return worktrees.find((w) => w.id === worktreeId)?.projectId
  }, [sessions, worktrees, activeSessionId])

  // ── 动态: what changed since the last look ──
  useEffect(() => {
    if (!loaded) return
    const next = snapshotOf(cards)
    const drafts = diffActivity(lastSnapshot, next, Date.now())
    lastSnapshot = next
    if (drafts.length > 0) useTaskBoard.getState().pushEvents(drafts)
  }, [cards, loaded])

  // ── Viewport ──
  const fit = useCallback(() => {
    const s = host.current?.getBoundingClientRect()
    if (s) useTaskBoard.getState().setView(fitView(bounds, { w: s.width, h: s.height }))
  }, [bounds])
  // The first time there is something to show and no saved view, show all of it.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !loaded || size.w === 0 || tasks.length === 0) return
    fitted.current = true
    if (!useTaskBoard.getState().viewTouched) fit()
  }, [loaded, size.w, tasks.length, fit])

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      const state = useTaskBoard.getState()
      const at = anchor ?? { x: size.w / 2, y: size.h / 2 }
      state.setView(zoomAround(state.view, state.view.zoom * factor, at, bounds))
    },
    [bounds, size]
  )

  // Wheel: ⌘ / pinch zooms around the pointer, anything else pans. Non-passive so the page does not scroll or zoom.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('[data-no-pan]')) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const state = useTaskBoard.getState()
      if (e.metaKey || e.ctrlKey) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
        state.setView(zoomAround(state.view, state.view.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }, bounds))
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        state.setView(panBy(state.view, -dx, -dy))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [bounds])

  // ── Opening a card, pasting one ──
  const openDetail = useTaskBoard.getState().openDetail
  const onSelect = useCallback((id: string) => useTaskBoard.getState().select(id), [])
  const onOpen = useCallback((id: string) => useTaskBoard.getState().openDetail(id), [])
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects])
  const startCompose = useCallback(() => {
    if (projectIds.length > 0) setComposing(true)
  }, [projectIds])
  const paste = async (projectId: string, title: string): Promise<boolean> => {
    const made = await window.tr.tasks.create({ projectId, title })
    if (!made) return false
    const state = useTaskBoard.getState()
    state.setLastProject(projectId)
    state.select(made.id)
    setComposing(false)
    host.current?.parentElement?.focus()
    return true
  }

  // ── Keys: on the tab's body, which holds the keyboard; inputs keep their own ──
  useEffect(() => {
    const body = host.current?.parentElement
    if (!body) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, [role="dialog"]')) return
      if (e.altKey && e.code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const state = useTaskBoard.getState()
        state.setActivity(!activityShown(state.activityPref, host.current?.clientWidth ?? 0))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const state = useTaskBoard.getState()
      if (e.key === ' ') {
        // Hold Space to pan with a drag; a Space on a button keeps its own meaning.
        if (target.closest('button')) return
        e.preventDefault()
        setSpaceDown(true)
      } else if (e.code === 'Digit1' && e.shiftKey) {
        e.preventDefault()
        fit()
      } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault()
        startCompose()
      } else if (e.key === 'Enter' && state.selectedId !== null) {
        if (target.closest('button')) return
        e.preventDefault()
        state.openDetail(state.selectedId)
      } else if (e.key === 'Escape' && state.selectedId !== null) {
        e.preventDefault()
        state.select(null)
      }
    }
    body.addEventListener('keydown', onKey)
    return () => body.removeEventListener('keydown', onKey)
  }, [fit, startCompose])

  // ── Panning ──
  const spacePans = spaceDown && !composing && detailId === null
  // `card`: the card the press started on (Space-drag over a note); pointer capture sends the pointerup to the board, so
  // where it started, not where it ended, says whether it was a click on a note.
  const drag = useRef<{ x: number; y: number; moved: boolean; card: string | null } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-pan], button, input, select')) return
    const onCard = target.closest('[data-task-id]') !== null
    if (onCard && !spacePans) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, card: target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null }
    e.currentTarget.setPointerCapture(e.pointerId)
    host.current?.parentElement?.focus()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    if (!d.moved) setPanning(true)
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    const state = useTaskBoard.getState()
    state.setView(panBy(state.view, dx, dy))
  }
  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (d && !d.moved) useTaskBoard.getState().select(d.card)
  }
  const onPointerCancel = (): void => {
    drag.current = null
    setPanning(false)
  }

  // ── Render ──
  const activityOpen = activityShown(activityPref, size.w)
  const detail = detailId !== null ? cardById.get(detailId) : undefined
  const compose = composing ? defaultProject(projectIds, lastProjectId, activeProject) : undefined

  // The world's content depends on the layout and the cards, not on the viewport: memoized, so panning and zooming
  // re-render the transform and nothing under it (the links, labels and notes keep their elements).
  const world = useMemo(
    () => (
      <>
        <svg className={styles.links} width="1" height="1" aria-hidden>
          {layout.links.map((l) => {
            const mid = (l.x1 + l.x2) / 2
            const r = drawing === 'note' ? 4 : 2.5
            return (
              <g key={`${l.fromId}-${l.toId}`} className={styles.link}>
                <path d={`M${l.x1} ${l.y1} C${mid} ${l.y1} ${mid} ${l.y2} ${l.x2} ${l.y2}`} />
                <circle cx={l.x1} cy={l.y1} r={r} />
                <circle cx={l.x2} cy={l.y2} r={r} />
              </g>
            )
          })}
        </svg>
        {layout.cards.map((placed) => {
          const card = cardById.get(placed.id)
          if (!card) return null
          return (
            <Note
              key={placed.id}
              card={card}
              placed={placed}
              drawing={drawing}
              info={infos.get(placed.id) ?? EMPTY_INFO}
              selected={selectedId === placed.id}
              dimmed={filter.trim() !== '' && !matchesFilter(card.task, projectName.get(card.task.projectId) ?? '', filter)}
              now={now}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          )
        })}
      </>
    ),
    [layout, drawing, cardById, infos, selectedId, filter, projectName, now, onSelect, onOpen]
  )

  return (
    <div
      ref={host}
      className={styles.board}
      data-testid="task-board"
      data-drawing={drawing}
      data-panning={panning}
      data-space={spacePans}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <DotField view={view} size={size} />
      <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})` }}>
        {world}
      </div>
      <ActivityPanel events={events} open={activityOpen} onToggle={() => useTaskBoard.getState().setActivity(!activityOpen)} />
      <Toolbar onAdd={startCompose} onFit={fit} />
      <ZoomControl zoom={view.zoom} onStep={(dir) => zoomBy(dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP)} />
      {compose !== undefined && <Compose projects={projects} initialProject={compose} onSubmit={paste} onCancel={() => { setComposing(false); host.current?.parentElement?.focus() }} />}
      {detail && (
        <Detail
          card={detail}
          children={cards.filter((c) => c.task.parentId === detail.task.id).sort((a, b) => a.task.createdAt - b.task.createdAt || a.task.seq - b.task.seq)}
          descendants={descendantsOf(tasks, detail.task.id)}
          projectName={projectName.get(detail.task.projectId) ?? ''}
          parentTitle={detail.task.parentId !== undefined ? cardById.get(detail.task.parentId)?.task.title : undefined}
          worktree={worktrees.find((w) => w.id === sessions.find((s) => s.id === detail.session?.id)?.worktreeId)}
          dispatcher={detail.task.createdBy !== 'user' ? sessions.find((s) => s.id === detail.task.createdBy) : undefined}
          now={now}
          onClose={() => {
            openDetail(null)
            host.current?.parentElement?.focus()
          }}
        />
      )}
    </div>
  )
}

function descendantsOf(tasks: readonly { id: string; parentId?: string }[], id: string): number {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const t of tasks) if (t.parentId === out[i] && !out.includes(t.id)) out.push(t.id)
  return out.length - 1
}
