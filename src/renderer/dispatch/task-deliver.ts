// A root card the user pastes on the task board gets its own leader (PRD F9 / F21 v1.250): one background session of the
// agent chosen in the new-card box (any installed CLI agent, with the picked model and effort, v1.252), in a new
// worktree of the card's project, bound to the card; the card is its first message, on the agent's command line like a
// `wavi run` child's task (`setLaunch`), so it starts working as soon as it is up. Typing it in after start or Claude's
// inbox would race the agent's start (the inbox is known only after its SessionStart hook) and leave the card held under
// the terminal for 送进去; only the CLIs with no way to take a first message have it typed once they are ready. The
// session is not selected and no sheet opens. 「暂不派发」 never gets here: the card just waits (待派发).
import { promptOnCommandLine } from '@shared/agent-launch'
import { canLeadCard, type DispatchAgent } from '@shared/dispatch'
import { defaultBase, generateBranchName, type NewSessionInfo } from '@shared/new-session'
import type { Task } from '@shared/task-board'
import type { SessionId } from '@shared/types'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { planCreate, type CreatePlan } from '../new-session/model'
import { submitPrompt, whenAgentReady } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { setLaunch } from './store'

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

/**
 * Why a card's leader did not start or did not get the card (the card and 「动态」 say it). `not-delivered`: the session
 * is bound and running, but the card never reached it; for every other reason the card stays 待派发.
 */
export type LeaderFailure = 'no-project' | 'not-git' | 'no-plan' | 'no-session' | 'unbound' | 'failed' | 'not-delivered'

/**
 * `launch` creates the worktree and starts the agent with `prompt` as its first message; it resolves false when a
 * message that has to be typed did not reach the agent. `discard` removes the session instead, before any launch.
 */
export type LeaderStart = { ok: true; id: SessionId; launch(prompt: string): Promise<boolean>; discard(): void } | { ok: false; reason: LeaderFailure }
export type LeaderResult = { ok: true } | { ok: false; reason: LeaderFailure }

/** The model and effort the user picked for the card's leader; absent = the CLI's own default. */
export interface LeaderOptions {
  model?: string
  effort?: string
}

export interface LeaderDeps {
  /** A new background session of `agent` for a new worktree of the card's project, not running yet, or why not. */
  start(task: Task, agent: DispatchAgent, options: LeaderOptions): Promise<LeaderStart>
  /** Whether the card now records the session (`tasks.update` answered with the card). */
  bind(task: Task, sessionId: SessionId): Promise<boolean>
}

/**
 * Adds the card's leader, binds it to the card (the pin shows), then starts it with the card as its first message.
 * A session that cannot be bound is not started: the board would show the card unstarted while an agent works on it,
 * so it is removed again. `late` hears that a typed card did not arrive, after this has answered.
 */
export async function handCardToLeader(task: Task, agent: DispatchAgent, deps: LeaderDeps, options: LeaderOptions = {}, late?: (reason: LeaderFailure) => void): Promise<LeaderResult> {
  const started = await deps.start(task, agent, options)
  if (!started.ok) return started
  if (!(await deps.bind(task, started.id))) {
    started.discard()
    return { ok: false, reason: 'unbound' }
  }
  void started.launch(taskBoardMessage(task)).then((delivered) => {
    if (!delivered) late?.('not-delivered')
  })
  return { ok: true }
}

/** Types the card into a CLI that takes no first message on its command line, once it is ready; whether it got there. */
export async function typeCard(id: SessionId, prompt: string, io: { ready(id: SessionId): Promise<void>; submit(id: SessionId, text: string): Promise<void> }): Promise<boolean> {
  try {
    await io.ready(id)
    await io.submit(id, prompt)
    return true
  } catch (error) {
    console.error('[tasks] the card did not reach its leader:', error)
    return false
  }
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

async function startSession(task: Task, agent: DispatchAgent, options: LeaderOptions): Promise<LeaderStart> {
  if (!canLeadCard(agent)) return { ok: false, reason: 'failed' }
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
    // Its terminal waits for the worktree, which `launch` creates once the card is bound.
    holdForWorktree(id)
    const launch = async (prompt: string): Promise<boolean> => {
      setLaunch(id, { initialPrompt: prompt, ...options })
      startEagerly(id)
      const created = await createWorktreeFor(id, agent, plan.request)
      // A worktree that could not be created is said on the session itself.
      if (!created || promptOnCommandLine(agent)) return true
      return typeCard(id, prompt, { ready: whenAgentReady, submit: submitPrompt })
    }
    // Never launched, so there is no process and no folder: the record and its session go.
    const discard = (): void => {
      const worktreeId = useWorkspace.getState().sessions.find((s) => s.id === id)?.worktreeId
      if (worktreeId !== undefined) useWorkspace.getState().forgetWorktrees([worktreeId])
    }
    return { ok: true, id, launch, discard }
  } catch (error) {
    console.error('[tasks] the leader could not be started:', error)
    return { ok: false, reason: 'failed' }
  }
}

const realDeps: LeaderDeps = {
  start: startSession,
  bind: (task, sessionId) =>
    window.tr.tasks
      .update(task.id, { sessionId })
      .then((card) => card !== null)
      .catch(() => false)
}

/** The board's 贴上 (or 派发) with an agent chosen: the card's leader (see the file header). */
export function startCardLeader(task: Task, agent: DispatchAgent, options: LeaderOptions = {}, late?: (reason: LeaderFailure) => void): Promise<LeaderResult> {
  return handCardToLeader(task, agent, realDeps, options, late)
}
