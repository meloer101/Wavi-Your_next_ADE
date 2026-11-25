// `wavi task …` and `wavi run --task` in a window (PRD F21 v1.246): which cards a session may touch, and what the agent
// is told. The cards live in main (`window.tr.tasks`, one writer); this file only decides and words. The rules are
// pure functions of the card list and the caller, tested without a window.
import { waviFail, waviOk, DISPATCH_LIMITS, type WaviCommand, type WaviResult } from '@shared/dispatch'
import { checkDraft, taskState, withDescendants, type Task, type TaskDraft, type TaskRefusal, type TaskState } from '@shared/task-board'
import type { Session, SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import type { Place } from './places'

type TaskCommand = Extract<WaviCommand, { name: 'task-add' | 'task-update' | 'task-ls' | 'task-show' }>

/** Who is asking, as far as the cards care. */
export interface TaskCaller {
  sessionId: SessionId
  projectId: string
  leader: boolean
  /** 0: the user's own session, 1: one it dispatched, 2: the last level. */
  depth: number
}

/** The caller as the rules see it. */
export const taskCaller = (place: Place, depth: number, leader: boolean): TaskCaller => ({ sessionId: place.session.id, projectId: place.project.id, leader, depth })

/** The card whose session is the caller (the first one, should the file ever hold two). */
export const boundCardOf = (tasks: readonly Task[], sessionId: SessionId): Task | undefined => tasks.find((t) => t.sessionId === sessionId)

const inProject = (tasks: readonly Task[], caller: TaskCaller, seq: number): Task | undefined => tasks.find((t) => t.seq === seq && t.projectId === caller.projectId)

/** Whether the caller may change or read this card: a leader any card of its project; the rest their own card and below. */
export function mayTouch(tasks: readonly Task[], caller: TaskCaller, task: Task): boolean {
  if (task.projectId !== caller.projectId) return false
  if (caller.leader) return true
  const own = boundCardOf(tasks, caller.sessionId)
  return own !== undefined && withDescendants(tasks, own.id).includes(task.id)
}

const noCard = (seq: number): WaviResult => waviFail('not_found', `No card #${seq} in this project. wavi task ls shows them.`)
const notYours = (seq: number): WaviResult =>
  waviFail('not_allowed', `Card #${seq} is not yours: you may only change the card your session is bound to and the cards below it. Say what you need in your report instead.`)

/** The card `--parent` / `show` / `update` names, if the caller may touch it. */
function reachable(tasks: readonly Task[], caller: TaskCaller, seq: number): Task | WaviResult {
  const task = inProject(tasks, caller, seq)
  if (!task) return noCard(seq)
  return mayTouch(tasks, caller, task) ? task : notYours(seq)
}

const isTask = (value: Task | WaviResult): value is Task => 'seq' in value

const REFUSALS: Record<TaskRefusal, string> = {
  title: 'The title is empty or too long (120 characters at most); the longer text goes in --body.',
  body: 'The body is too long (8000 characters at most).',
  parent: 'That parent card is not in this project.',
  depth: 'Cards nest two levels below a root; this one would be deeper. Put it under a card higher up, or do it as part of that card.',
  limit: 'This project already has 300 cards. Ask the user to clear some.'
}

/** What `wavi task add` pastes, or why it may not. */
export function planAdd(tasks: readonly Task[], caller: TaskCaller, command: Extract<TaskCommand, { name: 'task-add' }>): TaskDraft | WaviResult {
  if (caller.depth >= DISPATCH_LIMITS.depth) return waviFail('not_allowed', "This level can't split further: do it yourself, and report what else is needed.")
  let parentId: string | undefined
  if (command.parent !== undefined) {
    const parent = reachable(tasks, caller, command.parent)
    if (!isTask(parent)) return parent
    parentId = parent.id
  } else {
    parentId = boundCardOf(tasks, caller.sessionId)?.id
    if (parentId === undefined && !caller.leader) {
      return waviFail('not_allowed', 'Your session has no card of its own: pass --parent <card> to say which card this one goes under (wavi task ls shows them).')
    }
  }
  const draft: TaskDraft = {
    projectId: caller.projectId,
    title: command.title,
    ...(command.body ? { body: command.body } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    createdBy: caller.sessionId
  }
  const check = checkDraft(tasks, draft)
  return check.ok ? draft : waviFail('failed', REFUSALS[check.reason])
}

/** The card a `wavi run --task` binds the new session to, or why it may not. */
export function planRunCard(tasks: readonly Task[], caller: TaskCaller, seq: number, sessionExists: (id: SessionId) => boolean): Task | WaviResult {
  const task = inProject(tasks, caller, seq)
  if (!task) return noCard(seq)
  if (task.manual !== 'todo') return waviFail('not_allowed', `Card #${seq} is ${task.manual === 'done' ? 'marked done' : 'canceled'}: there is nothing to start.`)
  if (!caller.leader) {
    // Not the caller's own card: the session it starts there would be the caller itself again.
    const own = boundCardOf(tasks, caller.sessionId)
    const below = own !== undefined && own.id !== task.id && withDescendants(tasks, own.id).includes(task.id)
    if (!below) return waviFail('not_allowed', `Card #${seq} is not below your own card: you may only start sessions for the cards under the one your session is bound to.`)
  }
  if (task.sessionId !== undefined && sessionExists(task.sessionId)) {
    return waviFail('duplicate', `Card #${seq} already has a session (${task.sessionId}). Use wavi send to that session instead.`)
  }
  return task
}

const STATE_TEXT: Record<TaskState, string> = {
  idle: 'not started',
  working: 'working',
  attention: 'waiting for the user',
  done: 'done',
  error: 'error',
  canceled: 'canceled'
}

function describe(tasks: readonly Task[], task: Task, sessions: readonly Session[], projects?: ReadonlyMap<string, string>): string {
  const session = task.sessionId !== undefined ? sessions.find((s) => s.id === task.sessionId) : undefined
  const parent = task.parentId !== undefined ? tasks.find((t) => t.id === task.parentId) : undefined
  const facts = [
    `#${task.seq}`,
    ...(projects ? [projects.get(task.projectId) ?? task.projectId] : []),
    `"${task.title}"`,
    STATE_TEXT[taskState(task, session?.status === 'exited' ? undefined : session?.status)],
    ...(session ? [`session ${session.id} "${session.title}"`] : []),
    ...(parent ? [`under #${parent.seq}`] : [])
  ]
  return facts.join(' · ')
}

export function listText(tasks: readonly Task[], caller: TaskCaller, all: boolean, sessions: readonly Session[], projects: ReadonlyMap<string, string>): WaviResult {
  if (all && !caller.leader) return waviFail('not_allowed', "Only the project's leader lists every project. wavi task ls lists this project.")
  const shown = tasks.filter((t) => all || t.projectId === caller.projectId)
  if (shown.length === 0) return waviOk('No cards on the board.')
  const byAge = [...shown].sort((a, b) => a.seq - b.seq)
  return waviOk([...byAge.map((t) => `- ${describe(tasks, t, sessions, all ? projects : undefined)}`), '', 'wavi task show <card> prints one in full.'].join('\n'))
}

export function showText(tasks: readonly Task[], caller: TaskCaller, seq: number, sessions: readonly Session[]): WaviResult {
  const task = reachable(tasks, caller, seq)
  if (!isTask(task)) return task
  const children = tasks.filter((t) => t.parentId === task.id).sort((a, b) => a.seq - b.seq)
  return waviOk(
    [
      describe(tasks, task, sessions),
      ...(task.body ? ['', task.body] : []),
      ...(task.note ? ['', `Note: ${task.note}`] : []),
      ...(children.length > 0 ? ['', 'Sub-cards:', ...children.map((c) => `- ${describe(tasks, c, sessions)}`)] : [])
    ].join('\n')
  )
}

export async function handleTaskCommand(caller: Place, depth: number, leader: boolean, command: TaskCommand): Promise<WaviResult> {
  const who = taskCaller(caller, depth, leader)
  const tasks = await window.tr.tasks.list()
  const { sessions, projects } = useWorkspace.getState()
  switch (command.name) {
    case 'task-ls':
      return listText(tasks, who, command.all === true, sessions, new Map(projects.map((p) => [p.id, p.name])))
    case 'task-show':
      return showText(tasks, who, command.seq, sessions)
    case 'task-add': {
      const draft = planAdd(tasks, who, command)
      if ('ok' in draft) return draft
      const made = await window.tr.tasks.create(draft)
      if (!made) return waviFail('failed', 'Wavi could not add the card.')
      const parent = tasks.find((t) => t.id === draft.parentId)
      return waviOk(`Added card #${made.seq} "${made.title}"${parent ? ` under #${parent.seq}` : ''}. Start a session for it with wavi run <agent> "<task>" --task ${made.seq}.`)
    }
    case 'task-update': {
      const task = reachable(tasks, who, command.seq)
      if (!isTask(task)) return task
      const changed = await window.tr.tasks.update(task.id, {
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.note !== undefined ? { note: command.note === '' ? null : command.note } : {}),
        ...(command.done ? { manual: 'done' as const } : {}),
        ...(command.cancel ? { manual: 'canceled' as const } : {})
      })
      return changed ? waviOk(`Updated: ${describe(await window.tr.tasks.list(), changed, sessions)}`) : waviFail('failed', 'Wavi could not change that card (is the title too long?).')
    }
  }
}
