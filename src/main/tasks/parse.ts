// Validation of what the renderer sends over `TASK_IPC` (main never trusts it). Pure.
import { parseTaskPos, type TaskDraft, type TaskId, type TaskManual, type TaskPatch } from '@shared/task-board'

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
  return {
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
