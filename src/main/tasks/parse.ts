// Validation of what the renderer sends over `TASK_IPC` (main never trusts it). Pure.
import { parseTaskPos, TASK_LIMITS, type Task, type TaskDraft, type TaskId, type TaskManual, type TaskPatch } from '@shared/task-board'

const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const idText = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 128 && !v.includes('\0')

export function parseTaskId(raw: unknown): TaskId {
  if (!idText(raw)) throw new Error('bad task id')
  return raw
}

export function parseTaskDraft(raw: unknown): TaskDraft | null {
  const v = record(raw)
  if (!v || !idText(v.projectId) || typeof v.title !== 'string') return null
  if (v.body !== undefined && typeof v.body !== 'string') return null
  if (v.parentId !== undefined && !idText(v.parentId)) return null
  if (v.createdBy !== undefined && !idText(v.createdBy)) return null
  const pos = v.pos === undefined ? undefined : parseTaskPos(v.pos)
  if (pos === null) return null
  return {
    ...(pos ? { pos } : {}),
    projectId: v.projectId,
    title: v.title,
    ...(typeof v.body === 'string' ? { body: v.body } : {}),
    ...(typeof v.parentId === 'string' ? { parentId: v.parentId } : {}),
    ...(typeof v.createdBy === 'string' ? { createdBy: v.createdBy } : {})
  }
}

const MANUAL: readonly unknown[] = ['todo', 'done', 'canceled'] satisfies TaskManual[]

export function parseTaskPatch(raw: unknown): TaskPatch | null {
  const v = record(raw)
  if (!v) return null
  const patch: TaskPatch = {}
  if (v.title !== undefined) {
    if (typeof v.title !== 'string') return null
    patch.title = v.title
  }
  if (v.body !== undefined) {
    if (typeof v.body !== 'string') return null
    patch.body = v.body
  }
  if (v.note !== undefined) {
    if (v.note !== null && typeof v.note !== 'string') return null
    patch.note = v.note
  }
  if (v.manual !== undefined) {
    if (!MANUAL.includes(v.manual)) return null
    patch.manual = v.manual as TaskManual
  }
  if (v.sessionId !== undefined) {
    if (v.sessionId !== null && !idText(v.sessionId)) return null
    patch.sessionId = v.sessionId
  }
  if (v.parentId !== undefined) {
    if (v.parentId !== null && !idText(v.parentId)) return null
    patch.parentId = v.parentId
  }
  if (v.pos !== undefined) {
    if (v.pos === null) patch.pos = null
    else {
      const pos = parseTaskPos(v.pos)
      if (!pos) return null
      patch.pos = pos
    }
  }
  return patch
}

/** More cards than this in one undo is not a delete the board made (300 per project, a handful of projects). */
const MAX_SNAPSHOT = 3_000

const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= Number.MAX_SAFE_INTEGER
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

function parseCard(raw: unknown): Task | null {
  const v = record(raw)
  if (!v || !idText(v.id) || !count(v.seq) || !idText(v.projectId)) return null
  if (!text(v.title, TASK_LIMITS.title) || v.title.trim() === '' || !text(v.body, TASK_LIMITS.body)) return null
  if (!idText(v.createdBy) || !MANUAL.includes(v.manual) || !time(v.createdAt) || !time(v.updatedAt)) return null
  if (v.parentId !== undefined && !idText(v.parentId)) return null
  if (v.sessionId !== undefined && !idText(v.sessionId)) return null
  if (v.note !== undefined && !text(v.note, TASK_LIMITS.note)) return null
  const pos = v.pos === undefined ? undefined : parseTaskPos(v.pos)
  if (pos === null) return null
  return {
    id: v.id,
    seq: v.seq,
    projectId: v.projectId,
    title: v.title,
    body: v.body,
    createdBy: v.createdBy,
    manual: v.manual as TaskManual,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    ...(v.parentId !== undefined ? { parentId: v.parentId } : {}),
    ...(v.sessionId !== undefined ? { sessionId: v.sessionId } : {}),
    ...(v.note !== undefined ? { note: v.note } : {}),
    ...(pos ? { pos } : {})
  }
}

/** The cards an undo puts back, whole or not at all. */
export function parseTaskSnapshot(raw: unknown): Task[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SNAPSHOT) return null
  const cards: Task[] = []
  for (const item of raw) {
    const card = parseCard(item)
    if (!card) return null
    cards.push(card)
  }
  return cards
}
