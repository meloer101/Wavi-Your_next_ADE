// 任务看板's store (PRD F9 v1.249): main is the only writer of `<userData>/tasks.json`. Windows and `wavi task` read and
// change cards through it (IPC), so two writers never overwrite each other. No Electron imports: unit-tested with a
// fake clock and ids.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { checkDraft, parseTaskPos, parseTasksFile, taskDepth, TASK_LIMITS, withDescendants, type Task, type TaskDraft, type TaskId, type TaskPatch, type TasksFileData } from '@shared/task-board'

export class TasksFile {
  /** The file exists but could not be read: it is never written over (the board then lives in memory only). */
  private unreadable = false

  constructor(private readonly path: string) {}

  get memoryOnly(): boolean {
    return this.unreadable
  }

  /**
   * Only a missing file is an empty board. A file that is not JSON, or is JSON of another shape, is moved aside before
   * anything is written over it; one that exists but cannot be read is left alone and nothing is written (`save`).
   */
  load(): TasksFileData {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.unreadable = true
        console.error('[tasks] could not read tasks.json; the board stays in memory and the file is not written', error)
      }
      return parseTasksFile(null)
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      this.moveAside('is not JSON', error)
      return parseTasksFile(null)
    }
    if (typeof value !== 'object' || value === null || !Array.isArray((value as { tasks?: unknown }).tasks)) {
      this.moveAside('is not a tasks file', undefined)
      return parseTasksFile(null)
    }
    return parseTasksFile(value)
  }

  private moveAside(why: string, error: unknown): void {
    const aside = `${this.path}.bad-${Date.now()}`
    console.error(`[tasks] tasks.json ${why}; moved to`, aside, error ?? '')
    try {
      renameSync(this.path, aside)
    } catch (renameError) {
      this.unreadable = true
      console.error('[tasks] could not move tasks.json aside; the file is not written', renameError)
    }
  }

  /** Whether the file now holds `data`. */
  save(data: TasksFileData): boolean {
    if (this.unreadable) return false
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 1))
      renameSync(tmp, this.path)
      return true
    } catch (error) {
      console.error('[tasks] could not save tasks.json', error)
      return false
    }
  }
}

export interface TaskBoardDeps {
  now(): number
  newId(): string
  /** Every change, the whole list. */
  changed(tasks: Task[]): void
}

/** The height of the tree below a card: 0 for a leaf. */
function heightBelow(tasks: readonly Task[], id: TaskId): number {
  let height = 0
  for (let level = [id]; level.length > 0; height++) {
    level = tasks.filter((t) => t.parentId !== undefined && level.includes(t.parentId)).map((t) => t.id)
    if (height > TASK_LIMITS.maxDepth + 1) break
  }
  return Math.max(0, height - 1)
}

export class TaskBoard {
  private data: TasksFileData

  constructor(
    private readonly file: TasksFile,
    private readonly deps: TaskBoardDeps
  ) {
    this.data = file.load()
  }

  list(): Task[] {
    return this.data.tasks.map((t) => ({ ...t }))
  }

  /** The new card, or null when `checkDraft` refuses it. */
  create(draft: TaskDraft): Task | null {
    if (!checkDraft(this.data.tasks, draft).ok) return null
    const now = this.deps.now()
    const task: Task = {
      id: this.deps.newId(),
      seq: this.data.nextSeq,
      projectId: draft.projectId,
      title: draft.title.trim(),
      body: draft.body ?? '',
      createdBy: draft.createdBy ?? 'user',
      manual: 'todo',
      createdAt: now,
      updatedAt: now,
      ...(draft.parentId !== undefined ? { parentId: draft.parentId } : {})
    }
    return this.commit({ ...this.data, nextSeq: this.data.nextSeq + 1, tasks: [...this.data.tasks, task] }) ? { ...task } : null
  }

  /** The changed card, or null when it does not exist or the patch is refused (nothing changes then). */
  update(id: TaskId, patch: TaskPatch): Task | null {
    const tasks = this.data.tasks
    const at = tasks.findIndex((t) => t.id === id)
    const old = tasks[at]
    if (!old) return null
    const next: Task = { ...old }
    if (patch.title !== undefined) {
      if (patch.title.trim() === '' || patch.title.length > TASK_LIMITS.title) return null
      next.title = patch.title.trim()
    }
    if (patch.body !== undefined) {
      if (patch.body.length > TASK_LIMITS.body) return null
      next.body = patch.body
    }
    if (patch.note === null) delete next.note
    else if (patch.note !== undefined) {
      const note = patch.note.trim().slice(0, TASK_LIMITS.note)
      if (note === '') delete next.note
      else next.note = note
    }
    if (patch.manual !== undefined) next.manual = patch.manual
    if (patch.sessionId === null) delete next.sessionId
    else if (patch.sessionId !== undefined) {
      // One session, one card.
      if (tasks.some((t) => t.id !== id && t.sessionId === patch.sessionId)) return null
      next.sessionId = patch.sessionId
    }
    if (patch.pos === null) delete next.pos
    else if (patch.pos !== undefined) {
      const pos = parseTaskPos(patch.pos)
      if (!pos) return null
      next.pos = pos
    }
    if (patch.parentId !== undefined && patch.parentId !== old.parentId) {
      if (patch.parentId === null) delete next.parentId
      else {
        const parent = tasks.find((t) => t.id === patch.parentId)
        if (!parent || parent.projectId !== old.projectId) return null
        // No cycle: the new parent is not the card or one of its descendants.
        if (withDescendants(tasks, id).includes(parent.id)) return null
        // Depth counts the moved card's own subtree.
        if (taskDepth(tasks, parent.id) + 1 + heightBelow(tasks, id) > TASK_LIMITS.maxDepth) return null
        next.parentId = parent.id
      }
      // A child's `pos` is an offset from its old parent; a position set in this same patch is the new one.
      if (patch.pos === undefined) delete next.pos
    }
    next.updatedAt = this.deps.now()
    return this.commit({ ...this.data, tasks: tasks.map((t, i) => (i === at ? next : t)) }) ? { ...next } : null
  }

  /** Removes the card and everything below it; whether it was removed (false: no such card, or the save failed). */
  remove(id: TaskId): boolean {
    if (!this.data.tasks.some((t) => t.id === id)) return false
    const gone = new Set(withDescendants(this.data.tasks, id))
    return this.commit({ ...this.data, tasks: this.data.tasks.filter((t) => !gone.has(t.id)) })
  }

  /**
   * Puts removed cards back with their own ids, `#seq`s and places (undo, PRD F9 v1.252). Refused (false, nothing
   * changes) when an id or `#seq` is on the board or repeated, a `#seq` was never handed out, or a project would pass
   * its limit. A card whose parent is gone for good comes back as a root, and a session since bound to another card
   * stays with that card.
   */
  restore(cards: readonly Task[]): boolean {
    const ids = new Set(this.data.tasks.map((t) => t.id))
    const seqs = new Set(this.data.tasks.map((t) => t.seq))
    const bound = new Set(this.data.tasks.map((t) => t.sessionId).filter((id) => id !== undefined))
    for (const card of cards) {
      if (ids.has(card.id) || seqs.has(card.seq) || card.seq >= this.data.nextSeq) return false
      ids.add(card.id)
      seqs.add(card.seq)
    }
    if (cards.length === 0) return false
    const tasks = [...this.data.tasks, ...cards.map((c) => ({ ...c }))]
    const byId = new Map(tasks.map((t) => [t.id, t]))
    for (const card of tasks.slice(this.data.tasks.length)) {
      if (tasks.filter((t) => t.projectId === card.projectId).length > TASK_LIMITS.perProject) return false
      if (card.sessionId !== undefined) {
        if (bound.has(card.sessionId)) delete card.sessionId
        else bound.add(card.sessionId)
      }
      if (card.parentId === undefined) continue
      const parent = byId.get(card.parentId)
      if (!parent || parent.projectId !== card.projectId || taskDepth(tasks, card.id) > TASK_LIMITS.maxDepth) {
        delete card.parentId
        // A child's place is an offset from its parent: without one it means nothing.
        delete card.pos
      }
    }
    return this.commit({ ...this.data, tasks })
  }

  /** Makes `next` the board and saves it; when the save fails the board stays as it was and nobody is told of a change. */
  private commit(next: TasksFileData): boolean {
    if (!this.file.save(next) && !this.file.memoryOnly) return false
    this.data = next
    this.deps.changed(this.list())
    return true
  }
}
