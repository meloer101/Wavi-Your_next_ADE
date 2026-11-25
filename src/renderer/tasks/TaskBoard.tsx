// 「任务」 (PRD F9 v1.249 · Figma 115A4): every project's cards on one infinite canvas. Drag empty canvas (or hold Space
// and drag), or scroll with two fingers, to pan; ⌘-scroll and pinch zoom around the pointer. Notes shrink to chips and
// dots as it zooms out. Layout and viewport maths are in layout.ts, the dot grid in DotField.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Session } from '@shared/types'
import { buildTaskTree, childSegments, parseTaskPos, taskProgress, waitingBelow, TASK_POS_LIMIT, type TaskId, type TaskNode, type TaskPos, type TaskState } from '@shared/task-board'
import { useShallow } from 'zustand/react/shallow'
import { subscribeClock } from '../sidebar/clock'
import { useOverviewStore } from '../overview/store'
import { useWorkspace } from '../state/workspace'
import { startCardLeader } from '../dispatch/task-deliver'
import { Compose, type ComposeResult } from './Compose'
import { Detail } from './Detail'
import { DotField, type RippleEvent } from './DotField'
import { DIMS, drawingFor, fitView, groupByProject, layoutBoard, modeFor, panBy, scaleFor, visibleWorld, zoomAround, type BoardLayout, type Drawing, type LayoutMode, type Link, type PlacedCard, type PosOverrides, type Rect, type Size } from './layout'
import { diffActivity, matchesFilter, snapshotOf, type Card, type Snapshot } from './model'
import { diffMotion, hasMotion, useReducedMotion } from './motion'
import { Note, type NoteInfo } from './Note'
import { ActivityPanel, Toolbar, ZoomControl } from './Panes'
import { activityShown, defaultProject, startTaskSync, useTaskBoard } from './store'
import { useCards } from './use-cards'
import styles from './TaskBoard.module.css'

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

/** The last look at the cards, kept across tab switches so what happened while the tab was away still shows up. */
let lastSnapshot: Snapshot | null = null

const EMPTY_INFO: NoteInfo = { segments: [], progress: { done: 0, total: 0 }, waiting: 0 }

export function TaskBoard() {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [composing, setComposing] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  // The card being dragged and where it is held (note coordinates, as `Task.pos`); saved once, when it is let go.
  const [held, setHeld] = useState<{ id: TaskId; pos: TaskPos; tilt: number; dragging: boolean } | null>(null)
  const reduced = useReducedMotion()
  // Motion (PRD v1.250 · 动效): what just happened to which card, the ghosts of cards just deleted, the dot field's ripples.
  const [fx, setFx] = useState<Record<TaskId, Fx>>({})
  const [edges, setEdges] = useState<Record<TaskId, number>>({})
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const [ripples, setRipples] = useState<RippleEvent[]>([])
  const [composeLeaving, setComposeLeaving] = useState(false)
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
  const heldId = held?.id
  const heldDragging = held?.dragging === true
  const heldTilt = held?.tilt ?? 0
  const heldX = held?.pos.x
  const heldY = held?.pos.y
  const overrides = useMemo<PosOverrides | undefined>(() => (heldId !== undefined && heldX !== undefined && heldY !== undefined ? new Map([[heldId, { x: heldX, y: heldY }]]) : undefined), [heldId, heldX, heldY])
  const layouts = useMemo(() => ({ note: layoutBoard(trees, 'note', overrides), chip: layoutBoard(trees, 'chip', overrides) }), [trees, overrides])
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
      setLeaving({ cards: ghosts, links: before.layout.links.filter((l) => gone.has(l.toId) || gone.has(l.fromId)) })
      clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(() => setLeaving(null), 260)
    }

    if (reduced) return
    // ① ⑤ A ripple from the card's middle: neutral where one was pasted, magenta where one began to wait on the user.
    const rippled: RippleEvent[] = []
    const at = (id: TaskId): PlacedCard | undefined => layout.cards.find((c) => c.id === id)
    for (const [ids, tone] of [[events.land, 'neutral'], [events.attention, 'attention']] as const) {
      for (const id of ids) {
        const placed = at(id)
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
  const paste = async ({ projectId, title, body, leader }: ComposeResult): Promise<boolean> => {
    const made = await window.tr.tasks.create({ projectId, title, ...(body !== '' ? { body } : {}) })
    if (!made) return false
    const state = useTaskBoard.getState()
    state.setLastProject(projectId)
    state.select(made.id)
    host.current?.parentElement?.focus()
    // ① The box shrinks away (200 ms) while the note lands.
    setComposeLeaving(true)
    window.setTimeout(() => {
      setComposing(false)
      setComposeLeaving(false)
    }, reduced ? 120 : 200)
    // The card's own leader (PRD v1.250); 暂不派发 leaves the card waiting.
    if (leader !== 'none') void startCardLeader(made, leader).catch((error: unknown) => console.error('[tasks] the leader did not start:', error))
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

  // ── Panning, and dragging a card ──
  const spacePans = spaceDown && !composing && detailId === null
  // `card`: the card the press started on. A press on a card (no Space) becomes a drag of that card once it passes
  // DRAG_SLOP; a press on the canvas, or on a card with Space held, pans. Pointer capture starts with the drag, so a
  // click that never moved still reaches the note (select, double-click opens it); a Space-drag has no such click and
  // selects on release.
  const drag = useRef<{
    x: number
    y: number
    moved: boolean
    card: string | null
    /** Moving the card, not the canvas. */
    mode: 'pan' | 'card'
    /** Where the card's `pos` was at the press and the note-coordinate scale of a screen px. */
    start?: TaskPos
    perPx?: number
    frame?: number
    last?: TaskPos
    /** The pointer now, and where it was at the last frame (for the tilt). */
    cx: number
    flushX: number
    flushT: number
    rest?: ReturnType<typeof setTimeout>
  } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-pan], button, input, select')) return
    const cardEl = target.closest<HTMLElement>('[data-task-id]')
    const card = cardEl?.dataset.taskId ?? null
    if (cardEl && !spacePans) {
      // The dot drawing has no cards to take hold of.
      if (drawing === 'dot') return
      const placed = layouts.note.cards.find((c) => c.id === card)
      if (!placed) return
      const parent = placed.parentId !== undefined ? layouts.note.cards.find((c) => c.id === placed.parentId) : undefined
      const ratio = modeFor(view.zoom) === 'chip' ? DIMS.chip.pitch / DIMS.note.pitch : 1
      drag.current = { x: e.clientX, y: e.clientY, cx: e.clientX, flushX: e.clientX, flushT: performance.now(), moved: false, card, mode: 'card', start: { x: placed.x - (parent?.x ?? 0), y: placed.y - (parent?.y ?? 0) }, perPx: 1 / (scale * ratio) }
      return
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: e.clientX, flushX: e.clientX, flushT: 0, moved: false, card, mode: 'pan' }
    e.currentTarget.setPointerCapture(e.pointerId)
    host.current?.parentElement?.focus()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'card') {
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
      if (!d.moved) {
        d.moved = true
        e.currentTarget.setPointerCapture(e.pointerId)
        host.current?.parentElement?.focus()
        if (d.card) useTaskBoard.getState().select(d.card)
      }
      const clamp = (n: number): number => Math.max(-TASK_POS_LIMIT, Math.min(TASK_POS_LIMIT, n))
      d.last = { x: clamp(d.start!.x + dx * d.perPx!), y: clamp(d.start!.y + dy * d.perPx!) }
      d.cx = e.clientX
      // Many pointer events arrive per frame: the layout is redone once per frame.
      if (d.frame === undefined) {
        d.frame = requestAnimationFrame((now) => {
          d.frame = undefined
          if (drag.current !== d || !d.last || !d.card) return
          // Tilt with the sideways speed (up to ±3°), level again once the pointer rests; none under reduced motion.
          const speed = (d.cx - d.flushX) / Math.max(1, now - d.flushT)
          const tilt = reduced ? 0 : Math.max(-TILT_MAX, Math.min(TILT_MAX, Math.round(speed * TILT_PER_SPEED * 10) / 10))
          d.flushX = d.cx
          d.flushT = now
          setHeld({ id: d.card, pos: d.last, tilt, dragging: true })
          clearTimeout(d.rest)
          d.rest = setTimeout(() => setHeld((h) => (h && h.dragging ? { ...h, tilt: 0 } : h)), TILT_REST_MS)
        })
      }
      return
    }
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    if (!d.moved) setPanning(true)
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    const state = useTaskBoard.getState()
    state.setView(panBy(state.view, dx, dy))
  }
  const endCardDrag = (d: NonNullable<typeof drag.current>, save: boolean): void => {
    if (d.frame !== undefined) cancelAnimationFrame(d.frame)
    clearTimeout(d.rest)
    const pos = d.last ? parseTaskPos(d.last) : null
    if (!save || !pos || !d.card) {
      setHeld(null)
      return
    }
    // Let go: the lift and tilt spring back at once; the place is held until main has it.
    setHeld({ id: d.card, pos, tilt: 0, dragging: false })
    // Held until main has it, so the card does not jump back to its old place in between.
    void window.tr.tasks
      .update(d.card, { pos })
      .catch(() => {})
      .finally(() => setHeld(null))
  }
  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d) return
    if (d.mode === 'card') {
      if (d.moved) endCardDrag(d, true)
      return
    }
    if (!d.moved) useTaskBoard.getState().select(d.card)
  }
  const onPointerCancel = (): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (d?.mode === 'card' && d.moved) endCardDrag(d, false)
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
          {layout.links.map((l) => linkOf(l, drawing, edges[l.toId] !== undefined ? 'draw' : undefined, edges[l.toId] ?? 0))}
          {leaving?.links.map((l) => linkOf(l, drawing, 'retract', 0, 'gone-'))}
        </svg>
        {leaving?.cards.map((g) => (
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
              selected={selectedId === placed.id}
              dragging={heldId === placed.id && heldDragging}
              tilt={heldId === placed.id ? heldTilt : 0}
              fx={fx[placed.id]?.tokens ?? ''}
              order={fx[placed.id]?.order ?? 0}
              dimmed={filter.trim() !== '' && !matchesFilter(card.task, projectName.get(card.task.projectId) ?? '', filter)}
              now={now}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          )
        })}
      </>
    ),
    [layout, drawing, cardById, infos, selectedId, heldId, heldDragging, heldTilt, fx, edges, leaving, filter, projectName, now, onSelect, onOpen]
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
    >
      <DotField view={view} size={size} ripples={ripples} />
      <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`, ['--world-scale' as string]: scale }}>
        {world}
      </div>
      <ActivityPanel events={events} open={activityOpen} onToggle={() => useTaskBoard.getState().setActivity(!activityOpen)} />
      <Toolbar onAdd={startCompose} onFit={fit} />
      <ZoomControl zoom={view.zoom} onStep={(dir) => zoomBy(dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP)} />
      {compose !== undefined && <Compose projects={projects} initialProject={compose} onSubmit={paste} leaving={composeLeaving} onCancel={() => { setComposing(false); host.current?.parentElement?.focus() }} />}
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

function descendantsOf(tasks: readonly { id: string; parentId?: string }[], id: string): number {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const t of tasks) if (t.parentId === out[i] && !out.includes(t.id)) out.push(t.id)
  return out.length - 1
}
