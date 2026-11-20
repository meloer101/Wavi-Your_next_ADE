// Runs main's 自动领取 claims (PRD F26). Main claims an issue and hands it over; this opens the session as 新建会话 does
// (new worktree, the issue's task text as its first message, `session.github`), waits for the turn to end, runs the
// project's acceptance command where it has one, sends a failed acceptance back at most twice, and reports 待批准 (with a
// notification). Records are followed from main, so after a reload or a restart a session that is still working, or whose
// turn ended while the window was away, is picked up again; a record whose session is gone is reported 已放弃.
import { AGENT_SPECS } from '@shared/agents'
import { itemTitle, taskPrompt } from '@shared/github-board'
import { cappedPermission, issueBranch, issueNotice, type IssueRecord, type IssueWatchFire, type IssueWatchProjectSettings } from '@shared/issue-watch'
import { defineMessages, pick } from '@shared/i18n'
import type { Session, Worktree } from '@shared/types'
import { launchWorktreeSession } from '../new-session/launch'
import { binaryInstalled, branchProblemText, planCreate, uiRow } from '../new-session/model'
import { unchanged } from '../schedules/model'
import { submitPrompt } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { issueLink, reconcileStep, sessionOf } from './model'
import { followIssueWatch, useIssueWatch } from './store'

const M = defineMessages({
  zh: {
    projectGone: '项目不在了',
    notInstalled: (agent: string) => `没有安装 ${agent}`,
    notRepo: '项目不是 git 仓库',
    noBase: '找不到项目的基线分支',
    noWorktree: '没能建 worktree',
    noSession: '没能新建会话',
    sessionGone: '会话已经关闭',
    archived: '会话所在 worktree 已归档',
    notifyTitle: (n: number) => `自动领取 #${n}`,
    failedAccept: (message: string) => `验收没能运行：${message}`
  },
  en: {
    projectGone: 'The project is gone',
    notInstalled: (agent: string) => `${agent} isn’t installed`,
    notRepo: 'The project isn’t a Git repository',
    noBase: 'The project has no base branch to start from',
    noWorktree: 'Couldn’t create the worktree',
    noSession: 'Couldn’t create the session',
    sessionGone: 'Its session was closed',
    archived: 'Its worktree was archived',
    notifyTitle: (n: number) => `Auto-claimed #${n}`,
    failedAccept: (message: string) => `The acceptance couldn’t run: ${message}`
  }
})

/** Fires and turn ends being handled, so a change in the workspace does not start the same one twice. */
const inFlight = new Set<string>()

const report = (payload: Parameters<typeof window.tr.issueWatch.report>[0]): Promise<unknown> =>
  window.tr.issueWatch.report(payload).catch((error: unknown) => {
    console.error('[issue-watch] report', error)
  })

/** The notification when a session reaches 待批准 (PRD F26 / F10's path). */
function notify(record: IssueRecord, acceptance?: IssueRecord['acceptance']): void {
  const shown = acceptance ? { ...record, acceptance } : record
  window.tr.ui.notify({ title: pick(M).notifyTitle(record.number), body: issueNotice(shown), tag: `issue-watch:${record.key}` })
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The default branch a new worktree starts from (the same choice 新建会话 makes). */
function baseOf(branches: readonly { name: string }[], defaultBranch: string | null, currentBranch: string | null): string | null {
  if (defaultBranch) return defaultBranch
  const named = branches.find((b) => b.name === 'main' || b.name === 'master')
  return named?.name ?? currentBranch
}

/** Opens the claimed issue's session: a new worktree, F9's task text as the first message, the issue linked to it. */
async function openIssueSession(fire: IssueWatchFire): Promise<void> {
  const { record, project } = fire
  if (inFlight.has(record.key)) return
  inFlight.add(record.key)
  const drop = (reason: string): Promise<unknown> => report({ key: record.key, type: 'dropped', reason })
  try {
    const workspace = useWorkspace.getState()
    const found = workspace.projects.find((p) => p.id === project.projectId)
    if (!found) return void (await drop(pick(M).projectGone))
    const root = found.rootPath
    const [installed, info, detail] = await Promise.all([
      window.tr.app.detectAgents(),
      window.tr.gitWorktrees.newSessionInfo(root),
      window.tr.githubBoard.detail({ root, kind: 'issue', number: record.number })
    ])
    // The task text comes from the issue itself: without it the session would have nothing to do.
    if (!detail.ok) return void (await drop(detail.message))
    if (!installed[project.agent]) return void (await drop(pick(M).notInstalled(AGENT_SPECS[project.agent].label)))
    if (!info.repo) return void (await drop(pick(M).notRepo))
    const base = baseOf(info.branches, info.defaultBranch, info.currentBranch)
    if (!base) return void (await drop(pick(M).noBase))
    const branch = issueBranch(info.prefix, record.number, record.title, new Set(info.branches.map((b) => b.name)))
    const created = planCreate(root, info, { workdir: 'worktree', base, branch, prepare: info.includeCount > 0 || info.hasSetup })
    if (!created.plan || created.plan.type !== 'worktree') {
      const problem = created.problem === 'no-base' ? pick(M).noBase : created.problem && created.problem !== 'loading' ? branchProblemText(created.problem, branch) : null
      return void (await drop(problem ?? pick(M).noWorktree))
    }
    const ui = uiRow(project.agent, project.ui, binaryInstalled(installed))?.value ?? 'cli'
    const permission = cappedPermission(project.mode, record.authorCanWrite ?? null, project.permission)
    const id = launchWorktreeSession({
      projectId: found.id,
      agent: project.agent,
      ui,
      path: created.plan.path,
      request: created.plan.request,
      title: itemTitle(detail.detail),
      prompt: taskPrompt(detail.detail),
      ...(project.model ? { model: project.model } : {}),
      ...(permission ? { permission } : {}),
      patch: { github: issueLink(record) }
    })
    if (!id) return void (await drop(pick(M).noSession))
    await report({ key: record.key, type: 'opened', sessionId: id })
  } catch (error) {
    console.error('[issue-watch] opening the session failed', error)
    await drop(errorText(error))
  } finally {
    inFlight.delete(record.key)
  }
}

/** The project's root (the workspace's copy of it), for the acceptance and the worktree listing. */
const rootOf = (projectId: string): string | undefined => useWorkspace.getState().projects.find((p) => p.id === projectId)?.rootPath

/** A turn ended: nothing changed, no acceptance command, or the acceptance (whose failure goes back to the agent). */
async function finishTurn(
  record: IssueRecord,
  session: Session,
  worktree: Worktree,
  project: IssueWatchProjectSettings | undefined
): Promise<void> {
  try {
    const root = rootOf(record.projectId)
    if (!root || !project?.enabled) return
    const listing = await window.tr.gitWorktrees.list(root, [worktree.path]).catch(() => null)
    const real = listing?.realPaths[worktree.path]
    const info = listing?.worktrees.find((w) => w.realPath === real || w.path === worktree.path)
    // 没有改动: nothing to check and nothing to approve.
    if (unchanged(info?.detailed ? info : undefined)) {
      await report({ key: record.key, type: 'awaiting', because: 'unchanged' })
      notify(record)
      return
    }
    if (!project.accept?.trim()) {
      await report({ key: record.key, type: 'awaiting', because: 'no-acceptance' })
      notify(record)
      return
    }
    const result = await window.tr.issueWatch.accept({ key: record.key, root, worktree: worktree.path })
    if (!result.ok) {
      await report({ key: record.key, type: 'note', note: pick(M).failedAccept(result.message) })
      await report({ key: record.key, type: 'awaiting', because: 'no-acceptance' })
      notify(record)
      return
    }
    if (result.next === 'none') {
      await report({ key: record.key, type: 'awaiting', because: 'no-acceptance' })
      notify(record)
      return
    }
    if (result.next === 'fix') {
      // The failed output goes back to the agent; the next turn ends here again (the record is 修复中).
      await submitPrompt(session.id, result.prompt)
      return
    }
    // 待批准: main stored the result; the notice says 已处理 or 验收失败 from it.
    notify(record, result.acceptance)
  } catch (error) {
    console.error('[issue-watch] finishing the turn failed', error)
    await report({ key: record.key, type: 'note', note: errorText(error).slice(0, 300) })
  } finally {
    inFlight.delete(record.key)
  }
}

/** Every active record: wait, drop it (its session is gone), or take the turn that ended (also after a reload). */
function reconcile(): void {
  const watch = useIssueWatch.getState().state
  if (!watch) return
  const { sessions, worktrees } = useWorkspace.getState()
  for (const record of watch.issues) {
    if (inFlight.has(record.key)) continue
    const { session, worktree } = sessionOf(sessions, worktrees, record)
    const step = reconcileStep(record, session, worktree?.archived !== undefined)
    if (step.type === 'drop') {
      void report({ key: record.key, type: 'dropped', reason: step.reason === 'archived' ? pick(M).archived : pick(M).sessionGone })
      continue
    }
    if (step.type !== 'run' || !session || !worktree) continue
    inFlight.add(record.key)
    void finishTurn(record, session, worktree, watch.projects.find((p) => p.projectId === record.projectId))
  }
}

/** The issues that already have sessions, so main claims none of them again. */
function reportLinked(): void {
  const keys = useWorkspace.getState().sessions.flatMap((s) => (s.github?.kind === 'issue' ? [`${s.github.repo.toLowerCase()}#${s.github.number}`] : []))
  window.tr.issueWatch.linked(keys)
}

/** Mounted once the workspace is loaded: from then on main hands this window what it claimed. */
export function startIssueWatchRunner(): () => void {
  followIssueWatch()
  const offFire = window.tr.issueWatch.onFire((fire) => void openIssueSession(fire))
  const offWorkspace = useWorkspace.subscribe(reconcile)
  const offLinked = useWorkspace.subscribe(reportLinked)
  const offState = useIssueWatch.subscribe(reconcile)
  reportLinked()
  // A reload says it again: main then hands over what it claimed while no page could take it.
  window.tr.issueWatch.ready()
  reconcile()
  return () => {
    offFire()
    offWorkspace()
    offLinked()
    offState()
  }
}
