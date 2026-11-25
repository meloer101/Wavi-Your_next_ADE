// 任务看板 (PRD F9 v1.246 · F21 `wavi task`): persistent task cards ("便利贴") a user pastes on the board and agents
// split into sub-cards. Pure types and logic shared by main (the single writer, src/main/tasks) and the renderer
// (src/renderer/tasks). No Electron, no node built-ins.
//
// A card is a record that may have a session: the session's status (computed in the renderer, PRD §6.2) is the card's
// status; an agent never reports progress itself, it can only mark a card done (`wavi task update --done`).
import type { ProjectId, SessionId, SessionStatus } from './types'

export type TaskId = string
/** What a card says when it has no session to say it: waiting to be dispatched, finished, or dropped. */
export type TaskManual = 'todo' | 'done' | 'canceled'

export interface Task {
  id: TaskId
  /** Shown as `#seq` and used by `wavi task`; unique across all projects, counted up by the store, never reused. */
  seq: number
  projectId: ProjectId
  /** Cards nest two levels below a root (root → child → grandchild), the same depth as dispatched sessions (F21). */
  parentId?: TaskId
  title: string
  body: string
  /** `user`: pasted on the board; else the session whose agent ran `wavi task add`. */
  createdBy: 'user' | SessionId
  /** The session doing it, bound once when the card is dispatched (`wavi run --task`) or claimed; never matched by name. */
  sessionId?: SessionId
  manual: TaskManual
  /** The last sentence an agent left on the card (`wavi task update --note`). */
  note?: string
  createdAt: number
  updatedAt: number
}

export interface TaskDraft {
  projectId: ProjectId
  parentId?: TaskId
  title: string
  body?: string
  createdBy?: 'user' | SessionId
}

/** `null` clears a field that can be cleared. */
export interface TaskPatch {
  title?: string
  body?: string
  note?: string | null
  manual?: TaskManual
  sessionId?: SessionId | null
  parentId?: TaskId | null
}

export const TASK_LIMITS = {
  title: 120,
  body: 8_000,
  note: 500,
  /** Levels below a root: a root is 0, its children 1, theirs 2. */
  maxDepth: 2,
  perProject: 300
} as const

/** What a card shows: `canceled` is drawn dim, the rest are the board's status words (StatusGlyph shape + text). */
export type TaskState = 'idle' | 'working' | 'attention' | 'done' | 'error' | 'canceled'

/**
 * The card's status. A session that needs you or failed always shows (an agent cannot hide it by marking done);
 * otherwise `done` set by the agent wins over the session; otherwise the session's own status.
 * No session, or one that no longer exists, and not done: waiting (`idle`, the board says 待派发).
 */
export function taskState(task: Pick<Task, 'manual'>, sessionStatus: SessionStatus | undefined): TaskState {
  if (task.manual === 'canceled') return 'canceled'
  if (sessionStatus === 'needs_you') return 'attention'
  if (sessionStatus === 'error') return 'error'
  if (task.manual === 'done') return 'done'
  switch (sessionStatus) {
    case 'running':
      return 'working'
    case 'done_unread':
      return 'done'
    default:
      return 'idle'
  }
}

export interface TaskNode {
  task: Task
  depth: number
  children: TaskNode[]
}

/** Roots and their descendants, oldest first at every level. Cards whose parent is missing are roots. */
export function buildTaskTree(tasks: readonly Task[]): TaskNode[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const kids = new Map<TaskId, Task[]>()
  const roots: Task[] = []
  for (const t of tasks) {
    if (t.parentId !== undefined && byId.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t])
    else roots.push(t)
  }
  const byAge = (a: Task, b: Task): number => a.createdAt - b.createdAt || a.seq - b.seq
  const node = (task: Task, depth: number): TaskNode => ({ task, depth, children: (kids.get(task.id) ?? []).sort(byAge).map((c) => node(c, depth + 1)) })
  return roots.sort(byAge).map((r) => node(r, 0))
}

export function taskDepth(tasks: readonly Task[], id: TaskId): number {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  let depth = 0
  const seen = new Set<TaskId>([id])
  for (let at = byId.get(id)?.parentId; at !== undefined; at = byId.get(at)?.parentId) {
    if (seen.has(at)) return Infinity
    seen.add(at)
    depth++
  }
  return depth
}

export type TaskRefusal = 'title' | 'body' | 'parent' | 'depth' | 'limit'

/** Whether a card can be added: a title, a parent in the same project, depth ≤ 2, ≤ 300 cards in the project. */
export function checkDraft(tasks: readonly Task[], draft: TaskDraft): { ok: true } | { ok: false; reason: TaskRefusal } {
  if (draft.title.trim() === '' || draft.title.length > TASK_LIMITS.title) return { ok: false, reason: 'title' }
  if ((draft.body ?? '').length > TASK_LIMITS.body) return { ok: false, reason: 'body' }
  if (tasks.filter((t) => t.projectId === draft.projectId).length >= TASK_LIMITS.perProject) return { ok: false, reason: 'limit' }
  if (draft.parentId !== undefined) {
    const parent = tasks.find((t) => t.id === draft.parentId)
    if (!parent || parent.projectId !== draft.projectId) return { ok: false, reason: 'parent' }
    if (taskDepth(tasks, parent.id) + 1 > TASK_LIMITS.maxDepth) return { ok: false, reason: 'depth' }
  }
  return { ok: true }
}

/** The states of a card's children in order: the little segments at the bottom of a parent (115A4). */
export function childSegments(node: TaskNode, stateOf: (task: Task) => TaskState): TaskState[] {
  return node.children.map((c) => stateOf(c.task))
}

/** `done` of `total` direct children; canceled ones count in neither. */
export function taskProgress(node: TaskNode, stateOf: (task: Task) => TaskState): { done: number; total: number } {
  const live = node.children.filter((c) => stateOf(c.task) !== 'canceled')
  return { done: live.filter((c) => stateOf(c.task) === 'done').length, total: live.length }
}

/** How many descendants wait on the user: a parent shows it on its own row (the board's "1 个子任务等你处理"). */
export function waitingBelow(node: TaskNode, stateOf: (task: Task) => TaskState): number {
  let n = 0
  for (const c of node.children) n += (stateOf(c.task) === 'attention' ? 1 : 0) + waitingBelow(c, stateOf)
  return n
}

// ── Storage (main) ────────────────────────────────────────────────────────────

export interface TasksFileData {
  version: 1
  /** The next `seq` to hand out. */
  nextSeq: number
  tasks: Task[]
}

const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseTask(raw: unknown): Task | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!str(r.id) || r.id === '' || !num(r.seq) || !str(r.projectId) || !str(r.title) || r.title.trim() === '') return null
  const task: Task = {
    id: r.id,
    seq: Math.floor(r.seq),
    projectId: r.projectId,
    title: r.title.slice(0, TASK_LIMITS.title),
    body: str(r.body) ? r.body.slice(0, TASK_LIMITS.body) : '',
    createdBy: str(r.createdBy) && r.createdBy !== '' ? r.createdBy : 'user',
    manual: r.manual === 'done' || r.manual === 'canceled' ? r.manual : 'todo',
    createdAt: num(r.createdAt) ? r.createdAt : 0,
    updatedAt: num(r.updatedAt) ? r.updatedAt : 0
  }
  if (str(r.parentId) && r.parentId !== '') task.parentId = r.parentId
  if (str(r.sessionId) && r.sessionId !== '') task.sessionId = r.sessionId
  if (str(r.note) && r.note !== '') task.note = r.note.slice(0, TASK_LIMITS.note)
  return task
}

/**
 * Reads the file's JSON: drops malformed cards and duplicate ids / seqs, makes a card whose parent is missing, in
 * another project, in a cycle or too deep a root, and keeps `nextSeq` above every seq.
 */
export function parseTasksFile(raw: unknown): TasksFileData {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : []
  const ids = new Set<TaskId>()
  const seqs = new Set<number>()
  const tasks: Task[] = []
  for (const item of list) {
    const t = parseTask(item)
    if (!t || ids.has(t.id) || seqs.has(t.seq)) continue
    ids.add(t.id)
    seqs.add(t.seq)
    tasks.push(t)
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    if (t.parentId === undefined) continue
    const parent = byId.get(t.parentId)
    if (!parent || parent.projectId !== t.projectId || taskDepth(tasks, t.id) > TASK_LIMITS.maxDepth) delete t.parentId
  }
  const declared = typeof raw === 'object' && raw !== null && num((raw as { nextSeq?: unknown }).nextSeq) ? Math.floor((raw as { nextSeq: number }).nextSeq) : 1
  const nextSeq = Math.max(declared, 1, ...tasks.map((t) => t.seq + 1))
  return { version: 1, nextSeq, tasks }
}

/** A card and everything below it: what removing it removes. */
export function withDescendants(tasks: readonly Task[], id: TaskId): TaskId[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const t of tasks) if (t.parentId === out[i] && !out.includes(t.id)) out.push(t.id)
  return out
}

// ── IPC ───────────────────────────────────────────────────────────────────────

export interface TaskApi {
  list(): Promise<Task[]>
  /** `null` when refused (`checkDraft`): the caller learns why from `check`, it does not need the reason from main. */
  create(draft: TaskDraft): Promise<Task | null>
  update(id: TaskId, patch: TaskPatch): Promise<Task | null>
  /** Removes the card and everything below it. */
  remove(id: TaskId): Promise<void>
  /** Every change to the list, the whole list (≤ 300 cards per project). */
  onChanged(listener: (tasks: Task[]) => void): () => void
}

export const TASK_IPC = {
  list: 'task:list',
  create: 'task:create',
  update: 'task:update',
  remove: 'task:remove',
  changed: 'task:changed'
} as const
