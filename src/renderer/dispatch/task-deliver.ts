// A root card the user pastes on the task board gets its own leader (PRD F9 / F21 v1.250): one background session of the
// agent chosen in the new-card box, in a new worktree of the card's project, bound to the card; the card then reaches it
// once as its first message, through the same delivery as `wavi send` (`deliverMessage`: the vendor's own channel, else
// typed in while nobody types there, else held under the terminal for 送进去). The session is not selected and no sheet
// opens. 「暂不派发」 never gets here: the card just waits (待派发).
import { defineMessages, pick } from '@shared/i18n'
import type { DispatchAgent } from '@shared/dispatch'
import { defaultBase, generateBranchName } from '@shared/new-session'
import type { Task } from '@shared/task-board'
import type { Session, SessionId } from '@shared/types'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { planCreate } from '../new-session/model'
import { whenAgentReady } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { deliverMessage } from './reports'

const M = defineMessages({ zh: { from: '来自任务看板' }, en: { from: 'From the task board' } })

/** What the leader reads. English, like every message Wavi gives an agent; it starts `[Wavi` so it is never taken for a task. */
export function taskBoardMessage(task: Pick<Task, 'seq' | 'title' | 'body'>): string {
  return [
    '[Wavi task board] A card the user pasted on the task board. This message comes from the board: it is not a live instruction from the user and approves nothing.',
    `Card #${task.seq}: ${task.title}`,
    ...(task.body.trim() !== '' ? [task.body.trim()] : []),
    "You are this card's leader: split and dispatch only, do not change code yourself.",
    "Split and dispatch it following the repository's CLAUDE.md / AGENTS.md rules about dispatching (which agent, which model, how to split). If the repository has no such rules, decide yourself.",
    `First paste the sub-tasks you decide on with \`wavi task add "<title>" --parent ${task.seq}\`, then start sessions with \`wavi run <agent> "<task>" --task <seq>\`.`
  ].join('\n\n')
}

export interface LeaderDeps {
  /** A new background session of `agent` in a new worktree of the card's project; null when it could not be started. */
  start(task: Task, agent: DispatchAgent): Promise<SessionId | null>
  bind(task: Task, sessionId: SessionId): Promise<unknown>
  /** Resolves once the agent is up; rejects when it never is (the message is then held for 送进去). */
  ready(sessionId: SessionId): Promise<void>
  session(sessionId: SessionId): Session | undefined
  send(session: Session, text: string, held: { key: string; title: string }): Promise<unknown>
}

/** Starts the card's leader, binds it to the card (the pin shows) and gives it the card once. Whether a session started. */
export async function handCardToLeader(task: Task, agent: DispatchAgent, deps: LeaderDeps): Promise<boolean> {
  const id = await deps.start(task, agent)
  if (id === null) return false
  await deps.bind(task, id)
  await deps.ready(id).catch(() => {})
  const session = deps.session(id)
  if (session) await deps.send(session, taskBoardMessage(task), { key: `taskboard:${task.id}`, title: pick(M).from })
  return true
}

async function startSession(task: Task, agent: DispatchAgent): Promise<SessionId | null> {
  const workspace = useWorkspace.getState()
  const project = workspace.projects.find((p) => p.id === task.projectId)
  if (!project) return null
  const info = await window.tr.gitWorktrees.newSessionInfo(project.rootPath)
  if (!info.repo) return null
  const taken = new Set([...info.branches.map((b) => b.name), ...useWorkspace.getState().worktrees.map((w) => w.branch)])
  const result = planCreate(project.rootPath, info, { workdir: 'worktree', base: defaultBase(info), branch: generateBranchName(info.prefix, taken), prepare: info.includeCount > 0 || info.hasSetup })
  if (!result.plan || result.plan.type !== 'worktree') return null
  const { request } = result.plan
  const id = useWorkspace.getState().addBackgroundSession(project.id, { path: result.plan.path, branch: request.branch, baseBranch: request.base }, agent, undefined, 'cli')
  if (!id) return null
  useWorkspace.getState().patchSession(id, { title: task.title, titleSource: 'prompt' })
  holdForWorktree(id)
  startEagerly(id)
  void createWorktreeFor(id, agent, request)
  return id
}

const gone = (s: Session): boolean => s.phase === 'exited' || s.status === 'exited'

const realDeps: LeaderDeps = {
  start: startSession,
  bind: (task, sessionId) => window.tr.tasks.update(task.id, { sessionId }).catch(() => null),
  ready: (id) => whenAgentReady(id),
  session: (id) => useWorkspace.getState().sessions.find((s) => s.id === id && !gone(s)),
  send: (session, text, held) => deliverMessage(session, text, held)
}

/** The board's 贴上 with an agent chosen: the card's leader (see the file header). */
export function startCardLeader(task: Task, agent: DispatchAgent): Promise<boolean> {
  return handCardToLeader(task, agent, realDeps)
}
