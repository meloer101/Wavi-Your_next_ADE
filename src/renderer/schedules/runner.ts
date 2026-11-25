// Runs what main says is due (PRD F24) with the same code as the window's own buttons: a 开新会话 task makes a new
// worktree session as the phone's 新建会话 does (remote/handler.ts) and gives it the task's message as its first one
// (F21's launch); a 发给已有会话 task writes into the session through the send protocol (§6.9) once it is idle. A run's
// session that ends its turn with nothing changed is archived (F15) when the task says so. Every outcome goes back to main.
import { AGENT_SPECS, usageVendor } from '@shared/agents'
import { defineMessages, pick } from '@shared/i18n'
import { runBranch, runSessionTitle, type Schedule, type ScheduleFire, type ScheduleRun } from '@shared/schedule'
import type { SessionId, SessionStatus } from '@shared/types'
import { archiveTargetFor, archiveWorktree, blockerFor } from '../archive/actions'
import { startEagerly } from '../new-session/creation'
import { launchWorktreeSession } from '../new-session/launch'
import { binaryInstalled, branchProblemText, planCreate, uiRow } from '../new-session/model'
import { submitPrompt, whenAgentReady } from '../session-io'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'
import { freeBranch, previousRunActive, quotaBlock, sendStep, unchanged } from './model'
import { setAgentSchedulesAllowed } from './agent-requests'
import { followSchedules, useSchedules } from './store'

/** A 发给已有会话 run waiting for the session's turn to end gives up after this. */
const SEND_WAIT_MS = 6 * 60 * 60 * 1000

type Outcome = Pick<ScheduleRun, 'outcome' | 'reason' | 'sessionId'>

function report(fire: Pick<ScheduleFire, 'schedule' | 'planned' | 'caughtUp' | 'manual'>, outcome: Outcome): void {
  const run: ScheduleRun = {
    planned: fire.planned,
    at: Date.now(),
    ...outcome,
    ...(fire.caughtUp ? { caughtUp: true } : {}),
    ...(fire.manual ? { manual: true } : {})
  }
  void window.tr.schedules.report(fire.schedule.id, run).catch((error: unknown) => console.error('[schedules] report', error))
}

const M = defineMessages({
  zh: {
    badAction: '任务内容不对',
    projectGone: '项目不在了',
    previousActive: '上次开的会话还没完',
    notRepo: '项目不是 git 仓库',
    noWorktree: '没能建 worktree',
    noSession: '没能新建会话',
    notSentInTime: '下一次到点时还没发出',
    waitTurn: '等这一轮结束再发',
    turnNeverEnded: '这一轮一直没结束',
    runningAgain: '会话又开始跑了',
    notInstalled: (agent: string) => `没有安装 ${agent}`,
    branchElsewhere: (branch: string) => `分支 ${branch} 在另一个 worktree 里打开着`,
    noBranch: (branch: string) => `找不到分支 ${branch}`,
    opened: (title: string) => `开了「${title}」`
  },
  en: {
    badAction: 'The task is malformed',
    projectGone: 'The project is gone',
    previousActive: 'The session from the last run isn’t done yet',
    notRepo: 'The project isn’t a Git repository',
    noWorktree: 'Couldn’t create the worktree',
    noSession: 'Couldn’t create the session',
    notSentInTime: 'Still not sent when the next run came due',
    waitTurn: 'Sends when this turn ends',
    turnNeverEnded: 'The turn never ended',
    runningAgain: 'The session started running again',
    notInstalled: (agent: string) => `${agent} isn’t installed`,
    branchElsewhere: (branch: string) => `Branch ${branch} is open in another worktree`,
    noBranch: (branch: string) => `Can’t find branch ${branch}`,
    opened: (title: string) => `Opened “${title}”`
  }
})

const fail = (reason: string): Outcome => ({ outcome: 'failed', reason })
const skip = (reason: string): Outcome => ({ outcome: 'skipped', reason })

async function openSession(schedule: Schedule, planned: number): Promise<Outcome> {
  const action = schedule.action
  if (action.kind !== 'new') return fail(pick(M).badAction)
  const workspace = useWorkspace.getState()
  const project = workspace.projects.find((p) => p.id === action.projectId)
  if (!project) return fail(pick(M).projectGone)
  const label = AGENT_SPECS[action.agent].label
  const vendor = usageVendor(action.agent)
  const quota = vendor ? quotaBlock(label, useSessionMeta.getState().usage[vendor], Date.now()) : null
  if (quota) return skip(quota)
  if (previousRunActive(workspace.sessions, schedule.id)) return skip(pick(M).previousActive)
  const [installed, info] = await Promise.all([window.tr.app.detectAgents(), window.tr.gitWorktrees.newSessionInfo(project.rootPath)])
  if (!installed[action.agent]) return fail(pick(M).notInstalled(label))
  if (!info.repo) return fail(pick(M).notRepo)
  const branch = freeBranch(runBranch(info.prefix, schedule.name, planned), new Set(info.branches.map((b) => b.name)))
  const created = planCreate(project.rootPath, info, { workdir: 'worktree', base: action.base, branch, prepare: info.includeCount > 0 || info.hasSetup })
  if (created.plan?.type === 'existing') return fail(pick(M).branchElsewhere(action.base))
  if (!created.plan || created.plan.type !== 'worktree') {
    if (created.problem === 'no-base') return fail(pick(M).noBranch(action.base))
    return fail((created.problem && created.problem !== 'loading' ? branchProblemText(created.problem, branch) : null) ?? pick(M).noWorktree)
  }
  const plan = created.plan
  const ui = uiRow(action.agent, action.ui, binaryInstalled(installed))?.value ?? 'cli'
  const title = runSessionTitle(schedule.name, planned)
  // The same steps 新建会话 takes (new-session/launch.ts), shared with 自动领取.
  const id = launchWorktreeSession({
    projectId: project.id,
    agent: action.agent,
    ui,
    path: plan.path,
    request: plan.request,
    title,
    prompt: schedule.prompt,
    ...(action.model ? { model: action.model } : {}),
    ...(action.permission ? { permission: action.permission } : {}),
    patch: { scheduledBy: { id: schedule.id, name: schedule.name, planned } }
  })
  if (!id) return fail(pick(M).noSession)
  return { outcome: 'opened', sessionId: id, reason: pick(M).opened(title) }
}

/** Waiting sends by task: a newer run of the same task replaces the one still waiting (T3 Code #26987). */
const waiting = new Map<string, { planned: number; cancel(): void }>()

function untilTurnEnds(sessionId: SessionId, planned: number, scheduleId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (sent: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      if (waiting.get(scheduleId)?.planned === planned) waiting.delete(scheduleId)
      resolve(sent)
    }
    const timer = setTimeout(() => settle(false), SEND_WAIT_MS)
    const unsubscribe = useWorkspace.subscribe((state) => {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session?.status !== 'running') settle(true)
    })
    waiting.set(scheduleId, { planned, cancel: () => settle(false) })
  })
}

async function sendMessage(fire: ScheduleFire): Promise<Outcome | null> {
  const { schedule, planned } = fire
  const action = schedule.action
  if (action.kind !== 'send') return fail(pick(M).badAction)
  const archivedOf = (): boolean => {
    const state = useWorkspace.getState()
    const session = state.sessions.find((s) => s.id === action.sessionId)
    return session !== undefined && state.worktrees.find((w) => w.id === session.worktreeId)?.archived !== undefined
  }
  const sessionOf = () => useWorkspace.getState().sessions.find((s) => s.id === action.sessionId)
  let step = sendStep(sessionOf(), archivedOf())
  if (step.type === 'wait') {
    const earlier = waiting.get(schedule.id)
    if (earlier) {
      earlier.cancel()
      report({ ...fire, planned: earlier.planned, caughtUp: false, manual: false }, skip(pick(M).notSentInTime))
    }
    report(fire, { outcome: 'running', reason: pick(M).waitTurn })
    if (!(await untilTurnEnds(action.sessionId, planned, schedule.id))) return waiting.has(schedule.id) ? null : skip(pick(M).turnNeverEnded)
    step = sendStep(sessionOf(), archivedOf())
  }
  if (step.type === 'skip') return skip(step.reason)
  if (step.type === 'fail') return fail(step.reason)
  if (step.type === 'wait') return skip(pick(M).runningAgain)
  const session = sessionOf()
  if (session && (session.phase === 'not-started' || session.phase === 'starting')) {
    startEagerly(session.id)
    await whenAgentReady(session.id)
  }
  try {
    await submitPrompt(action.sessionId, schedule.prompt)
    return { outcome: 'sent', sessionId: action.sessionId }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

async function run(fire: ScheduleFire): Promise<void> {
  let outcome: Outcome | null
  try {
    outcome = fire.schedule.action.kind === 'new' ? await openSession(fire.schedule, fire.planned) : await sendMessage(fire)
  } catch (error) {
    outcome = fail(error instanceof Error ? error.message : String(error))
  }
  if (outcome) report(fire, outcome)
}

// ── 自动归档 ──────────────────────────────────────────────────────────────────

const TURN_ENDED: ReadonlySet<SessionStatus> = new Set(['done_unread', 'idle'])

async function archiveIfUnchanged(sessionId: SessionId, schedule: Schedule): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  const target = session && archiveTargetFor(session.worktreeId)
  if (!session?.scheduledBy || !target || target.isMain || blockerFor(target)) return
  const listing = await window.tr.gitWorktrees.list(target.root, [target.worktreePath]).catch(() => null)
  const real = listing?.realPaths[target.worktreePath]
  const info = listing?.worktrees.find((w) => w.realPath === real || w.path === target.worktreePath)
  if (!unchanged(info && info.detailed ? info : undefined)) return
  const result = await archiveWorktree(target, { unattended: true })
  if (!result.ok) return
  const last = schedule.runs.find((r) => r.sessionId === sessionId)
  if (last) report({ schedule, planned: last.planned, caughtUp: last.caughtUp === true, manual: last.manual === true }, { outcome: 'archived', sessionId })
}

/** Archives a run's worktree once its first turn ends with nothing changed, when its task says 自动归档. */
function watchAutoArchive(): () => void {
  const seen = new Map<SessionId, SessionStatus>()
  const checked = new Set<SessionId>()
  return useWorkspace.subscribe((state) => {
    for (const session of state.sessions) {
      const by = session.scheduledBy
      if (!by || checked.has(session.id)) continue
      const before = seen.get(session.id)
      seen.set(session.id, session.status)
      if (before !== 'running' || !TURN_ENDED.has(session.status)) continue
      checked.add(session.id)
      const schedule = useSchedules.getState().schedules.find((s) => s.id === by.id)
      if (schedule?.action.kind === 'new' && schedule.action.autoArchive) void archiveIfUnchanged(session.id, schedule)
    }
  })
}

/** Mounted once the workspace is loaded: from then on main hands this window what comes due. */
export function startScheduleRunner(): () => void {
  followSchedules()
  void window.tr.settings.get().then((s) => setAgentSchedulesAllowed(s.schedules.agents))
  const offSettings = window.tr.settings.onChange((s) => setAgentSchedulesAllowed(s.schedules.agents))
  const offFire = window.tr.schedules.onFire((fire) => void run(fire))
  const offArchive = watchAutoArchive()
  window.tr.schedules.ready()
  return () => {
    offSettings()
    offFire()
    offArchive()
  }
}

