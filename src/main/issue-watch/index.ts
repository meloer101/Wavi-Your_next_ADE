// 自动领取 GitHub issue's IPC and clock (PRD F26): the IssueWatcher (./watcher.ts) owns `<userData>/issue-watch.json`;
// this file polls it every few seconds (the watcher keeps each project's interval), hands a claimed issue to the window
// once its page said it is ready, and runs the project's acceptance command in the session's worktree through the same
// login shell as 定时任务's 前置检查 (src/main/script-run.ts), stopped after ACCEPT_TIMEOUT_MS.
import { join } from 'node:path'
import type { IssueRecord } from '@shared/issue-watch'
import { git, gitOut } from '../git/run'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { ISSUE_WATCH_IPC, type IssueWatchAcceptResult, type IssueWatchFire, type IssueWatchState } from '@shared/issue-watch'
import { cancelCapturedScript, startCapturedScript } from '../script-run'
import { getMainWindow } from '../windows'
import { isAppWindow } from '../app-windows'
import { isProjectRoot, isWorkspaceDir, projectRootOf } from '../workspace-store'
import { githubCalls } from './github'
import { IssueWatchFile, IssueWatcher, runAcceptanceCommand, type AcceptanceRun, type IssueWatchDeps } from './watcher'

/** How often the watcher is asked to look; each project is checked on its own interval (设置's 检查间隔). */
const TICK_MS = 15_000

/** The page that said it can open sessions (its workspace is loaded); a reload has to say it again. */
let readyPage: WebContents | null = null

let watcher: IssueWatcher | null = null

const acceptKey = (key: string): string => `issue-accept:${key}`

/**
 * Whether the record's branch is already in its base: its HEAD is an ancestor of the base, or the base has a commit that
 * closes the issue (a squash merged elsewhere, then pushed by hand). Used before a 待批准 issue seen closed is abandoned.
 */
async function alreadyMerged(record: IssueRecord): Promise<boolean> {
  const worktree = record.worktree
  if (!worktree) return false
  const head = (await gitOut(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim()
  if (!head) return false
  const branch = (await gitOut(worktree, ['symbolic-ref', '--short', 'HEAD'])).trim()
  const configured = branch ? (await gitOut(worktree, ['config', `branch.${branch}.base`])).trim() : ''
  const base = configured || 'main'
  if ((await git(worktree, ['merge-base', '--is-ancestor', head, `refs/heads/${base}`])).code === 0) return true
  const closing = await gitOut(worktree, ['log', '-n', '200', '--format=%H', `refs/heads/${base}`, '--grep', `Closes #${record.number}`])
  return closing.trim() !== ''
}

/** The acceptance command in `cwd`; at `timeoutMs` it is stopped and comes back cancelled (a failed acceptance). */
function runAcceptance(key: string, cwd: string, script: string, timeoutMs: number): Promise<AcceptanceRun> {
  const job = acceptKey(key)
  return runAcceptanceCommand(
    {
      start: (_, dir, command) => startCapturedScript({ key: job, cwd: dir, script: command, baseEnv: process.env }),
      cancel: () => cancelCapturedScript(job)
    },
    job,
    cwd,
    script,
    timeoutMs
  )
}

/** Every window: the settings dialog may be open in a secondary one, and the report block is wherever a session is. */
function publish(state: IssueWatchState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(ISSUE_WATCH_IPC.changed, state)
  }
}

function fire(payload: IssueWatchFire): boolean {
  const page = readyPage
  if (!page || page.isDestroyed()) return false
  page.send(ISSUE_WATCH_IPC.fire, payload)
  return true
}

const isMainPage = (event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => event.sender === getMainWindow()?.webContents
/** The settings dialog is drawn by every app window's page (a secondary window too), so a save may come from any of them. */
const isAppPage = (event: IpcMainInvokeEvent): boolean => {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window !== null && isAppWindow(window)
}

/** The watcher main runs, for anything else that needs the records (`wavi` tools may later). */
export function issueWatcher(): IssueWatcher | null {
  return watcher
}

export function registerIssueWatchHandlers(): void {
  const deps: IssueWatchDeps = {
    now: () => Date.now(),
    rootOf: (projectId) => projectRootOf(projectId),
    workspaceOk: (projectId, root, worktree) => isProjectRoot(root) && projectRootOf(projectId) === root && isWorkspaceDir(worktree),
    listIssues: githubCalls.listIssues,
    viewer: githubCalls.viewerLogin,
    canWrite: githubCalls.canWrite,
    labelAt: githubCalls.labelActorAt,
    claim: githubCalls.claimIssue,
    issueOpen: githubCalls.issueOpen,
    alreadyMerged,
    runAcceptance,
    fire,
    changed: publish
  }
  const current = new IssueWatcher(new IssueWatchFile(join(app.getPath('userData'), 'issue-watch.json')), deps)
  watcher = current

  const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isAppPage(event)) throw new Error('not an app window')
      return action(...args)
    })
  }
  handle(ISSUE_WATCH_IPC.get, (): IssueWatchState => current.state())
  handle(ISSUE_WATCH_IPC.saveProject, (projectId, draft) => current.saveProject(projectId, draft))
  handle(ISSUE_WATCH_IPC.saveSettings, (raw) => current.saveSettings(raw))
  handle(ISSUE_WATCH_IPC.checkNow, (projectId) => current.checkNow(projectId))
  handle(ISSUE_WATCH_IPC.report, (raw) => current.report(raw))
  handle(ISSUE_WATCH_IPC.accept, (raw): Promise<IssueWatchAcceptResult> => current.accept(raw))
  ipcMain.on(ISSUE_WATCH_IPC.linked, (event, keys: unknown) => {
    if (isMainPage(event)) current.setLinked(keys)
  })
  ipcMain.on(ISSUE_WATCH_IPC.ready, (event) => {
    if (!isMainPage(event)) return
    readyPage = event.sender
    event.sender.once('destroyed', () => {
      if (readyPage === event.sender) readyPage = null
      current.windowGone()
    })
    event.sender.once('did-start-navigation', () => {
      if (readyPage === event.sender) readyPage = null
      current.windowGone()
    })
    current.windowReady()
    // A page that just loaded checks at once (each project still waits for its own interval after that).
    void current.tick()
  })

  const timer = setInterval(() => void current.tick(), TICK_MS)
  app.on('before-quit', () => clearInterval(timer))
  // The first check runs when a page says it is ready: nothing is claimed before a window can open its session.
}
