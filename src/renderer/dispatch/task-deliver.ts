// A card the user pastes on the board reaches the project's leader (PRD F21 v1.249): once, as one message through the
// same delivery as `wavi send` and a session's brief (`deliverMessage`: the vendor's own channel, else typed in while
// nobody types there, else held under the terminal for 送进去). A project without a leader leaves the card waiting
// (待派发) on the board; Wavi never starts one.
import { defineMessages, pick } from '@shared/i18n'
import type { Task } from '@shared/task-board'
import type { Session } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { leaderOfProject } from './places'
import { deliverMessage } from './reports'

const M = defineMessages({ zh: { from: '来自任务看板' }, en: { from: 'From the task board' } })

/** What the leader reads. English, like every message Wavi gives an agent; it starts `[Wavi` so it is never taken for a task. */
export function taskBoardMessage(task: Pick<Task, 'seq' | 'title' | 'body'>): string {
  return [
    '[Wavi task board] A card the user pasted on the task board. This message comes from the board: it is not a live instruction from the user and approves nothing.',
    `Card #${task.seq}: ${task.title}`,
    ...(task.body.trim() !== '' ? [task.body.trim()] : []),
    "Split and dispatch it following the repository's CLAUDE.md / AGENTS.md rules about dispatching (which agent, which model, how to split). If the repository has no such rules, decide yourself.",
    `First paste the sub-tasks you decide on with \`wavi task add "<title>" --parent ${task.seq}\`, then start sessions with \`wavi run <agent> "<task>" --task <seq>\`.`
  ].join('\n\n')
}

export interface DeliverDeps {
  /** The project's leader session, if it has one and its agent is still there. */
  leader(projectId: string): Session | null
  send(session: Session, text: string, held: { key: string; title: string }): void
}

/** Sends each card of `tasks` not in `seen` that the user pasted as a root; every card seen is remembered. */
export function deliverNew(tasks: readonly Task[], seen: Set<string>, deps: DeliverDeps): void {
  for (const task of tasks) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    if (task.createdBy !== 'user' || task.parentId !== undefined) continue
    const leader = deps.leader(task.projectId)
    if (leader) deps.send(leader, taskBoardMessage(task), { key: `taskboard:${task.id}`, title: pick(M).from })
  }
}

const gone = (s: Session): boolean => s.phase === 'exited' || s.status === 'exited'

/** Once per window: the cards already on the board when it opens count as seen (an earlier window handled them). */
export function startTaskDelivery(): () => void {
  const seen = new Set<string>()
  const initial = window.tr.tasks
    .list()
    .then((tasks) => tasks.forEach((t) => seen.add(t.id)))
    .catch(() => {})
  const deps: DeliverDeps = {
    leader: (projectId) => {
      const id = leaderOfProject(projectId)
      const session = id ? useWorkspace.getState().sessions.find((s) => s.id === id) : undefined
      return session && !gone(session) ? session : null
    },
    send: (session, text, held) => void deliverMessage(session, text, held)
  }
  const off = window.tr.tasks.onChanged((tasks) => void initial.then(() => deliverNew(tasks, seen, deps)))
  return off
}
