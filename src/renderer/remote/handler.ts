// What the phone asks the window to do (PRD F22): type a prompt (photos first, as F19 does with dropped files), press
// Esc, start a session, or take Git · 变更's exits and 归档 (exits.ts). Everything goes through the same code as the desktop's own buttons: the send protocol
// (§6.9), the new-session sheet's plan (F4) and the first-message launch dispatch uses (F21).
import type { CliAgent } from '@shared/agents'
import { defineMessages, pick } from '@shared/i18n'
import type { AgentAvailability } from '@shared/ipc'
import { generateBranchName } from '@shared/new-session'
import { remoteFail, type RemoteResult, type RemoteWindowCommand } from '@shared/remote'
import type { SessionUi } from '@shared/types'
import { setLaunch } from '../dispatch/store'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { handTask } from '../new-session/hand-task'
import { binaryInstalled, branchProblemText, planCreate, uiRow } from '../new-session/model'
import { insertPaths, interruptAgent, submitInputLine, submitPrompt, whenAgentReady } from '../session-io'
import { setSessionSetting } from '../session-settings'
import { startSession } from '../state/session-start'
import { shouldAutoStart } from '../state/session-start-plan'
import { useWorkspace } from '../state/workspace'
import { randomId } from '../state/workspace-model'
import { useLiveSessions } from '../terminal/live-sessions'
import { remoteArchive, remoteExits, remoteShipAction } from './exits'
import { agentModels } from './model'

const M = defineMessages({
  zh: {
    noSession: '会话不存在',
    exited: 'agent 已经退出',
    noProject: '项目不存在',
    notInstalled: 'Mac 上没有安装这个智能体',
    noBase: '找不到这个基线分支',
    loading: '项目还在加载',
    badBranch: '分支名不能用',
    createFailed: '没能新建会话'
  },
  en: {
    noSession: 'Session not found',
    exited: 'The agent has exited',
    noProject: 'Project not found',
    notInstalled: 'This agent isn’t installed on the Mac',
    noBase: 'Can’t find this base branch',
    loading: 'The project is still loading',
    badBranch: 'This branch name can’t be used',
    createFailed: 'Couldn’t create the session'
  }
})

const failure = (error: unknown): RemoteResult => remoteFail(error instanceof Error ? error.message : String(error))

async function send(sessionId: string, text: string, paths: string[]): Promise<RemoteResult> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || session.kind === 'shell') return remoteFail(pick(M).noSession)
  if (session.phase === 'exited') return remoteFail(pick(M).exited)
  // A session restored after a restart starts when first shown; the phone counts as showing it.
  if (session.phase === 'not-started' || session.phase === 'starting') {
    startEagerly(sessionId)
    await whenAgentReady(sessionId)
  }
  // A GUI session takes the photos as the message's attachments (PRD F23), not through its composer.
  if (session.ui === 'gui') {
    const result = await window.tr.gui.send(sessionId, { text: text.trim(), attachments: [...paths] })
    return result.ok ? { ok: true } : remoteFail(result.reason)
  }
  if (paths.length > 0) await insertPaths(sessionId, paths)
  // The user speaks from the phone: a leader's turn this starts is theirs, with the usual notification (PRD F21 v1.198).
  if (text.trim()) await submitPrompt(sessionId, text, { user: true })
  else await submitInputLine(sessionId, '[Image #', { user: true })
  return { ok: true }
}

/**
 * The phone's sessions are GUI whenever the agent has one (PRD F22 v1.161): their model, effort and 模式 are then the
 * agent's own pickers, changed from the phone by button. The window's remembered 界面 is the window's, left alone.
 */
const phoneUi = (agent: CliAgent, installed: AgentAvailability): SessionUi => uiRow(agent, 'gui', binaryInstalled(installed))?.value ?? 'cli'

/** 新建会话's 模型 row: as the desktop's empty-session menu (Figma 65), asking the agent when no session listed them. */
async function modelsOf(agent: CliAgent): Promise<RemoteResult> {
  const gui = phoneUi(agent, await window.tr.app.detectAgents()) === 'gui'
  const picks = useWorkspace.getState().guiPicks[agent]
  if (!gui || picks?.models?.length) return { ok: true, data: agentModels(gui, picks, undefined) }
  const result = await window.tr.gui.models(agent)
  if (!result.ok && !('unsupported' in result)) return remoteFail(result.reason)
  // Kept as the desktop's menu keeps it, unless a session of the agent listed its own ids since.
  if (result.ok && useWorkspace.getState().guiPicks[agent]?.modelsFrom !== 'live') {
    useWorkspace.getState().rememberGuiPicks(agent, { models: result.catalog.models, modelsFrom: 'probe' })
  }
  return { ok: true, data: agentModels(true, picks, result.ok ? result.catalog : undefined) }
}

async function newSession(command: Extract<RemoteWindowCommand, { type: 'new-session' }>): Promise<RemoteResult> {
  const workspace = useWorkspace.getState()
  const project = workspace.projects.find((p) => p.id === command.project)
  if (!project) return remoteFail(pick(M).noProject)
  const [installed, info] = await Promise.all([window.tr.app.detectAgents(), window.tr.gitWorktrees.newSessionInfo(project.rootPath)])
  if (!installed[command.agent]) return remoteFail(pick(M).notInstalled)
  const ui = phoneUi(command.agent, installed)
  // The model picked under the agent is the user's pick, as one in the desktop's menu (Figma 65): the new session
  // starts with it, and so does the agent's next one.
  const model = ui === 'gui' ? command.model : undefined
  let id: string | null
  if (command.workdir === 'current' || !info.repo) {
    id = workspace.addSession(project.id, command.agent, ui)
  } else {
    const branch = command.branch ?? generateBranchName(info.prefix, new Set(info.branches.map((b) => b.name)))
    const planned = planCreate(project.rootPath, info, { workdir: 'worktree', base: command.base ?? info.defaultBranch, branch, prepare: info.includeCount > 0 || info.hasSetup })
    if (!planned.plan) {
      if (planned.problem === 'no-base') return remoteFail(pick(M).noBase)
      if (planned.problem === 'loading') return remoteFail(pick(M).loading)
      return remoteFail(branchProblemText(planned.problem, branch) ?? pick(M).badBranch)
    }
    // 交给 agent (PRD F22 v1.227 ④): a PR's worktree starts at the head main fetched; the chosen base stays what it
    // merges into (as the desktop sheet's `create` does).
    const plan =
      command.task?.startAt && planned.plan.type === 'worktree' ? { ...planned.plan, request: { ...planned.plan.request, startAt: command.task.startAt } } : planned.plan
    if (plan.type === 'current') {
      id = workspace.addSession(project.id, command.agent, ui)
    } else if (plan.type === 'existing') {
      id = workspace.addBackgroundSession(project.id, { path: plan.path, branch: plan.branch }, command.agent, undefined, ui)
    } else {
      id = workspace.addBackgroundSession(project.id, { path: plan.path, branch: plan.request.branch, baseBranch: plan.request.base }, command.agent, randomId('s'), ui)
      if (id) {
        holdForWorktree(id)
        void createWorktreeFor(id, command.agent, plan.request)
      }
    }
  }
  if (!id) return remoteFail(pick(M).createFailed)
  if (model) workspace.rememberGuiPicks(command.agent, { model })
  // 交给 agent: the item's title, link and first message, the same way the desktop's sheet hands them over. Without a
  // task, a first message starts the session as a dispatch does, which takes its model from the launch, not the picks.
  if (command.task) handTask(id, command.task, command.agent, ui, command.prompt ?? null, model)
  else if (command.prompt) setLaunch(id, { initialPrompt: command.prompt, ...(model ? { model } : {}) })
  startEagerly(id)
  return { ok: true, data: { session: id } }
}

/**
 * The phone shows the session, as a window would (useSessionStartup): a restored one that nothing started yet starts,
 * resuming — once the pty daemon has said which still run, which are reattached instead, never started again.
 */
function open(sessionId: string): RemoteResult {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || session.kind === 'shell') return remoteFail(pick(M).noSession)
  const { loaded, live } = useLiveSessions.getState()
  if (shouldAutoStart(session) && loaded && !live[sessionId]) {
    startEagerly(sessionId)
    void startSession(sessionId, { resume: true })
  }
  return { ok: true }
}

export async function handleRemoteCommand(command: RemoteWindowCommand): Promise<RemoteResult> {
  try {
    switch (command.type) {
      case 'send':
        return await send(command.session, command.text, command.paths)
      case 'interrupt':
        await interruptAgent(command.session)
        return { ok: true }
      case 'new-session':
        return await newSession(command)
      case 'exits':
        return await remoteExits(command.session)
      case 'ship':
        return await remoteShipAction(command.session, command.action)
      case 'archive':
        return await remoteArchive(command.session)
      case 'set-setting':
        return await setSessionSetting(command.session, command.kind, command.value)
      case 'open':
        return open(command.session)
      case 'agent-models':
        return await modelsOf(command.agent)
    }
  } catch (error) {
    return failure(error)
  }
}
