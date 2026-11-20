// The auto-claim watcher (PRD F26) against a fake `gh` (a shell script first on the PATH, answering from files and
// logging every call) and real git repositories in a temp folder. What is tested is main's loop: the two 领取范围 modes,
// who may add the label, the switch's enabledAt, one claim per issue, the queue and the day's cap, the claim's assign
// and 👀, the state machine through the window's reports, and the acceptance command (its pass / fail / timeout, the
// fix rounds, and the last 4 KB kept for the report and the fix prompt).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueWatchFire, IssueWatchProjectDraft, IssueWatchSettings, IssueWatchState } from '@shared/issue-watch'
import { MAX_ACCEPT_OUTPUT, issueKey } from '@shared/issue-watch'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-issue-watch-')))
const bin = join(base, 'bin')
const ghDir = join(base, 'gh')
mkdirSync(bin)
mkdirSync(ghDir)

// Each call is logged as one argument per line, in the order the calls were made.
writeFileSync(
  join(bin, 'gh'),
  `#!/bin/sh
d="$FAKE_GH_DIR"
printf '%s\\n' "$@" > "$d/call-$$"
case "$1 $2" in
  "auth status")
    if [ -f "$d/signed-out" ]; then echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1; fi
    echo "github.com"; echo "  ✓ Logged in to github.com account me (keyring)"; exit 0 ;;
  "api user") echo me; exit 0 ;;
  "issue list")
    if [ -f "$d/signed-out" ]; then echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1; fi
    cat "$d/issues.json" 2>/dev/null || echo '[]'; exit 0 ;;
  "issue view") if [ -f "$d/issue-closed" ]; then echo '{"state":"CLOSED"}'; else echo '{"state":"OPEN"}'; fi; exit 0 ;;
  "issue edit") if [ -f "$d/assign-fail" ]; then echo "could not assign" >&2; exit 1; fi; exit 0 ;;
esac
if [ "$1" = "api" ]; then
  case "$2" in
    repos/*/collaborators/*/permission)
      user=$(echo "$2" | sed 's#.*/collaborators/\\([^/]*\\)/permission#\\1#')
      if [ -f "$d/permission-$user.json" ]; then cat "$d/permission-$user.json"; else echo '{"permission":"read"}'; fi
      exit 0 ;;
    repos/*/issues/*/timeline)
      n=$(echo "$2" | sed 's#.*/issues/\\([0-9]*\\)/timeline#\\1#')
      if [ -f "$d/timeline-$n.json" ]; then cat "$d/timeline-$n.json"; else echo '[[]]'; fi
      exit 0 ;;
    -X) echo '{}'; exit 0 ;;
  esac
fi
echo "unknown command $*" >&2
exit 1
`
)
chmodSync(join(bin, 'gh'), 0o755)
process.env.FAKE_GH_DIR = ghDir

const roots = new Set<string>()
vi.mock('../workspace-store', () => ({
  isProjectRoot: (path: string) => roots.has(path),
  projectRootOf: (id: string) => [...roots].find((root) => root.endsWith(`-${id}`)),
  isWorkspaceDir: () => true
}))
vi.mock('../agents-installed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents-installed')>()),
  userLoginPath: async () => `${bin}:/usr/bin:/bin`
}))
vi.mock('electron', () => ({
  app: { on: () => {}, getPath: () => base },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null }
}))

const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
Object.assign(process.env, identity, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

// Imported after the mocks are in place: the graph reaches electron and the login-shell PATH.
const { startCapturedScript, cancelCapturedScript } = await import('../script-run')
const { IssueWatchFile, IssueWatcher, runAcceptanceCommand } = await import('./watcher')
type IssueWatchDeps = import('./watcher').IssueWatchDeps
const { canWrite, claimIssue, issueOpen, labelActorAt, listIssues, viewerLogin } = await import('./github')

/** A project's repository: a commit on `main`, a GitHub remote (its fetch URL names the repo; nothing reaches the network). */
function setupRepo(): { root: string; worktree: string; repo: string } {
  const n = roots.size + 1
  const root = join(base, `repo-${n}`)
  const bare = join(base, `bare-${n}.git`)
  mkdirSync(root)
  git(base, 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'init')
  const repo = `acme/widget-${n}`
  git(root, 'remote', 'add', 'origin', `https://github.com/${repo}.git`)
  git(root, 'config', 'remote.origin.pushurl', bare)
  git(root, 'config', 'protocol.https.allow', 'never')
  git(root, 'push', '-q', '-u', 'origin', 'main')
  const worktree = join(base, `wt-${n}`)
  git(root, 'worktree', 'add', '-q', '-b', `issue-1`, worktree)
  roots.add(root)
  return { root, worktree, repo }
}

const dirs: string[] = []
afterEach(() => {
  for (const name of readdirSync(ghDir)) rmSync(join(ghDir, name), { force: true })
})
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  rmSync(base, { recursive: true, force: true })
})

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()
/** The switch is turned on here; issues created (or labelled) later are the ones claimed. */
const enabledAt = at(10, 10)

function setup(options: { mode?: 'members' | 'all'; accept?: string; settings?: Partial<IssueWatchSettings>; windowUp?: boolean } = {}) {
  const { root, worktree, repo } = setupRepo()
  const dir = mkdtempSync(join(tmpdir(), 'wavi-issue-watch-'))
  dirs.push(dir)
  const clock = { now: enabledAt }
  const fires: IssueWatchFire[] = []
  const states: IssueWatchState[] = []
  let windowUp = options.windowUp ?? true
  const filePath = join(dir, 'issue-watch.json')
  const file = new IssueWatchFile(filePath)
  const deps: IssueWatchDeps = {
    now: () => clock.now,
    rootOf: (id) => (id === 'p1' ? root : undefined),
    workspaceOk: (id, r, w) => id === 'p1' && r === root && w === worktree,
    listIssues,
    viewer: viewerLogin,
    canWrite,
    labelAt: labelActorAt,
    claim: claimIssue,
    issueOpen,
    runAcceptance: (key, cwd, script, timeoutMs) =>
      runAcceptanceCommand(
        {
          start: (jobKey, dirName, command) => startCapturedScript({ key: jobKey, cwd: dirName, script: command, baseEnv: process.env }),
          cancel: (jobKey) => cancelCapturedScript(jobKey)
        },
        key,
        cwd,
        script,
        timeoutMs
      ),
    acceptTimeoutMs: () => 1500,
    fire: (fire) => {
      if (!windowUp) return false
      fires.push(fire)
      return true
    },
    changed: (state) => states.push(state)
  }
  const watcher = new IssueWatcher(file, deps)
  watcher.windowReady()
  if (options.settings) watcher.saveSettings(options.settings)
  const draft: IssueWatchProjectDraft = {
    enabled: true,
    mode: options.mode ?? 'members',
    label: 'wavi',
    agent: 'claude',
    ui: 'cli',
    ...(options.accept ? { accept: options.accept } : {})
  }
  return {
    root,
    worktree,
    repo,
    path: filePath,
    key: (n: number) => issueKey(`github.com/${repo}`, n),
    clock,
    fires,
    states,
    file,
    watcher,
    draft,
    setWindow: (up: boolean) => {
      windowUp = up
      if (up) watcher.windowReady()
      else watcher.windowGone()
    },
    /** Turns the watch on (the first save polls at once, so the caller need not tick). */
    async enable() {
      watcher.saveProject('p1', draft)
      await watcher.poll('p1')
      return watcher.state()
    }
  }
}

const iso = (t: number): string => new Date(t).toISOString()

/** An open issue as `gh issue list --json …` prints it. */
function issue(number: number, over: Partial<{ author: string; labels: string[]; assignees: string[]; createdAt: number }> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/widget/issues/${number}`,
    author: { login: over.author ?? 'alice' },
    labels: (over.labels ?? []).map((name) => ({ name })),
    assignees: (over.assignees ?? []).map((login) => ({ login })),
    createdAt: iso(over.createdAt ?? at(10, 12)),
    updatedAt: iso(over.createdAt ?? at(10, 12))
  }
}

const writeGh = (name: string, text: string): void => writeFileSync(join(ghDir, name), text)
const writeIssues = (...issues: ReturnType<typeof issue>[]): void => writeGh('issues.json', JSON.stringify(issues))
const writePermission = (login: string, permission: 'admin' | 'write' | 'maintain' | 'triage' | 'read'): void =>
  writeGh(`permission-${login}.json`, JSON.stringify({ permission }))
const writeTimeline = (number: number, events: { actor: string; label?: string; at?: number }[]): void =>
  writeGh(`timeline-${number}.json`, JSON.stringify([events.map((e) => ({ event: 'labeled', label: { name: e.label ?? 'wavi' }, actor: { login: e.actor }, created_at: iso(e.at ?? at(10, 20)) }))]))
const calls = (): string[][] =>
  readdirSync(ghDir)
    .filter((name) => name.startsWith('call-'))
    .map((name) => ({ name, at: statSync(join(ghDir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name }) => readFileSync(join(ghDir, name), 'utf8').replace(/\n$/, '').split('\n'))
const callsOf = (first: string, second: string): string[][] => calls().filter((call) => call[0] === first && call[1] === second)

beforeEach(async () => {
  for (const name of readdirSync(ghDir)) rmSync(join(ghDir, name), { force: true })
})

describe('领取范围', () => {
  it('members: claims an author with write permission and records it first', async () => {
    const t = setup()
    writePermission('alice', 'write')
    writeIssues(issue(1), issue(2))
    const state = await t.enable()
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2])
    expect(t.fires[0]?.record).toMatchObject({ state: 'queued', authorCanWrite: true, repo: `github.com/acme/widget-${t.repo.split('-')[1]}` })
    expect(state.issues.map((r) => r.key)).toEqual([t.key(2), t.key(1)])
    // The record is in the file before anything is claimed on GitHub.
    expect(new IssueWatchFile(t.path).load().issues).toHaveLength(2)

    // 领取: assigned to @me and 👀, exactly those two calls per issue.
    const edits = callsOf('issue', 'edit')
    expect(edits).toHaveLength(2)
    expect(edits[0]).toContain('1')
    expect(edits[0]).toContain('--add-assignee=@me')
    const reactions = callsOf('api', '-X')
    expect(reactions).toHaveLength(2)
    expect(reactions[0]).toContain('repos/acme/widget-1/issues/1/reactions')
    expect(reactions[0]).toContain('content=eyes')
  })

  it('members: an outsider’s issue waits for a member’s label', async () => {
    const t = setup()
    writePermission('bob', 'read')
    writePermission('carol', 'write')
    writeIssues(issue(1, { author: 'bob', labels: ['wavi'] }), issue(2, { author: 'bob', labels: ['wavi'] }))
    // #1: the template added the label for a read-only author; #2: carol (write) added it after the switch.
    writeTimeline(1, [{ actor: 'bob', at: at(10, 12) }])
    writeTimeline(2, [{ actor: 'carol', at: at(10, 15) }])
    await t.enable()
    expect(t.fires.map((f) => f.record.number)).toEqual([2])
  })

  it('members: a label added by a read-only user does not count, one by a member does', async () => {
    const t = setup()
    writePermission('bob', 'read')
    writePermission('dave', 'triage')
    writePermission('carol', 'maintain')
    writeIssues(issue(1, { author: 'bob', labels: ['wavi'] }), issue(2, { author: 'bob', labels: ['wavi'] }))
    writeTimeline(1, [{ actor: 'dave', at: at(10, 12) }])
    writeTimeline(2, [{ actor: 'carol', at: at(10, 12) }])
    await t.enable()
    expect(t.fires.map((f) => f.record.number)).toEqual([2])
    // The read-only actor's permission was asked, and refused.
    expect(calls().some((call) => (call[1] ?? '').includes('collaborators/dave/permission'))).toBe(true)
  })

  it('all: claims anyone’s issue, also when the author cannot write', async () => {
    const t = setup({ mode: 'all' })
    writePermission('bob', 'read')
    writeIssues(issue(1, { author: 'bob' }))
    await t.enable()
    expect(t.fires).toHaveLength(1)
    expect(t.fires[0]?.record).toMatchObject({ state: 'queued', authorCanWrite: false })
  })

  it('does not claim issues from before the switch, or ones assigned to someone else', async () => {
    const t = setup()
    writePermission('alice', 'write')
    writeIssues(issue(1, { createdAt: at(10, 8) }), issue(2, { assignees: ['someone'] }))
    await t.enable()
    expect(t.fires).toHaveLength(0)
  })

  it('claims an issue once, also after the switch was turned off and on again', async () => {
    const t = setup()
    writePermission('alice', 'write')
    writeIssues(issue(1))
    await t.enable()
    expect(t.fires).toHaveLength(1)
    await t.watcher.poll('p1')
    expect(t.fires).toHaveLength(1)
    // Off, then on again: a fresh enabledAt, and still no second claim of #1.
    t.watcher.saveProject('p1', { ...t.draft, enabled: false })
    t.clock.now = at(11, 9)
    t.watcher.saveProject('p1', { ...t.draft, enabled: true })
    writeIssues(issue(1), issue(2, { createdAt: at(11, 10) }))
    await t.watcher.poll('p1')
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2])
    expect(t.watcher.state().issues.filter((r) => r.number === 1)).toHaveLength(1)
  })

  it('does not claim an issue an open session already works on', async () => {
    const t = setup()
    writePermission('alice', 'write')
    writeIssues(issue(1))
    t.watcher.setLinked([t.key(1)])
    await t.enable()
    expect(t.fires).toHaveLength(0)
  })

  it('claims an old issue once a member labelled it after the switch, in either mode', async () => {
    // 全部直接领, author without write, created before the switch, label added by a member after it.
    const all = setup({ mode: 'all' })
    writePermission('bob', 'read')
    writePermission('carol', 'write')
    writeIssues(issue(1, { author: 'bob', labels: ['wavi'], createdAt: at(10, 8) }))
    writeTimeline(1, [{ actor: 'carol', at: at(10, 20) }])
    await all.enable()
    expect(all.fires.map((f) => f.record.number)).toEqual([1])

    // members, the author has write too — the label a member added after the switch is what makes it new enough.
    const members = setup()
    writePermission('alice', 'write')
    writePermission('carol', 'maintain')
    writeIssues(issue(1, { author: 'alice', labels: ['wavi'], createdAt: at(10, 8) }))
    writeTimeline(1, [{ actor: 'carol', at: at(10, 20) }])
    await members.enable()
    expect(members.fires.map((f) => f.record.number)).toEqual([1])
  })

  it('does not claim an old issue whose label a read-only user added', async () => {
    const t = setup({ mode: 'all' })
    writePermission('bob', 'read')
    writeIssues(issue(1, { author: 'bob', labels: ['wavi'], createdAt: at(10, 8) }))
    writeTimeline(1, [{ actor: 'bob', at: at(10, 20) }])
    await t.enable()
    expect(t.fires).toHaveLength(0)
  })

  it('waits for a window before handing a claimed issue over', async () => {
    const t = setup({ windowUp: false })
    writePermission('alice', 'write')
    writeIssues(issue(1))
    await t.enable()
    expect(t.fires).toHaveLength(0)
    expect(t.watcher.state().issues[0]?.state).toBe('queued')
    t.setWindow(true)
    expect(t.fires.map((f) => f.record.number)).toEqual([1])
  })

  it('records what the claim could not do and handles the issue anyway', async () => {
    const t = setup()
    writePermission('alice', 'write')
    writeIssues(issue(1))
    writeGh('assign-fail', '')
    await t.enable()
    expect(t.fires).toHaveLength(1)
    expect(t.watcher.state().issues[0]?.note).toContain('指派失败')
  })

  it('says why a project cannot be checked, and claims nothing', async () => {
    const t = setup()
    writeGh('signed-out', '')
    await t.enable()
    expect(t.fires).toHaveLength(0)
    expect(t.watcher.state().scans.p1).toEqual({ state: 'error', message: 'gh 还没有登录：在终端运行 gh auth login' })
  })
})

describe('排队和每天上限', () => {
  it('claims every eligible issue at once and queues what the concurrency cannot start', async () => {
    const t = setup({ settings: { concurrent: 2, daily: 10 } })
    writePermission('alice', 'write')
    writeIssues(issue(1, { createdAt: at(10, 12) }), issue(2, { createdAt: at(10, 13) }), issue(3, { createdAt: at(10, 14) }))
    await t.enable()
    // All three are claimed (assigned + 👀); the third waits in 排队.
    expect(callsOf('issue', 'edit')).toHaveLength(3)
    expect(callsOf('api', '-X')).toHaveLength(3)
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2])
    expect(t.watcher.state().issues.find((r) => r.number === 3)?.state).toBe('queued')
    // #1 is done being processed: the queued third one starts.
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    t.watcher.report({ key: t.key(1), type: 'awaiting', because: 'unchanged' })
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2, 3])
    expect(t.watcher.state().issues.find((r) => r.number === 3)?.state).toBe('queued')
  })

  it('claims no more than the day allows, and the next day starts again', async () => {
    const t = setup({ settings: { concurrent: 2, daily: 1 } })
    writePermission('alice', 'write')
    writeIssues(issue(1), issue(2))
    await t.enable()
    expect(t.fires.map((f) => f.record.number)).toEqual([1])
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    t.watcher.report({ key: t.key(1), type: 'merged' })
    await t.watcher.poll('p1')
    expect(t.fires.map((f) => f.record.number)).toEqual([1])
    t.clock.now = at(11, 0)
    await t.watcher.poll('p1')
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2])
  })

  it('checks a project on its interval only', async () => {
    const t = setup({ settings: { intervalMinutes: 5 } })
    writePermission('alice', 'write')
    writeIssues(issue(1))
    await t.enable()
    expect(t.fires).toHaveLength(1)
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    t.watcher.report({ key: t.key(1), type: 'merged' })
    writeIssues(issue(1), issue(2))
    // Four minutes on, the interval has not passed: no new check, nothing claimed.
    t.clock.now += 4 * 60_000
    await t.watcher.tick()
    expect(t.fires).toHaveLength(1)
    t.clock.now += 2 * 60_000
    await t.watcher.tick()
    await t.watcher.poll('p1')
    expect(t.fires.map((f) => f.record.number)).toEqual([1, 2])
  })
})

describe('状态机 through the window’s reports', () => {
  async function claimed(over: { accept?: string } = {}) {
    const t = setup(over)
    writePermission('alice', 'write')
    writeIssues(issue(1))
    await t.enable()
    expect(t.fires).toHaveLength(1)
    return t
  }

  it('queued → working → 待批准 → 已合并', async () => {
    const t = await claimed()
    expect(t.watcher.state().issues[0]?.state).toBe('queued')
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'working', sessionId: 's1' })
    t.watcher.report({ key: t.key(1), type: 'awaiting', because: 'unchanged' })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'awaiting', reason: '没有改动' })
    t.watcher.report({ key: t.key(1), type: 'merged' })
    expect(t.watcher.state().issues[0]?.state).toBe('merged')
    // A late report cannot undo it.
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's2' })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'merged', sessionId: 's1' })
  })

  it('drops an issue the session was archived for', async () => {
    const t = await claimed()
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    t.watcher.report({ key: t.key(1), type: 'dropped', reason: 'issue closed' })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'dropped', reason: 'issue closed' })
  })

  it('accepts a passing command and reports 待批准', async () => {
    const t = await claimed({ accept: 'echo all good' })
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    const result = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(result).toMatchObject({ ok: true, next: 'awaiting', acceptance: { passed: true, command: 'echo all good' } })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'awaiting', acceptance: { passed: true } })
  })

  it('runs no command when the project has none', async () => {
    const t = await claimed()
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    const result = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(result).toEqual({ ok: true, next: 'none' })
    expect(t.watcher.state().issues[0]?.state).toBe('working')
  })

  it('sends a failed acceptance back at most twice', async () => {
    const t = await claimed({ accept: 'echo it broke; exit 1' })
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    const first = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(first).toMatchObject({ ok: true, next: 'fix' })
    if (first.ok && first.next === 'fix') {
      expect(first.prompt).toContain('it broke')
      expect(first.prompt).toContain('echo it broke; exit 1')
    }
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'fixing', rounds: 1 })

    t.watcher.report({ key: t.key(1), type: 'fix-done' })
    expect(t.watcher.state().issues[0]?.state).toBe('fixing')
    const second = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(second).toMatchObject({ ok: true, next: 'fix' })
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'fixing', rounds: 2 })

    t.watcher.report({ key: t.key(1), type: 'fix-done' })
    const third = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(third).toMatchObject({ ok: true, next: 'awaiting' })
    if (third.ok && third.next === 'awaiting') expect(third.acceptance.passed).toBe(false)
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'awaiting', rounds: 2, reason: '验收失败' })
  })

  it('stops a command that runs too long and keeps the last 4 KB as failed', async () => {
    // Much more than 4 KB, then it hangs: stopped at the acceptance's time (1500 ms in setup).
    const t = await claimed({ accept: 'yes wavi | head -c 12000; sleep 30' })
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    const result = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok || result.next === 'none') throw new Error('expected a result')
    expect(result.acceptance).toMatchObject({ passed: false, timedOut: true })
    expect(result.acceptance.output?.length).toBeLessThanOrEqual(MAX_ACCEPT_OUTPUT)
    expect(result.acceptance.output).toContain('wavi')
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'fixing', acceptance: { passed: false, timedOut: true } })
  })

  it('refuses a worktree that is not the project’s', async () => {
    const t = await claimed({ accept: 'true' })
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    const result = await t.watcher.accept({ key: t.key(1), root: t.root, worktree: join(base, 'elsewhere') })
    expect(result).toMatchObject({ ok: false })
    expect(t.watcher.state().issues[0]?.state).toBe('working')
  })

  it('ends a 待批准 issue that was closed on GitHub', async () => {
    const t = await claimed({ accept: 'true' })
    t.watcher.report({ key: t.key(1), type: 'opened', sessionId: 's1' })
    await t.watcher.accept({ key: t.key(1), root: t.root, worktree: t.worktree })
    expect(t.watcher.state().issues[0]?.state).toBe('awaiting')
    writeGh('issue-closed', '')
    await t.watcher.poll('p1')
    expect(t.watcher.state().issues[0]).toMatchObject({ state: 'dropped', reason: 'issue 在 GitHub 上已经关闭' })
  })

  it('ignores a move that does not fit the state machine', async () => {
    const t = await claimed()
    t.watcher.report({ key: t.key(1), type: 'merged' })
    expect(t.watcher.state().issues[0]?.state).toBe('queued')
    t.watcher.report({ key: 'github.com/acme/nope#1', type: 'merged' })
  })
})
