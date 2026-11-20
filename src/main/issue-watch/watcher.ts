// 自动领取's clock in main (PRD F26): main owns `<userData>/issue-watch.json`, checks every enabled project on the
// interval, claims what claimDecision allows (record first, then the assign and 👀), and hands a claimed issue to the
// window once its page is ready. The window opens the session and reports each step; the acceptance command runs here
// (the login shell, the project's worktree) and its result moves the record. No Electron imports: the poll, the queue,
// the day's cap and the acceptance are unit-tested against a fake gh and a temp repository.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ACCEPT_TIMEOUT_MS,
  MAX_ISSUES,
  afterAcceptance,
  byCreatedAt,
  claimBudget,
  claimDecision,
  fixPrompt,
  issueKey,
  issueReason,
  needsLabelActor,
  runningIssues,
  parseAcceptRequest,
  parseFile,
  parseProjectDraft,
  parseReport,
  parseSettings,
  savedProject,
  tailOutput,
  transition,
  type DiscoveredIssue,
  type IssueAcceptance,
  type IssueRecord,
  type IssueWatchAcceptResult,
  type IssueWatchFileData,
  type IssueWatchFire,
  type IssueWatchProjectSettings,
  type IssueWatchReport,
  type IssueWatchScan,
  type IssueWatchSettings,
  type IssueWatchState
} from '@shared/issue-watch'
import { defineMessages, pick } from '@shared/i18n'
import { repoArg, type GitHubRepo } from '@shared/pull-requests'
import type { ProjectScan } from './github'

const M = defineMessages({
  zh: {
    invalid: '请求无效',
    notClaimed: '这个 issue 不在自动领取的记录里',
    notWorking: '这个 issue 现在不在能验收的状态',
    alreadyAccepting: '验收已经在跑',
    projectGone: '项目不在了',
    worktreeGone: 'worktree 不在了',
    acceptCrashed: (why: string) => `验收命令没能运行：${why}`
  },
  en: {
    invalid: 'Invalid request',
    notClaimed: "This issue isn't in the auto-claim records",
    notWorking: "This issue can't be checked right now",
    alreadyAccepting: 'The acceptance is already running',
    projectGone: 'The project is gone',
    worktreeGone: 'The worktree is gone',
    acceptCrashed: (why: string) => `The acceptance command could not run: ${why}`
  }
})

/** What the acceptance command came back with (src/main/script-run.ts's CapturedRun, structurally). */
export interface AcceptanceRun {
  /** null when it was stopped or never started. */
  code: number | null
  output: string
  cancelled: boolean
}

/** How an acceptance command is started and stopped (src/main/script-run.ts in the app). */
export interface AcceptanceRunner {
  start(key: string, cwd: string, script: string): Promise<AcceptanceRun>
  cancel(key: string): void
}

/**
 * Runs the acceptance command and stops it at `timeoutMs`: it then resolves `cancelled: true` (a failed acceptance).
 * The command is its own process group (script-run), so cancelling takes everything it started with it.
 */
export async function runAcceptanceCommand(runner: AcceptanceRunner, key: string, cwd: string, script: string, timeoutMs: number): Promise<AcceptanceRun> {
  const timer = setTimeout(() => runner.cancel(key), timeoutMs)
  try {
    return await runner.start(key, cwd, script)
  } finally {
    clearTimeout(timer)
  }
}

export interface IssueWatchDeps {
  now(): number
  /** The project's root folder (the workspace's), or undefined when the project is gone. */
  rootOf(projectId: string): string | undefined
  /** Whether the session's worktree belongs to the project (workspace folders, their worktrees). */
  workspaceOk(projectId: string, root: string, worktree: string): boolean
  listIssues(root: string): Promise<ProjectScan>
  viewer(): Promise<string | null>
  canWrite(repo: GitHubRepo, login: string): Promise<boolean>
  /** When a member applied the label; null when no member did (or it could not be read). */
  labelAt(repo: GitHubRepo, number: number, label: string): Promise<number | null>
  /** Assign + 👀; a note when one failed, null when both worked. */
  claim(repo: GitHubRepo, number: number): Promise<string | null>
  /** Runs the acceptance command in `cwd`, stopped at `timeoutMs` (its promise resolves with cancelled: true then). */
  runAcceptance(key: string, cwd: string, script: string, timeoutMs: number): Promise<AcceptanceRun>
  /** The acceptance command's time (ACCEPT_TIMEOUT_MS unless a test says otherwise). */
  acceptTimeoutMs?(): number
  /** Hands a claimed issue to the window; false when no window can take it yet (tried again when one is ready). */
  fire(fire: IssueWatchFire): boolean
  changed(state: IssueWatchState): void
}

/** `<userData>/issue-watch.json`: main is its only writer, written whole through a temp file (as schedules.json). */
export class IssueWatchFile {
  constructor(private readonly path: string) {}

  /** A missing file is an empty state; one that cannot be read or parsed is moved aside before anything overwrites it. */
  load(): IssueWatchFileData {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[issue-watch] could not read issue-watch.json', error)
      return { settings: parseSettings(null), projects: [], issues: [] }
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const aside = `${this.path}.bad-${Date.now()}`
      console.error('[issue-watch] issue-watch.json is not JSON; moved to', aside, error)
      try {
        renameSync(this.path, aside)
      } catch (renameError) {
        console.error('[issue-watch] could not move issue-watch.json aside', renameError)
      }
      return { settings: parseSettings(null), projects: [], issues: [] }
    }
    return parseFile(value)
  }

  save(data: IssueWatchFileData): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, settings: data.settings, projects: data.projects, issues: data.issues }, null, 1))
      renameSync(tmp, this.path)
    } catch (error) {
      console.error('[issue-watch] could not save issue-watch.json', error)
    }
  }
}

export class IssueWatcher {
  private data: IssueWatchFileData
  private readonly scans = new Map<string, IssueWatchScan>()
  /** Issues an open session already works on (the window's sessions with `session.github`). */
  private linked = new Set<string>()
  /** Last check per project, and the checks in flight. */
  private readonly checkedAt = new Map<string, number>()
  /** A project's check in flight: a second ask waits for the one running. */
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly accepting = new Set<string>()
  /** The page that said it can open sessions (its workspace is loaded); a reload has to say it again. */
  private pageReady = false
  /** Records already handed to this page: a claim made while another one is being handed over is not sent twice. */
  private readonly handed = new Set<string>()

  constructor(
    private readonly file: IssueWatchFile,
    private readonly deps: IssueWatchDeps
  ) {
    this.data = file.load()
  }

  state(): IssueWatchState {
    const scans: Record<string, IssueWatchScan> = {}
    for (const [projectId, scan] of this.scans) scans[projectId] = scan
    return {
      settings: this.data.settings,
      projects: [...this.data.projects],
      scans,
      // Newest claim first, as the list shows them.
      issues: [...this.data.issues].sort((a, b) => b.claimedAt - a.claimedAt)
    }
  }

  get(key: string): IssueRecord | undefined {
    return this.data.issues.find((r) => r.key === key)
  }

  project(projectId: string): IssueWatchProjectSettings | undefined {
    return this.data.projects.find((p) => p.projectId === projectId)
  }

  /** The settings row's save; turning the switch on starts the guard and checks the project at once. */
  saveProject(projectId: unknown, draft: unknown): IssueWatchState | null {
    const parsed = parseProjectDraft(draft)
    if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 100 || !parsed) return null
    const current = this.project(projectId)
    const next = savedProject(current, projectId, parsed, this.deps.now())
    this.commit({ ...this.data, projects: current ? this.data.projects.map((p) => (p.projectId === projectId ? next : p)) : [...this.data.projects, next] })
    if (next.enabled) {
      this.checkedAt.delete(projectId)
      void this.poll(projectId)
    }
    return this.state()
  }

  saveSettings(raw: unknown): IssueWatchState {
    const settings: IssueWatchSettings = parseSettings(raw)
    this.commit({ ...this.data, settings })
    return this.state()
  }

  /** 立即检查: the next poll of that project does not wait for the interval. */
  checkNow(projectId: unknown): void {
    if (typeof projectId !== 'string') return
    this.checkedAt.delete(projectId)
    void this.poll(projectId)
  }

  /** The window's sessions that already work on an issue (`session.github`). */
  setLinked(raw: unknown): void {
    if (!Array.isArray(raw)) return
    this.linked = new Set(raw.filter((k): k is string => typeof k === 'string' && k.length <= 400))
  }

  windowReady(): void {
    this.pageReady = true
    this.fireQueued()
  }

  windowGone(): void {
    this.pageReady = false
    // What was handed to that page never opened its session; the next ready page is offered it again.
    this.handed.clear()
  }

  /** Every enabled project whose interval has passed is checked; a claim with no window waits for one. */
  async tick(): Promise<void> {
    this.fireQueued()
    for (const project of this.data.projects) {
      if (!project.enabled) continue
      const last = this.checkedAt.get(project.projectId) ?? 0
      if (this.deps.now() - last < this.data.settings.intervalMinutes * 60_000) continue
      void this.poll(project.projectId)
    }
  }

  /** One check of a project: its open issues, then what may be claimed of them (oldest first, within the bounds). */
  async poll(projectId: string): Promise<void> {
    const running = this.inFlight.get(projectId)
    if (running) return running
    const run = this.pollNow(projectId)
    this.inFlight.set(projectId, run)
    try {
      await run
    } finally {
      if (this.inFlight.get(projectId) === run) this.inFlight.delete(projectId)
    }
  }

  private async pollNow(projectId: string): Promise<void> {
    const project = this.project(projectId)
    if (!project?.enabled) return
    const root = this.deps.rootOf(projectId)
    if (!root) {
      this.setScan(projectId, { state: 'error', message: pick(M).projectGone })
      return
    }
    this.checkedAt.set(projectId, this.deps.now())
    try {
      const scan = await this.deps.listIssues(root)
      this.setScan(projectId, scan.state === 'ok' ? { state: 'ok', repo: scan.repo, checkedAt: this.deps.now() } : scan)
      if (scan.state !== 'ok') return
      await this.consider(project, scan.repo, scan.issues)
    } catch (error) {
      console.error('[issue-watch] checking', projectId, 'failed', error)
      this.setScan(projectId, { state: 'error', message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) })
    }
  }

  private async consider(project: IssueWatchProjectSettings, repo: GitHubRepo, issues: readonly DiscoveredIssue[]): Promise<void> {
    const viewer = await this.deps.viewer()
    const enabledAt = project.enabledAt
    if (enabledAt === null) return
    for (const issue of [...issues].sort(byCreatedAt)) {
      if (claimBudget(this.data.issues, this.data.settings, project.projectId, this.deps.now()) <= 0) return
      const key = issueKey(repoArg(repo), issue.number)
      // The cheap answers first: what is already handled or worked on needs no gh call.
      if (this.data.issues.some((r) => r.key === key) || this.linked.has(key)) continue
      const mine = viewer !== null && issue.assignees.some((a) => a.toLowerCase() === viewer)
      if (issue.assignees.length > 0 && !mine) continue
      // Older than the switch and without the label: nothing can make it new enough (no gh call needed).
      if (issue.createdAt <= enabledAt && !issue.labels.includes(project.label)) continue
      const authorCanWrite = await this.deps.canWrite(repo, issue.author)
      const labelAt = needsLabelActor(issue, project, authorCanWrite) ? await this.deps.labelAt(repo, issue.number, project.label) : null
      const decision = claimDecision({
        issue,
        settings: project,
        handled: false,
        linked: this.linked.has(key),
        viewer,
        authorCanWrite,
        labelAt
      })
      if (!decision.claim) continue
      await this.claim(project, repo, issue, authorCanWrite)
    }
  }

  /** 领取: the record first (so nothing is claimed twice), then the assign and 👀; a failure is a note, not a stop. */
  private async claim(project: IssueWatchProjectSettings, repo: GitHubRepo, issue: DiscoveredIssue, authorCanWrite: boolean): Promise<void> {
    const now = this.deps.now()
    const key = issueKey(repoArg(repo), issue.number)
    const record: IssueRecord = {
      key,
      projectId: project.projectId,
      repo: repoArg(repo),
      number: issue.number,
      title: issue.title,
      url: issue.url,
      author: issue.author,
      createdAt: issue.createdAt,
      claimedAt: now,
      state: 'queued',
      rounds: 0,
      authorCanWrite
    }
    this.commit({ ...this.data, issues: [record, ...this.data.issues].slice(0, MAX_ISSUES) })
    let note: string | null = null
    try {
      note = await this.deps.claim(repo, issue.number)
    } catch (error) {
      note = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)
    }
    if (note) this.commit({ ...this.data, issues: this.data.issues.map((r) => (r.key === key ? { ...r, note } : r)) })
    this.fireQueued()
  }

  /**
   * 排队 records go to the window while the project has room (每个项目同时处理), oldest created first. Records already
   * handed to the page count as running until the window reports their session opened.
   */
  private fireQueued(): void {
    if (!this.pageReady) return
    const queued = this.data.issues
      .filter((r) => r.state === 'queued' && !this.handed.has(r.key))
      .sort((a, b) => a.createdAt - b.createdAt || a.number - b.number)
    for (const record of queued) {
      const project = this.project(record.projectId)
      if (!project?.enabled) continue
      if (this.runningFor(record.projectId) >= this.data.settings.concurrent) continue
      if (this.deps.fire({ record, project })) this.handed.add(record.key)
    }
  }

  /** The project's issues a session works on: 处理中 / 验收中 / 修复中, plus what was handed over and not yet opened. */
  private runningFor(projectId: string): number {
    const handed = [...this.handed].filter((key) => this.get(key)?.state === 'queued').length
    return runningIssues(this.data.issues, projectId).length + handed
  }

  /** The window's report of a step: the record moves (a move that does not fit is ignored, not forced). */
  report(raw: unknown): IssueWatchState {
    const report = parseReport(raw)
    if (report) {
      this.apply(report)
      // A report that takes the issue out of 处理中 / 验收中 / 修复中 makes room for the next 排队 one.
      this.fireQueued()
    }
    return this.state()
  }

  private apply(report: IssueWatchReport): void {
    const record = this.get(report.key)
    if (!record) return
    switch (report.type) {
      case 'opened': {
        this.handed.delete(record.key)
        this.move(record, 'working', { sessionId: report.sessionId })
        return
      }
      case 'awaiting': {
        this.move(record, 'awaiting', { reason: issueReason(report.because) })
        return
      }
      case 'fix-done': {
        // The acceptance that follows moves it to 验收中; until it runs the issue is still 修复中.
        return
      }
      case 'merged': {
        this.move(record, 'merged')
        return
      }
      case 'dropped': {
        this.move(record, 'dropped', report.reason !== undefined ? { reason: report.reason } : {})
        return
      }
      case 'note': {
        this.replace(report.key, { note: report.note })
        return
      }
    }
  }

  /**
   * 验收: the command in the session's worktree. Moves the record to 验收中 and, by the result, to 修复中 (a round is left)
   * or 待批准; a timed-out command is a failed one. The window sends the returned prompt back to the agent.
   */
  async accept(raw: unknown): Promise<IssueWatchAcceptResult> {
    const request = parseAcceptRequest(raw)
    if (!request) return { ok: false, message: pick(M).invalid }
    const record = this.get(request.key)
    if (!record) return { ok: false, message: pick(M).notClaimed }
    const project = this.project(record.projectId)
    if (!project) return { ok: false, message: pick(M).projectGone }
    if (this.accepting.has(record.key)) return { ok: false, message: pick(M).alreadyAccepting }
    if (record.state !== 'working' && record.state !== 'fixing') return { ok: false, message: pick(M).notWorking }
    const command = project.accept?.trim()
    if (!command) return { ok: true, next: 'none' }
    if (this.deps.rootOf(record.projectId) !== request.root || !this.deps.workspaceOk(record.projectId, request.root, request.worktree)) {
      return { ok: false, message: pick(M).worktreeGone }
    }
    const running = transition(record, 'accepting')
    if (!running) return { ok: false, message: pick(M).notWorking }
    this.replace(record.key, { state: running.state })
    this.accepting.add(record.key)
    let run: AcceptanceRun
    try {
      run = await this.deps.runAcceptance(record.key, request.worktree, command, this.deps.acceptTimeoutMs?.() ?? ACCEPT_TIMEOUT_MS)
    } catch (error) {
      this.replace(record.key, { state: record.state })
      return { ok: false, message: pick(M).acceptCrashed(error instanceof Error ? error.message : String(error)) }
    } finally {
      this.accepting.delete(record.key)
    }
    const timedOut = run.cancelled || run.code === null
    const passed = !timedOut && run.code === 0
    const acceptance: IssueAcceptance = {
      passed,
      command,
      at: this.deps.now(),
      rounds: record.rounds,
      ...(passed ? {} : { output: tailOutput(run.output), ...(timedOut ? { timedOut: true } : {}) })
    }
    const current = this.get(record.key) ?? record
    const move = afterAcceptance(current, acceptance)
    this.move(current, move.to, move.patch)
    if (move.to === 'awaiting') this.fireQueued()
    return move.to === 'fixing'
      ? { ok: true, next: 'fix', acceptance, prompt: fixPrompt(record, command, run.output) }
      : { ok: true, next: 'awaiting', acceptance }
  }

  /** A state move that does not fit is dropped: a late report must not undo 已合并 / 已放弃. */
  private move(record: IssueRecord, to: IssueRecord['state'], patch: Partial<IssueRecord> = {}): void {
    const next = transition(record, to, patch)
    if (next) this.replace(record.key, next)
  }

  /** One record replaced (a patch merged in), written and announced once. */
  private replace(key: string, patch: Partial<IssueRecord>): void {
    const current = this.get(key)
    if (!current) return
    this.commit({ ...this.data, issues: this.data.issues.map((r) => (r.key === key ? { ...r, ...patch } : r)) })
  }

  private setScan(projectId: string, scan: IssueWatchScan): void {
    this.scans.set(projectId, scan)
    this.deps.changed(this.state())
  }

  private commit(data: IssueWatchFileData): void {
    this.data = data
    this.file.save(data)
    this.deps.changed(this.state())
  }
}
