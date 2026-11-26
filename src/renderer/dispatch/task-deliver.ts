// A root card the user pastes on the task board gets its own leader (PRD F9 / F21 v1.250): one background session of the
// agent chosen in the new-card box, in a new worktree of the card's project, bound to the card; the card then reaches it
// once as its first message, through the same delivery as `wavi send` (`deliverMessage`: the vendor's own channel, else
// typed in while nobody types there, else held under the terminal for 送进去). The session is not selected and no sheet
// opens. 「暂不派发」 never gets here: the card just waits (待派发).
import { defineMessages, pick } from '@shared/i18n'
import type { DispatchAgent } from '@shared/dispatch'
import { defaultBase, generateBranchName, type NewSessionInfo } from '@shared/new-session'
import type { Task } from '@shared/task-board'
import type { Session, SessionId } from '@shared/types'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { planCreate, type CreatePlan } from '../new-session/model'
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

/** Why a card's leader did not start (the board's 「动态」 says it): the card then stays 待派发. */
export type LeaderFailure = 'no-project' | 'not-git' | 'no-plan' | 'no-session' | 'unbound' | 'failed'

export type LeaderStart = { ok: true; id: SessionId } | { ok: false; reason: LeaderFailure }
export type LeaderResult = { ok: true } | { ok: false; reason: LeaderFailure }

export interface LeaderDeps {
  /** A new background session of `agent` in a new worktree of the card's project, or why none could be started. */
  start(task: Task, agent: DispatchAgent): Promise<LeaderStart>
  /** Whether the card now records the session (`tasks.update` answered with the card). */
  bind(task: Task, sessionId: SessionId): Promise<boolean>
  /** Resolves once the agent is up; rejects when it never is (the message is then held for 送进去). */
  ready(sessionId: SessionId): Promise<void>
  session(sessionId: SessionId): Session | undefined
  send(session: Session, text: string, held: { key: string; title: string }): Promise<unknown>
}

/**
 * Starts the card's leader, binds it to the card (the pin shows) and gives it the card once. A session that is not
 * bound to its card is not sent the card: the board would show the card unstarted while an agent works on it.
 */
export async function handCardToLeader(task: Task, agent: DispatchAgent, deps: LeaderDeps): Promise<LeaderResult> {
  const started = await deps.start(task, agent)
  if (!started.ok) return started
  if (!(await deps.bind(task, started.id))) return { ok: false, reason: 'unbound' }
  await deps.ready(started.id).catch(() => {})
  const session = deps.session(started.id)
  if (session) await deps.send(session, taskBoardMessage(task), { key: `taskboard:${task.id}`, title: pick(M).from })
  return { ok: true }
}

/** The new worktree a leader starts in, from what git says about the project (`taken`: branch names already in use). */
export function planLeaderWorktree(
  root: string,
  info: NewSessionInfo,
  taken: ReadonlySet<string>
): { ok: true; plan: Extract<CreatePlan, { type: 'worktree' }> } | { ok: false; reason: 'not-git' | 'no-plan' } {
  if (!info.repo) return { ok: false, reason: 'not-git' }
  const result = planCreate(root, info, { workdir: 'worktree', base: defaultBase(info), branch: generateBranchName(info.prefix, taken), prepare: info.includeCount > 0 || info.hasSetup })
  return result.plan?.type === 'worktree' ? { ok: true, plan: result.plan } : { ok: false, reason: 'no-plan' }
}

async function startSession(task: Task, agent: DispatchAgent): Promise<LeaderStart> {
  try {
    const project = useWorkspace.getState().projects.find((p) => p.id === task.projectId)
    if (!project) return { ok: false, reason: 'no-project' }
    const info = await window.tr.gitWorktrees.newSessionInfo(project.rootPath)
    const taken = new Set([...info.branches.map((b) => b.name), ...useWorkspace.getState().worktrees.map((w) => w.branch)])
    const planned = planLeaderWorktree(project.rootPath, info, taken)
    if (!planned.ok) return planned
    const { plan } = planned
    const id = useWorkspace.getState().addBackgroundSession(project.id, { path: plan.path, branch: plan.request.branch, baseBranch: plan.request.base }, agent, undefined, 'cli')
    if (!id) return { ok: false, reason: 'no-session' }
    useWorkspace.getState().patchSession(id, { title: task.title, titleSource: 'prompt' })
    holdForWorktree(id)
    startEagerly(id)
    void createWorktreeFor(id, agent, plan.request)
    return { ok: true, id }
  } catch (error) {
    console.error('[tasks] the leader could not be started:', error)
    return { ok: false, reason: 'failed' }
  }
}

const gone = (s: Session): boolean => s.phase === 'exited' || s.status === 'exited'

const realDeps: LeaderDeps = {
  start: startSession,
  bind: (task, sessionId) =>
    window.tr.tasks
      .update(task.id, { sessionId })
      .then((card) => card !== null)
      .catch(() => false),
  ready: (id) => whenAgentReady(id),
  session: (id) => useWorkspace.getState().sessions.find((s) => s.id === id && !gone(s)),
  send: (session, text, held) => deliverMessage(session, text, held)
}

/** The board's 贴上 with an agent chosen: the card's leader (see the file header). */
export function startCardLeader(task: Task, agent: DispatchAgent): Promise<LeaderResult> {
  return handCardToLeader(task, agent, realDeps)
}
