// 「任务」 (PRD F9 v1.249 · Figma 115A4 / 117): every project's cards on one infinite canvas. Scroll with two fingers,
// hold Space and drag, or drag with the middle button to pan; ⌘-scroll and pinch zoom around the pointer. A drag on
// empty canvas is a marquee, ⇧-click adds a card to the selection, a right-click opens a menu (v1.252). Notes shrink to
// chips and dots as it zooms out. Layout and viewport maths are in layout.ts, selection maths in selection.ts, the dot
// grid in DotField.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Session } from '@shared/types'
import { defineMessages } from '@shared/i18n'
import { buildTaskTree, childSegments, parseTaskPos, taskDepth, taskProgress, waitingBelow, TASK_LIMITS, TASK_POS_LIMIT, type TaskId, type TaskNode, type TaskPos, type TaskState } from '@shared/task-board'
import { useShallow } from 'zustand/react/shallow'
import { subscribeClock } from '../sidebar/clock'
import { useOverviewStore } from '../overview/store'
import { useWorkspace } from '../state/workspace'
import { useMessages } from '../ui/i18n'
import { deleteCards, dispatchLeader, resetPlaces, setManual, undoDelete } from './actions'
import { Compose, type ComposeResult } from './Compose'
import { Detail } from './Detail'
import { DotField, type RippleEvent } from './DotField'
import { DIMS, drawingFor, fitView, groupByProject, layoutBoard, modeFor, panBy, scaleFor, visibleWorld, zoomAround, type BoardLayout, type Drawing, type LayoutMode, type Link, type PlacedCard, type PosOverrides, type Rect, type Size } from './layout'
import { diffActivity, matchesFilter, snapshotOf, type Card, type Snapshot } from './model'
import { diffMotion, hasMotion, useReducedMotion } from './motion'
import { Note, type NoteInfo } from './Note'
import { ActivityPanel, Toolbar, UndoBar, ZoomControl } from './Panes'
import { Redispatch } from './Redispatch'
import { cardsTouching, deletedSummary, marqueeBox, toWorld, topmost, type Point } from './selection'
import { activityShown, defaultProject, startTaskSync, useTaskBoard } from './store'
import { TaskMenu, type TaskMenuItem } from './TaskMenu'
import { useCards } from './use-cards'
import styles from './TaskBoard.module.css'

const M = defineMessages({
  zh: {
    menu: '任务菜单',
    open: '打开',
    dispatch: '派给主理人…',
    edit: '编辑',
    addChild: '加子任务',
    reset: '恢复自动排',
    cancel: '取消任务',
    restore: '恢复任务',
    delete: '删除',
    cancelMany: (n: number) => `取消 ${n} 个任务`,
    deleteMany: (n: number) => `删除 ${n} 张`,
    addHere: '在这里贴一张',
    selectAll: '全选',
    fit: '适应窗口'
  },
  en: {
    menu: 'Task menu',
    open: 'Open',
    dispatch: 'Dispatch to leader…',
    edit: 'Edit',
    addChild: 'Add subtask',
    reset: 'Restore auto layout',
    cancel: 'Cancel task',
    restore: 'Restore task',
    delete: 'Delete',
    cancelMany: (n: number) => `Cancel ${n} tasks`,
    deleteMany: (n: number) => `Delete ${n}`,
    addHere: 'New note here',
    selectAll: 'Select all',
    fit: 'Fit to window'
  }
})

/** The new-card box and 派发 popover are kept this far inside the board; their room is what they need at most. */
const INSET = 8
const COMPOSE_ROOM = { w: 460, h: 200 }
const REDISPATCH_ROOM = { w: 420, h: 80 }
const ZOOM_STEP = 1.25
const DRAG_SLOP = 3
const TICK_MS = 15_000
/** How long what just happened to a card stays on it (the longest animation, a split's last stagger, is under this). */
const FX_MS = 1200
/** A held card's tilt: degrees per px/ms of sideways speed, at most TILT_MAX either way (PRD v1.250 ④). */
const TILT_PER_SPEED = 3
const TILT_MAX = 3
/** The tilt returns to level once the pointer has been still this long. */
const TILT_REST_MS = 90
const PAN_MS = 300

/** What just happened to a card: the tokens of its `data-fx` and its place in a batch. */
interface Fx {
  tokens: string
  order: number
}

interface Leaving {
  cards: Array<{ placed: PlacedCard; card: Card<Session>; info: NoteInfo }>
  links: Link[]
}

interface Rendered {
  layout: BoardLayout
  cardById: Map<TaskId, Card<Session>>
  infos: Map<TaskId, NoteInfo>
}

const addToken = (fx: Record<TaskId, Fx>, id: TaskId, token: string, order = 0): void => {
  const at = fx[id]
  fx[id] = { tokens: at ? `${at.tokens} ${token}` : token, order: at && order === 0 ? at.order : order }
}

/** The new-card box that is up: centred, or at a point (在这里贴一张, 加子任务). */
interface Composing {
  at?: Point
  /** 在这里贴一张: where the card itself goes, in note coordinates. */
  pos?: TaskPos
  /** 加子任务: the card it goes under. */
  parentId?: TaskId
}

/** The open menu: built when it is asked for, from the board as it is then. */
interface OpenMenu {
  at: Point
  groups: TaskMenuItem[][]
}

/** A box of `room` at `at` kept inside the board. */
const within = (at: Point, room: { w: number; h: number }, size: Size): Point => ({
  x: Math.max(INSET, Math.min(at.x, size.w - room.w - INSET)),
  y: Math.max(INSET, Math.min(at.y, size.h - room.h - INSET))
})

/** The last look at the cards, kept across tab switches so what happened while the tab was away still shows up. */
let lastSnapshot: Snapshot | null = null

const EMPTY_INFO: NoteInfo = { segments: [], progress: { done: 0, total: 0 }, waiting: 0 }

export function TaskBoard() {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [composing, setComposing] = useState<Composing | null>(null)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [redispatchId, setRedispatchId] = useState<TaskId | null>(null)
  // Cards whose failure line takes a second row (their notes report it).
  const [tall, setTall] = useState<ReadonlySet<TaskId>>(() => new Set())
  const onTall = useCallback((id: TaskId, is: boolean) => {
    setTall((now) => {
      if (now.has(id) === is) return now
      const next = new Set(now)
      if (is) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  // The marquee: where it started on the board's world (so a pan or a zoom during the drag keeps it there), where the
  // pointer is in the board, and what was selected before it (kept with ⇧).
  const [marquee, setMarquee] = useState<{ from: Point; to: Point; base: readonly TaskId[] } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  // The cards being dragged (one, or the selection) and where they are held (note coordinates, as `Task.pos`); saved
  // once, when they are let go.
  const [held, setHeld] = useState<{ pos: ReadonlyMap<TaskId, TaskPos>; tilt: number; dragging: boolean } | null>(null)
  const reduced = useReducedMotion()
  // Motion (PRD v1.250 · 动效): what just happened to which card, the ghosts of cards just deleted, the dot field's ripples.
  const [fx, setFx] = useState<Record<TaskId, Fx>>({})
  const [edges, setEdges] = useState<Record<TaskId, number>>({})
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const [ripples, setRipples] = useState<RippleEvent[]>([])
  const [composeLeaving, setComposeLeaving] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const m = useMessages(M)
  const { view, selected, detailId, detailEdit, events, activityPref, lastProjectId, loaded, undone, dispatching } = useTaskBoard(
    useShallow((s) => ({ view: s.view, selected: s.selected, detailId: s.detailId, detailEdit: s.detailEdit, events: s.events, activityPref: s.activityPref, lastProjectId: s.lastProjectId, loaded: s.loaded, undone: s.undo, dispatching: s.dispatching }))
  )
  const selectedSet = useMemo(() => new Set(selected), [selected])
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
  const overrides: PosOverrides | undefined = held?.pos
  const heldDragging = held?.dragging === true
  const heldTilt = held?.tilt ?? 0
  // The saved places, both modes: they change with the cards, not with a drag.
  const layouts = useMemo(() => ({ note: layoutBoard(trees, 'note', undefined, tall), chip: layoutBoard(trees, 'chip') }), [trees, tall])
  const bounds = useMemo<Record<LayoutMode, Rect>>(() => ({ note: layouts.note.bounds, chip: layouts.chip.bounds }), [layouts])
  const drawing = drawingFor(view.zoom)
  const drawnMode = modeFor(view.zoom)
  // While a card is held, only the mode on screen is laid out again (every frame); the other one is not drawn, and
  // both are recomputed from the saved place when it is let go.
  const heldLayout = useMemo(() => (overrides ? layoutBoard(trees, drawnMode, overrides, tall) : null), [trees, drawnMode, overrides, tall])
  const layout = heldLayout ?? (drawnMode === 'note' ? layouts.note : layouts.chip)
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

  const panIntoView = useCallback(
    (rect: Rect): void => {
      const state = useTaskBoard.getState()
      const from = state.view
      const world = visibleWorld(from, size)
      if (rect.x >= world.x && rect.y >= world.y && rect.x + rect.w <= world.x + world.w && rect.y + rect.h <= world.y + world.h) return
      const s = scaleFor(from.zoom)
      const to = { x: size.w / 2 - (rect.x + rect.w / 2) * s, y: size.h / 2 - (rect.y + rect.h / 2) * s }
      const started = performance.now()
      cancelAnimationFrame(panFrame.current)
      const step = (now: number): void => {
        const t = Math.min(1, (now - started) / PAN_MS)
        const eased = 1 - (1 - t) ** 3
        useTaskBoard.getState().setView({ ...from, x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased })
        if (t < 1) panFrame.current = requestAnimationFrame(step)
      }
      panFrame.current = requestAnimationFrame(step)
    },
    [size]
  )

  // ── Motion: only what changed since the last look, never the first load, a tab switch, a pan or a zoom ──
  const rendered = useRef<Rendered | null>(null)
  const motionPrev = useRef<Snapshot | null>(null)
  const fxTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const panFrame = useRef(0)
  const nextRipple = useRef(0)
  useEffect(() => {
    if (!loaded) return
    const next = snapshotOf(cards)
    const events = diffMotion(motionPrev.current, next)
    motionPrev.current = next
    if (!hasMotion(events)) return
    const before = rendered.current
    const marks: Record<TaskId, Fx> = {}
    for (const id of events.land) addToken(marks, id, 'land')
    for (const { id, order } of events.slide) addToken(marks, id, 'slide', order)
    for (const id of events.pin) addToken(marks, id, 'pin')
    for (const id of events.done) addToken(marks, id, 'done')
    for (const id of events.cancel) addToken(marks, id, 'cancel')
    const drawn: Record<TaskId, number> = {}
    for (const { id, order } of events.slide) drawn[id] = order
    setFx((now) => ({ ...now, ...marks }))
    setEdges((now) => ({ ...now, ...drawn }))
    clearTimeout(fxTimer.current)
    fxTimer.current = setTimeout(() => {
      setFx({})
      setEdges({})
    }, FX_MS)

    // ⑥ A card that is gone leaves as a ghost for 200 ms, its connector drawn back.
    if (events.removed.length > 0 && before) {
      const gone = new Set(events.removed)
      const ghosts = before.layout.cards.flatMap((placed) => {
        const card = before.cardById.get(placed.id)
        return gone.has(placed.id) && card ? [{ placed, card, info: before.infos.get(placed.id) ?? EMPTY_INFO }] : []
      })
      // A delete of several cards arrives as several changes: their ghosts add up.
      const links = before.layout.links.filter((l) => gone.has(l.toId) || gone.has(l.fromId))
      setLeaving((now) => ({ cards: [...(now?.cards ?? []), ...ghosts], links: [...(now?.links ?? []), ...links] }))
      clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(() => setLeaving(null), 260)
    }

    if (reduced) return
    // ① ⑤ A ripple from the card's middle: neutral where one was pasted, magenta where one began to wait on the user.
    const rippled: RippleEvent[] = []
    const at = (id: TaskId): PlacedCard | undefined => layout.cards.find((c) => c.id === id)
    // Centres in note (100 %) coordinates whatever the zoom: the dot field converts them for the mode it draws.
    for (const [ids, tone] of [[events.land, 'neutral'], [events.attention, 'attention']] as const) {
      for (const id of ids) {
        const placed = layouts.note.cards.find((c) => c.id === id)
        if (placed) rippled.push({ id: ++nextRipple.current, x: placed.x + placed.w / 2, y: placed.y + placed.h / 2, tone })
      }
    }
    if (rippled.length > 0) setRipples((now) => [...now, ...rippled].slice(-8))
    // ① A card pasted out of sight: the view goes to it first (300 ms).
    const pasted = events.land.map(at).find((placed) => placed && cardById.get(placed.id)?.task.createdBy === 'user')
    if (pasted) panIntoView(pasted)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a diff of the cards; the layout it reads is this render's
  }, [cards, loaded])
  useEffect(() => {
    rendered.current = { layout, cardById, infos }
  })
  useEffect(
    () => () => {
      clearTimeout(fxTimer.current)
      clearTimeout(leaveTimer.current)
      cancelAnimationFrame(panFrame.current)
    },
    []
  )

  // ── Viewport ──
  // The wheel and key listeners bind once and read the newest bounds from here.
  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  })
  const fit = useCallback(() => {
    const s = host.current?.getBoundingClientRect()
    if (s) useTaskBoard.getState().setView(fitView(boundsRef.current, { w: s.width, h: s.height }))
  }, [])
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
      state.setView(zoomAround(state.view, state.view.zoom * factor, at, boundsRef.current))
    },
    [size]
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
        state.setView(zoomAround(state.view, state.view.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }, boundsRef.current))
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        state.setView(panBy(state.view, -dx, -dy))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Opening a card, pasting one ──
  const openDetail = useTaskBoard.getState().openDetail
  const onSelect = useCallback((id: string, additive: boolean) => (additive ? useTaskBoard.getState().toggle(id) : useTaskBoard.getState().select(id)), [])
  const onOpen = useCallback((id: string) => useTaskBoard.getState().openDetail(id), [])
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects])
  const focusBoard = useCallback(() => host.current?.parentElement?.focus({ preventScroll: true }), [])
  const startCompose = useCallback(
    (from: Composing = {}) => {
      if (projectIds.length > 0) setComposing(from)
    },
    [projectIds]
  )
  const paste = async ({ projectId, title, body, leader }: ComposeResult): Promise<boolean> => {
    // The box stays up for its 200 ms exit: a second Enter or click in that time is not a second card.
    if (composeLeaving || !composing) return false
    const { parentId, pos } = composing
    const made = await window.tr.tasks.create({ projectId, title, ...(body !== '' ? { body } : {}), ...(parentId !== undefined ? { parentId } : {}), ...(pos ? { pos } : {}) })
    if (!made) return false
    const state = useTaskBoard.getState()
    state.setLastProject(projectId)
    state.select(made.id)
    focusBoard()
    // ① The box shrinks away (200 ms) while the note lands.
    setComposeLeaving(true)
    window.setTimeout(() => {
      setComposing(null)
      setComposeLeaving(false)
    }, reduced ? 120 : 200)
    // The card's own leader (PRD v1.250); 暂不派发 and sub-cards leave the card waiting. A leader that could not start
    // says why on the card and in 「动态」.
    if (leader.agent !== null) void dispatchLeader(made, leader.agent, leader.options)
    return true
  }

  // ── Cards: what the menus and keys do ──
  /** Where a card is drawn in the board, px. */
  const onScreen = useCallback(
    (placed: Rect): Rect => {
      const s = scaleFor(view.zoom)
      return { x: view.x + placed.x * s, y: view.y + placed.y * s, w: placed.w * s, h: placed.h * s }
    },
    [view]
  )
  /** 派给主理人…: a root card that waits, with no leader on its way. */
  const canRedispatch = useCallback(
    (id: TaskId): boolean => {
      const card = cardById.get(id)
      return card !== undefined && card.task.parentId === undefined && !card.session && card.state === 'idle' && !dispatching.includes(id)
    },
    [cardById, dispatching]
  )
  const redispatch = useCallback(
    (id: TaskId): void => {
      useTaskBoard.getState().openDetail(null)
      useTaskBoard.getState().select(id)
      const placed = layout.cards.find((c) => c.id === id)
      if (placed) panIntoView(placed)
      setRedispatchId(id)
    },
    [layout, panIntoView]
  )
  const canAddChild = useCallback((id: TaskId): boolean => taskDepth(tasks, id) < TASK_LIMITS.maxDepth, [tasks])
  const addChild = useCallback(
    (id: TaskId): void => {
      const placed = layout.cards.find((c) => c.id === id)
      if (!placed || !canAddChild(id)) return
      useTaskBoard.getState().openDetail(null)
      const card = onScreen(placed)
      startCompose({ parentId: id, at: within({ x: card.x, y: card.y + card.h + INSET }, COMPOSE_ROOM, size) })
    },
    [layout, canAddChild, onScreen, size, startCompose]
  )
  const remove = useCallback(
    (ids: readonly TaskId[]): void => {
      // The focused note is about to go: the keyboard stays with the board, for ⌘Z.
      focusBoard()
      void deleteCards(ids)
    },
    [focusBoard]
  )
  const undo = useCallback((): void => {
    focusBoard()
    void undoDelete()
  }, [focusBoard])
  const selectAll = useCallback(() => useTaskBoard.getState().selectMany(useTaskBoard.getState().tasks.map((t) => t.id)), [])

  /** `local`: where on the board the click was (在这里贴一张); `onCard`: on a card, so for the selection. */
  const menuGroups = (onCard: boolean, local: Point): TaskMenuItem[][] => {
    const selected = useTaskBoard.getState().selected
    if (!onCard) {
      return [
        [
          {
            key: 'add-here',
            label: m.addHere,
            shortcut: 'N',
            run: () => {
              // The box opens at the click, and the card is pasted there (chip coordinates scale to note ones).
              const world = toWorld(view, local)
              const ratio = modeFor(view.zoom) === 'chip' ? DIMS.chip.pitch / DIMS.note.pitch : 1
              const pos = parseTaskPos({ x: world.x / ratio, y: world.y / ratio })
              startCompose({ at: within(local, COMPOSE_ROOM, size), ...(pos ? { pos } : {}) })
            }
          },
          { key: 'select-all', label: m.selectAll, shortcut: '⌘A', run: selectAll }
        ],
        [{ key: 'fit', label: m.fit, shortcut: '⇧1', run: fit }]
      ]
    }
    const dragged = selected.filter((id) => cardById.get(id)?.task.pos !== undefined)
    const reset: TaskMenuItem[] = dragged.length > 0 ? [{ key: 'reset', label: m.reset, run: () => resetPlaces(dragged) }] : []
    if (selected.length > 1) {
      const live = selected.filter((id) => cardById.get(id)?.task.manual !== 'canceled')
      return [
        [...(live.length > 0 ? [{ key: 'cancel', label: m.cancelMany(live.length), run: () => setManual(live, 'canceled') }] : []), ...reset],
        [{ key: 'delete', label: m.deleteMany(selected.length), shortcut: '⌫', danger: true, run: () => remove(selected) }]
      ]
    }
    const id = selected[0]
    const card = id !== undefined ? cardById.get(id) : undefined
    if (id === undefined || !card) return []
    const canceled = card.task.manual === 'canceled'
    return [
      [
        { key: 'open', label: m.open, shortcut: '↵', run: () => openDetail(id) },
        ...(canRedispatch(id) ? [{ key: 'dispatch', label: m.dispatch, run: () => redispatch(id) }] : []),
        { key: 'edit', label: m.edit, shortcut: '⌘E', run: () => openDetail(id, true) },
        ...(canAddChild(id) ? [{ key: 'add-child', label: m.addChild, shortcut: '⇥', run: () => addChild(id) }] : [])
      ],
      [...reset, { key: 'cancel', label: canceled ? m.restore : m.cancel, run: () => setManual([id], canceled ? 'todo' : 'canceled') }],
      [{ key: 'delete', label: m.delete, shortcut: '⌫', danger: true, run: () => remove([id]) }]
    ]
  }
  const closeMenu = useCallback(
    (refocus: boolean) => {
      setMenu(null)
      if (refocus) focusBoard()
    },
    [focusBoard]
  )
  const closeRedispatch = useCallback(
    (refocus: boolean) => {
      setRedispatchId(null)
      if (refocus) focusBoard()
    },
    [focusBoard]
  )

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('[data-no-pan]')) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const card = target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId
    // A right-click on a card that is not selected selects it first.
    if (card !== undefined && !useTaskBoard.getState().selected.includes(card)) useTaskBoard.getState().select(card)
    focusBoard()
    setMenu({ at: { x: e.clientX, y: e.clientY }, groups: menuGroups(card !== undefined, { x: e.clientX - rect.left, y: e.clientY - rect.top }) })
  }

  // ── Keys: on the tab's body, which holds the keyboard; inputs keep their own ──
  // The listener binds once and reads the newest actions from here.
  const acts = useRef({ remove, undo, selectAll, addChild, canAddChild, startCompose, fit })
  useEffect(() => {
    acts.current = { remove, undo, selectAll, addChild, canAddChild, startCompose, fit }
  })
  useEffect(() => {
    const body = host.current?.parentElement
    if (!body) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as HTMLElement
      // The new-card box too: ⌫ or ⇥ on one of its buttons is not about the cards behind it.
      if (target.closest('input, textarea, select, [role="dialog"], [data-own-keys]')) return
      // ⌫, ⌦, ⇥ and ↵ on a button or any control of the panes are that control's, never the selected cards'.
      if (['Delete', 'Backspace', 'Tab', 'Enter'].includes(e.key) && target.closest('button, [role="menu"], [role="menuitem"], [data-no-pan]')) return
      const state = useTaskBoard.getState()
      if (e.altKey && e.code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        state.setActivity(!activityShown(state.activityPref, host.current?.clientWidth ?? 0))
        return
      }
      const only = state.selected.length === 1 ? state.selected[0]! : null
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') acts.current.undo()
        else if (key === 'a') acts.current.selectAll()
        else if (key === 'e' && only !== null) state.openDetail(only, true)
        else return
        e.preventDefault()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        // Hold Space to pan with a drag; a Space on a button keeps its own meaning.
        if (target.closest('button')) return
        e.preventDefault()
        setSpaceDown(true)
      } else if (e.code === 'Digit1' && e.shiftKey) {
        e.preventDefault()
        acts.current.fit()
      } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault()
        acts.current.startCompose()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.length > 0) {
        e.preventDefault()
        acts.current.remove(state.selected)
      } else if (e.key === 'Tab' && !e.shiftKey && only !== null && acts.current.canAddChild(only)) {
        e.preventDefault()
        acts.current.addChild(only)
      } else if (e.key === 'Enter' && only !== null) {
        e.preventDefault()
        state.openDetail(only)
      } else if (e.key === 'Escape' && state.selected.length > 0) {
        e.preventDefault()
        state.select(null)
      }
    }
    body.addEventListener('keydown', onKey)
    return () => body.removeEventListener('keydown', onKey)
  }, [])

  // ── Panning, the marquee, and dragging cards ──
  const spacePans = spaceDown && !composing && detailId === null
  // `card`: the card the press started on. A press on a card (no Space) becomes a drag of that card, or of the whole
  // selection when it is part of it, once it passes DRAG_SLOP; a press on empty canvas becomes a marquee; Space or the
  // middle button pans. Pointer capture starts with the drag, so a click that never moved still reaches the note
  // (select, ⇧ to add, double-click opens it); a Space-drag has no such click and selects on release.
  const drag = useRef<{
    x: number
    y: number
    moved: boolean
    card: string | null
    mode: 'pan' | 'card' | 'marquee'
    /** Where each dragged card's `pos` was at the press, and the note-coordinate scale of a screen px. */
    starts?: ReadonlyMap<TaskId, TaskPos>
    perPx?: number
    frame?: number
    last?: ReadonlyMap<TaskId, TaskPos>
    /** The marquee: its start on the world, and what was selected before it (kept with ⇧). */
    from?: Point
    base?: readonly TaskId[]
    additive?: boolean
    /** The pointer now, and where it was at the last frame (for the tilt). */
    cx: number
    flushX: number
    flushT: number
    rest?: ReturnType<typeof setTimeout>
  } | null>(null)

  /** The note-coordinate place of each of these cards as drawn now: a root's, or a child's offset from its parent. */
  const placesOf = (ids: readonly TaskId[]): Map<TaskId, TaskPos> => {
    const byId = new Map(layouts.note.cards.map((c) => [c.id, c]))
    const out = new Map<TaskId, TaskPos>()
    for (const id of ids) {
      const placed = byId.get(id)
      if (!placed) continue
      const parent = placed.parentId !== undefined ? byId.get(placed.parentId) : undefined
      out.set(id, { x: placed.x - (parent?.x ?? 0), y: placed.y - (parent?.y ?? 0) })
    }
    return out
  }

  /** Selects what the marquee touches, at the view as it is now. */
  const selectIn = (box: { from: Point; to: Point; base: readonly TaskId[] }): void => {
    const touched = cardsTouching(layout.cards, marqueeBox(useTaskBoard.getState().view, box.from, box.to).world)
    useTaskBoard.getState().selectMany([...box.base, ...touched.filter((id) => !box.base.includes(id))])
  }
  // A two-finger pan or a zoom while the button is down moves cards under the box without a pointer move.
  useEffect(() => {
    if (marquee) selectIn(marquee)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view's changes only; a pointer move selects itself
  }, [view])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // Left or middle; a ⌃-click is a right-click (its `contextmenu` follows).
    if ((e.button !== 0 && e.button !== 1) || (e.button === 0 && e.ctrlKey)) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-pan], button, input, textarea, select')) return
    const card = target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null
    const press = { x: e.clientX, y: e.clientY, cx: e.clientX, flushX: e.clientX, flushT: performance.now(), moved: false, card }
    if (e.button === 1 || spacePans) {
      // The middle button would scroll-drag otherwise.
      e.preventDefault()
      drag.current = { ...press, mode: 'pan' }
    } else if (card !== null) {
      // ⇧ picks (the note's click), it does not drag; the dot drawing has no cards to take hold of.
      if (e.shiftKey || drawing === 'dot') return
      const ratio = modeFor(view.zoom) === 'chip' ? DIMS.chip.pitch / DIMS.note.pitch : 1
      drag.current = { ...press, mode: 'card', perPx: 1 / (scale * ratio) }
      return
    } else {
      // No text selection while the box is drawn.
      e.preventDefault()
      const base = useTaskBoard.getState().selected
      const rect = e.currentTarget.getBoundingClientRect()
      const from = toWorld(useTaskBoard.getState().view, { x: e.clientX - rect.left, y: e.clientY - rect.top })
      drag.current = { ...press, mode: 'marquee', from, base, additive: e.shiftKey }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    focusBoard()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    if (d.mode === 'card') {
      if (!d.moved) {
        d.moved = true
        e.currentTarget.setPointerCapture(e.pointerId)
        focusBoard()
        const state = useTaskBoard.getState()
        if (d.card && !state.selected.includes(d.card)) state.select(d.card)
        d.starts = placesOf(topmost(state.tasks, useTaskBoard.getState().selected))
      }
      const clamp = (n: number): number => Math.max(-TASK_POS_LIMIT, Math.min(TASK_POS_LIMIT, n))
      d.last = new Map([...d.starts!].map(([id, from]) => [id, { x: clamp(from.x + dx * d.perPx!), y: clamp(from.y + dy * d.perPx!) }]))
      d.cx = e.clientX
      // Many pointer events arrive per frame: the layout is redone once per frame.
      if (d.frame === undefined) {
        d.frame = requestAnimationFrame((now) => {
          d.frame = undefined
          if (drag.current !== d || !d.last) return
          // Tilt with the sideways speed (up to ±3°), level again once the pointer rests; none under reduced motion.
          const speed = (d.cx - d.flushX) / Math.max(1, now - d.flushT)
          const tilt = reduced ? 0 : Math.max(-TILT_MAX, Math.min(TILT_MAX, Math.round(speed * TILT_PER_SPEED * 10) / 10))
          d.flushX = d.cx
          d.flushT = now
          setHeld({ pos: d.last, tilt, dragging: true })
          clearTimeout(d.rest)
          d.rest = setTimeout(() => setHeld((h) => (h && h.dragging ? { ...h, tilt: 0 } : h)), TILT_REST_MS)
        })
      }
      return
    }
    d.moved = true
    if (d.mode === 'marquee') {
      const rect = e.currentTarget.getBoundingClientRect()
      const next = { from: d.from!, to: { x: e.clientX - rect.left, y: e.clientY - rect.top }, base: d.additive ? d.base! : [] }
      setMarquee(next)
      selectIn(next)
      return
    }
    setPanning(true)
    d.x = e.clientX
    d.y = e.clientY
    const state = useTaskBoard.getState()
    state.setView(panBy(state.view, dx, dy))
  }

  const endCardDrag = (d: NonNullable<typeof drag.current>, save: boolean): void => {
    if (d.frame !== undefined) cancelAnimationFrame(d.frame)
    clearTimeout(d.rest)
    const places = new Map([...(d.last ?? [])].flatMap(([id, at]) => (parseTaskPos(at) ? [[id, at] as const] : [])))
    if (!save || places.size === 0) {
      setHeld(null)
      return
    }
    // Let go: the lift and tilt spring back at once; the places are held until main has them, so no card jumps back to
    // its old place in between.
    setHeld({ pos: places, tilt: 0, dragging: false })
    void Promise.all([...places].map(([id, pos]) => window.tr.tasks.update(id, { pos }).catch(() => null))).finally(() => setHeld(null))
  }
  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    setMarquee(null)
    if (!d) return
    if (d.mode === 'card') {
      if (d.moved) endCardDrag(d, true)
    } else if (!d.moved) {
      if (d.mode === 'pan') useTaskBoard.getState().select(d.card)
      else if (!d.additive) useTaskBoard.getState().select(null)
    }
  }
  const onPointerCancel = (): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    setMarquee(null)
    if (d?.mode === 'card' && d.moved) endCardDrag(d, false)
  }

  // ── Render ──
  const activityOpen = activityShown(activityPref, size.w)
  const detail = detailId !== null ? cardById.get(detailId) : undefined
  const drawnMarquee = marquee ? marqueeBox(view, marquee.from, marquee.to).screen : null
  const parentCard = composing?.parentId !== undefined ? cardById.get(composing.parentId) : undefined
  // A sub-card whose parent was deleted meanwhile has nowhere to go: the box goes with it.
  const compose = !composing || (composing.parentId !== undefined && !parentCard) ? undefined : (parentCard?.task.projectId ?? defaultProject(projectIds, lastProjectId, activeProject))
  const redispatching = redispatchId !== null && canRedispatch(redispatchId) ? cardById.get(redispatchId) : undefined
  const redispatchPlace = redispatching ? layout.cards.find((c) => c.id === redispatching.task.id) : undefined
  const redispatchAt = redispatchPlace ? onScreen(redispatchPlace) : undefined

  // The world's content depends on the layout and the cards, not on the viewport: memoized, so panning and zooming
  // re-render the transform and nothing under it (the links, labels and notes keep their elements).
  const world = useMemo(
    () => (
      <>
        <svg className={styles.links} width="1" height="1" aria-hidden>
          {layout.links.map((l) => linkOf(l, drawing, edges[l.toId] !== undefined ? 'draw' : undefined, edges[l.toId] ?? 0))}
          {leaving?.links.filter((l) => !cardById.has(l.toId) || !cardById.has(l.fromId)).map((l) => linkOf(l, drawing, 'retract', 0, 'gone-'))}
        </svg>
        {/* An undo within the ghost's 200 ms brings the card back: no ghost of a card that is on the board. */}
        {leaving?.cards.filter((g) => !cardById.has(g.placed.id)).map((g) => (
          <Note
            key={`gone-${g.placed.id}`}
            card={g.card}
            placed={g.placed}
            drawing={drawing}
            info={g.info}
            selected={false}
            dragging={false}
            tilt={0}
            fx="leave"
            order={0}
            dimmed={false}
            now={now}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
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
              selected={selectedSet.has(placed.id)}
              dragging={heldDragging && overrides?.has(placed.id) === true}
              tilt={overrides?.has(placed.id) ? heldTilt : 0}
              fx={fx[placed.id]?.tokens ?? ''}
              order={fx[placed.id]?.order ?? 0}
              dimmed={filter.trim() !== '' && !matchesFilter(card.task, projectName.get(card.task.projectId) ?? '', filter)}
              now={now}
              onSelect={onSelect}
              onOpen={onOpen}
              onTall={onTall}
            />
          )
        })}
      </>
    ),
    [layout, drawing, cardById, infos, selectedSet, overrides, heldDragging, heldTilt, fx, edges, leaving, filter, projectName, now, onSelect, onOpen, onTall]
  )

  return (
    <div
      ref={host}
      className={styles.board}
      data-testid="task-board"
      data-drawing={drawing}
      data-panning={panning}
      data-dragging={held?.dragging === true}
      data-space={spacePans}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
    >
      <DotField view={view} size={size} ripples={ripples} />
      <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`, ['--world-scale' as string]: scale }}>
        {world}
      </div>
      {drawnMarquee && <div className={styles.marquee} data-testid="task-marquee" style={{ left: drawnMarquee.x, top: drawnMarquee.y, width: drawnMarquee.w, height: drawnMarquee.h }} />}
      <ActivityPanel events={events} open={activityOpen} onToggle={() => useTaskBoard.getState().setActivity(!activityOpen)} />
      <Toolbar onAdd={() => startCompose()} onFit={fit} />
      {undone.bar && undone.stack.length > 0 && <UndoBar deleted={deletedSummary(undone.stack.at(-1)!)} failed={undone.failed} onUndo={undo} />}
      <ZoomControl zoom={view.zoom} onStep={(dir) => zoomBy(dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP)} />
      {compose !== undefined && (
        <Compose
          // A new box for a new place: its text and pickers do not carry over.
          key={`${composing?.parentId ?? ''}:${composing?.at?.x ?? ''}:${composing?.at?.y ?? ''}`}
          projects={projects}
          initialProject={compose}
          child={composing?.parentId !== undefined}
          {...(composing?.at ? { at: composing.at } : {})}
          onSubmit={paste}
          leaving={composeLeaving}
          onCancel={() => {
            setComposing(null)
            focusBoard()
          }}
        />
      )}
      {redispatching && redispatchAt && (
        <Redispatch
          key={redispatching.task.id}
          seq={redispatching.task.seq}
          at={within({ x: redispatchAt.x + redispatchAt.w + INSET, y: redispatchAt.y + redispatchAt.h / 2 - 22 }, REDISPATCH_ROOM, size)}
          onDispatch={(selection) => {
            closeRedispatch(true)
            if (selection.agent !== null) void dispatchLeader(redispatching.task, selection.agent, selection.options)
          }}
          onClose={closeRedispatch}
        />
      )}
      {menu && <TaskMenu at={menu.at} label={m.menu} groups={menu.groups} onClose={closeMenu} />}
      {detail && (
        <Detail
          card={detail}
          children={cards.filter((c) => c.task.parentId === detail.task.id).sort((a, b) => a.task.createdAt - b.task.createdAt || a.task.seq - b.task.seq)}
          // A new card (or ⌘E on the open one) starts the overlay afresh: no half-typed text moves to another card.
          key={`${detail.task.id}:${detailEdit}`}
          edit={detailEdit}
          onDispatch={canRedispatch(detail.task.id) ? () => redispatch(detail.task.id) : undefined}
          onDelete={() => {
            openDetail(null)
            remove([detail.task.id])
          }}
          projectName={projectName.get(detail.task.projectId) ?? ''}
          parentTitle={detail.task.parentId !== undefined ? cardById.get(detail.task.parentId)?.task.title : undefined}
          worktree={worktrees.find((w) => w.id === sessions.find((s) => s.id === detail.session?.id)?.worktreeId)}
          dispatcher={detail.task.createdBy !== 'user' ? sessions.find((s) => s.id === detail.task.createdBy) : undefined}
          now={now}
          onClose={() => {
            openDetail(null)
            focusBoard()
          }}
        />
      )}
    </div>
  )
}

/** One connector: parent's right-middle to child's left-middle; `fx`: drawn in (a new child) or drawn back (a deleted one). */
function linkOf(l: Link, drawing: Drawing, fx: 'draw' | 'retract' | undefined, order: number, prefix = '') {
  const mid = (l.x1 + l.x2) / 2
  const r = drawing === 'note' ? 4 : 2.5
  return (
    <g key={`${prefix}${l.fromId}-${l.toId}`} className={styles.link} data-fx={fx} style={{ ['--fx-order' as string]: order }}>
      <path pathLength={1} d={`M${l.x1} ${l.y1} C${mid} ${l.y1} ${mid} ${l.y2} ${l.x2} ${l.y2}`} />
      <circle cx={l.x1} cy={l.y1} r={r} />
      <circle className={styles.end} cx={l.x2} cy={l.y2} r={r} />
    </g>
  )
}
