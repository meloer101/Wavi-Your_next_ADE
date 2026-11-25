// 任务看板's store (PRD F9 v1.246): main is the only writer of `<userData>/tasks.json`. Windows and `wavi task` read and
// change cards through it (IPC), so two writers never overwrite each other. No Electron imports: unit-tested with a
// fake clock and ids.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { checkDraft, parseTasksFile, taskDepth, TASK_LIMITS, withDescendants, type Task, type TaskDraft, type TaskId, type TaskPatch, type TasksFileData } from '@shared/task-board'

export class TasksFile {
  constructor(private readonly path: string) {}

  /** Only a missing file is an empty board: one that cannot be parsed is moved aside before anything is written over it. */
  load(): TasksFileData {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[tasks] could not read tasks.json', error)
      return parseTasksFile(null)
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const aside = `${this.path}.bad-${Date.now()}`
      console.error('[tasks] tasks.json is not JSON; moved to', aside, error)
      try {
        renameSync(this.path, aside)
      } catch (renameError) {
        console.error('[tasks] could not move tasks.json aside', renameError)
      }
      return parseTasksFile(null)
    }
    return parseTasksFile(value)
  }

  save(data: TasksFileData): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 1))
      renameSync(tmp, this.path)
    } catch (error) {
      console.error('[tasks] could not save tasks.json', error)
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
    this.data = { ...this.data, nextSeq: this.data.nextSeq + 1, tasks: [...this.data.tasks, task] }
    this.commit()
    return { ...task }
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
    else if (patch.sessionId !== undefined) next.sessionId = patch.sessionId
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
    }
    next.updatedAt = this.deps.now()
    this.data = { ...this.data, tasks: tasks.map((t, i) => (i === at ? next : t)) }
    this.commit()
    return { ...next }
  }

  /** Removes the card and everything below it; whether anything was removed. */
  remove(id: TaskId): boolean {
    if (!this.data.tasks.some((t) => t.id === id)) return false
    const gone = new Set(withDescendants(this.data.tasks, id))
    this.data = { ...this.data, tasks: this.data.tasks.filter((t) => !gone.has(t.id)) }
    this.commit()
    return true
  }

  private commit(): void {
    this.file.save(this.data)
    this.deps.changed(this.list())
  }
}
