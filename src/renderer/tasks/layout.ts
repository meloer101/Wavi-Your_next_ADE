// 任务 board layout (PRD F9 v1.249 / v1.250 · Figma 115A4 / 115A4b / 116): pure maths, no React, no DOM.
//
// Three things live here: where each card goes (a tidy tree per project, the projects packed on one canvas), how the
// viewport (pan + zoom) moves, and which drawing a zoom level gets (note → chip → dot).
//
// Two coordinate systems: `note` (the 100 % sizes of 115A4: 220 × 94 notes, 290 apart) and `chip` (115A4b: 156 × 28
// one-line chips, 176 apart). A chip layout is drawn at `zoom × 2`, so a chip is exactly 156 px wide at 50 %.
import type { ProjectId } from '@shared/types'
import type { Task, TaskId, TaskNode, TaskPos } from '@shared/task-board'

export type LayoutMode = 'note' | 'chip'
/** What a zoom level draws: full notes, one-line chips, or status-coloured dots. */
export type Drawing = 'note' | 'chip' | 'dot'

export interface Dims {
  w: number
  /** Height of a card without children / with children (the child segments take a row). */
  h: number
  hParent: number
  /** Distance between a card's left edge and its children's. */
  pitch: number
  /** Gap between stacked siblings. */
  gap: number
  /** A single child sits this much lower than its parent, so the connector is a curve. */
  leafShift: number
  /** Gap between the trees of one project's roots. */
  rootGap: number
  /** Gap between project clusters, and the width a row of clusters may reach before it wraps. */
  clusterGap: number
  rowWidth: number
}

export const DIMS: Record<LayoutMode, Dims> = {
  note: { w: 220, h: 94, hParent: 118, pitch: 290, gap: 24, leafShift: 30, rootGap: 24, clusterGap: 80, rowWidth: 2000 },
  chip: { w: 156, h: 28, hParent: 28, pitch: 176, gap: 8, leafShift: 10, rootGap: 16, clusterGap: 32, rowWidth: 1100 }
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
/** Below this zoom notes are drawn as chips, below `DOT_BELOW` as dots (the thresholds are tuned by eye on 115A4b). */
export const CHIP_BELOW = 0.65
export const DOT_BELOW = 0.3

export function drawingFor(zoom: number): Drawing {
  return zoom >= CHIP_BELOW ? 'note' : zoom >= DOT_BELOW ? 'chip' : 'dot'
}

export const modeFor = (zoom: number): LayoutMode => (drawingFor(zoom) === 'note' ? 'note' : 'chip')

/** World units → screen px: chips are laid out at half scale, so they track `zoom × 2`. */
export const scaleFor = (zoom: number): number => (modeFor(zoom) === 'note' ? zoom : zoom * 2)

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PlacedCard extends Rect {
  id: TaskId
  projectId: ProjectId
  depth: number
  parentId?: TaskId
  /** Has children: it is taller and shows the segment row. */
  parent: boolean
}

export interface Link {
  fromId: TaskId
  toId: TaskId
  /** Parent's right-middle and child's left-middle. */
  x1: number
  y1: number
  x2: number
  y2: number
}

/** One project's packed trees: the unit the board wraps into rows. Cards the user dragged away are not in it. */
export interface Cluster extends Rect {
  projectId: ProjectId
}

export interface BoardLayout {
  cards: PlacedCard[]
  links: Link[]
  clusters: Cluster[]
  bounds: Rect
}

export interface ProjectTrees {
  projectId: ProjectId
  roots: readonly TaskNode[]
}

/** Where cards are held while being dragged, over what `Task.pos` says (note coordinates). */
export type PosOverrides = ReadonlyMap<TaskId, TaskPos>

interface Placed {
  cards: PlacedCard[]
  /** Centre line of the subtree's root and the bottom of everything in it. */
  centre: number
  bottom: number
}

function shift(cards: PlacedCard[], dy: number): void {
  for (const c of cards) c.y += dy
}

/** One tree with its top at y = `top`, its root at x = 0. Parents come before their children in `cards`. */
function placeTree(node: TaskNode, projectId: ProjectId, top: number, d: Dims, depth = 0, parentId?: TaskId): Placed {
  const parent = node.children.length > 0
  const h = parent ? d.hParent : d.h
  const x = depth * d.pitch
  const self: PlacedCard = { id: node.task.id, projectId, depth, parent, x, y: top, w: d.w, h, ...(parentId !== undefined ? { parentId } : {}) }
  if (!parent) return { cards: [self], centre: top + h / 2, bottom: top + h }

  const cards: PlacedCard[] = []
  const kids: Placed[] = []
  let at = top
  for (const child of node.children) {
    const placed = placeTree(child, projectId, at, d, depth + 1, node.task.id)
    kids.push(placed)
    cards.push(...placed.cards)
    at = placed.bottom + d.gap
  }
  const first = kids[0]!.centre
  const last = kids[kids.length - 1]!.centre
  // A parent sits level with the middle of its children; an only child hangs lower so the connector bends.
  const centre = kids.length === 1 ? first - d.leafShift : (first + last) / 2
  // The parent would rise above this subtree's top: push the children down instead of drawing above the cluster.
  const lift = Math.max(0, top - (centre - h / 2))
  if (lift > 0) shift(cards, lift)
  self.y = centre - h / 2 + lift
  const bottom = Math.max(self.y + h, ...cards.map((c) => c.y + c.h))
  return { cards: [self, ...cards], centre: self.y + h / 2, bottom }
}

/** Every card of a tree, parents first (the order `placeTree` returns them in). */
function nodesOf(node: TaskNode): TaskNode[] {
  return [node, ...node.children.flatMap(nodesOf)]
}

interface Packed {
  cards: PlacedCard[]
  w: number
  h: number
}

/** A project's trees stacked in the automatic layout; a root the user dragged away keeps its slot, so the rest stay put. */
function layoutProject(trees: ProjectTrees, d: Dims): Packed {
  const cards: PlacedCard[] = []
  let top = 0
  for (const root of trees.roots) {
    const placed = placeTree(root, trees.projectId, top, d)
    cards.push(...placed.cards)
    top = placed.bottom + d.rootGap
  }
  const bottom = cards.length > 0 ? Math.max(...cards.map((c) => c.y + c.h)) : 0
  const right = cards.length > 0 ? Math.max(...cards.map((c) => c.x + c.w)) : 0
  return { cards, w: right, h: bottom }
}

/**
 * Moves the cards the user dragged: a moved root goes to its position, a moved child to its parent's top-left plus its
 * position, and a card that was not moved keeps its automatic place relative to its parent, so a subtree follows the
 * card it hangs from. `cards` has parents before children; `scale` turns note positions into this layout's units.
 */
function applyPositions(cards: PlacedCard[], posOf: (id: TaskId) => TaskPos | undefined, scale: number): void {
  const moved = new Map<TaskId, { dx: number; dy: number }>()
  const byId = new Map(cards.map((c) => [c.id, c]))
  for (const c of cards) {
    const parent = c.parentId !== undefined ? byId.get(c.parentId) : undefined
    const delta = parent ? (moved.get(parent.id) ?? { dx: 0, dy: 0 }) : { dx: 0, dy: 0 }
    const pos = posOf(c.id)
    const autoX = c.x
    const autoY = c.y
    if (pos) {
      c.x = (parent?.x ?? 0) + pos.x * scale
      c.y = (parent?.y ?? 0) + pos.y * scale
      // The parent has moved already: a child's position is relative to where the parent is now.
      moved.set(c.id, { dx: c.x - autoX, dy: c.y - autoY })
    } else {
      c.x += delta.dx
      c.y += delta.dy
      moved.set(c.id, delta)
    }
  }
}

function linksOf(cards: readonly PlacedCard[]): Link[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const links: Link[] = []
  for (const c of cards) {
    const p = c.parentId !== undefined ? byId.get(c.parentId) : undefined
    if (p) links.push({ fromId: p.id, toId: c.id, x1: p.x + p.w, y1: p.y + p.h / 2, x2: c.x, y2: c.y + c.h / 2 })
  }
  return links
}

/**
 * Every project's trees on one canvas: each project is a cluster of its trees, the clusters packed left to right and
 * wrapped into rows, so none overlaps. A project without cards takes no room. Then the cards the user dragged are
 * placed (`applyPositions`); `overrides` (a drag in progress) wins over the saved `Task.pos`.
 */
export function layoutBoard(projects: readonly ProjectTrees[], mode: LayoutMode, overrides?: PosOverrides): BoardLayout {
  const d = DIMS[mode]
  const scale = d.pitch / DIMS.note.pitch
  const nodes = new Map<TaskId, TaskNode>()
  for (const p of projects) for (const r of p.roots) for (const n of nodesOf(r)) nodes.set(n.task.id, n)
  const posOf = (id: TaskId): TaskPos | undefined => overrides?.get(id) ?? nodes.get(id)?.task.pos
  const cards: PlacedCard[] = []
  const clusters: Cluster[] = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const project of projects) {
    const one = layoutProject(project, d)
    if (one.cards.length === 0) continue
    if (x > 0 && x + one.w > d.rowWidth) {
      x = 0
      y += rowH + d.clusterGap
      rowH = 0
    }
    for (const c of one.cards) {
      c.x += x
      c.y += y
    }
    cards.push(...one.cards)
    clusters.push({ projectId: project.projectId, x, y, w: one.w, h: one.h })
    x += one.w + d.clusterGap
    rowH = Math.max(rowH, one.h)
  }
  applyPositions(cards, posOf, scale)
  return { cards, links: linksOf(cards), clusters, bounds: boundsOf(cards) }
}

export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x1 = Math.min(...rects.map((r) => r.x))
  const y1 = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Groups tasks by project in the given project order; projects missing from `order` follow, in first-seen order. */
export function groupByProject(
  tasks: readonly Task[],
  order: readonly ProjectId[],
  build: (tasks: readonly Task[]) => TaskNode[]
): ProjectTrees[] {
  const ids = [...order]
  for (const t of tasks) if (!ids.includes(t.projectId)) ids.push(t.projectId)
  return ids.map((projectId) => ({ projectId, roots: build(tasks.filter((t) => t.projectId === projectId)) }))
}

// ── Viewport ──────────────────────────────────────────────────────────────────

/** Screen position of the world origin and the zoom (1 = 100 %). */
export interface View {
  x: number
  y: number
  zoom: number
}

export interface Size {
  w: number
  h: number
}

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export const DEFAULT_VIEW: View = { x: 32, y: 32, zoom: 1 }

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy }
}

/**
 * Zooms to `zoom` keeping the world point under `anchor` (screen px) where it is. When the zoom crosses into another
 * drawing mode the two layouts differ, so the point keeps its relative place inside the layout's bounds instead.
 */
export function zoomAround(view: View, zoom: number, anchor: { x: number; y: number }, bounds: Record<LayoutMode, Rect>): View {
  const next = clampZoom(zoom)
  const from = modeFor(view.zoom)
  const to = modeFor(next)
  const sFrom = scaleFor(view.zoom)
  const sTo = scaleFor(next)
  const wx = (anchor.x - view.x) / sFrom
  const wy = (anchor.y - view.y) / sFrom
  let tx = wx
  let ty = wy
  if (from !== to) {
    const a = bounds[from]
    const b = bounds[to]
    tx = b.x + (a.w > 0 ? (wx - a.x) / a.w : 0) * b.w
    ty = b.y + (a.h > 0 ? (wy - a.y) / a.h : 0) * b.h
  }
  return { x: anchor.x - tx * sTo, y: anchor.y - ty * sTo, zoom: next }
}

const FIT_PAD = 48

/** The view that shows every card (⇧1). An empty board keeps the default view. */
export function fitView(bounds: Record<LayoutMode, Rect>, size: Size): View {
  const note = bounds.note
  if (note.w === 0 || note.h === 0 || size.w <= 0 || size.h <= 0) return DEFAULT_VIEW
  const room = { w: Math.max(1, size.w - FIT_PAD * 2), h: Math.max(1, size.h - FIT_PAD * 2) }
  // Never zoom in past 100 %: a single card should not fill the window.
  const z = Math.min(1, room.w / note.w, room.h / note.h)
  if (z >= CHIP_BELOW) return centre(note, z, z, size)
  const chip = bounds.chip
  // Chips are drawn at twice the zoom: fit them, then stay inside the chip range.
  const s = Math.min(room.w / chip.w, room.h / chip.h)
  const zChip = Math.min(CHIP_BELOW - 0.01, Math.max(MIN_ZOOM, s / 2))
  return centre(chip, scaleFor(zChip), zChip, size)
}

function centre(rect: Rect, scale: number, zoom: number, size: Size): View {
  return { zoom, x: (size.w - rect.w * scale) / 2 - rect.x * scale, y: (size.h - rect.h * scale) / 2 - rect.y * scale }
}

/** The world rectangle a screen of `size` shows, for drawing only what is visible. */
export function visibleWorld(view: View, size: Size): Rect {
  const s = scaleFor(view.zoom)
  return { x: -view.x / s, y: -view.y / s, w: size.w / s, h: size.h / s }
}

export function parseView(raw: unknown): View {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VIEW
  const v = raw as Partial<View>
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!ok(v.x) || !ok(v.y) || !ok(v.zoom)) return DEFAULT_VIEW
  return { x: v.x, y: v.y, zoom: clampZoom(v.zoom) }
}
