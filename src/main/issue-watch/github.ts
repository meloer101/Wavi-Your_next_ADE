// 自动领取's GitHub side (PRD F26): gh only through F16's runner (its PATH, environment, concurrency and the pause after
// a rate limit), repository resolution as 看板 · GitHub does. Every call is a read except the claim (assign + 👀), and every
// value that reaches gh is written `--flag=value`; a login or label from GitHub is checked before it becomes a path.
import { isRateLimited, isSignedOut, repoArg, stripControl, type GitHubRepo } from '@shared/pull-requests'
import { defineMessages, pick } from '@shared/i18n'
import { parseDiscoveredIssues, type DiscoveredIssue } from '@shared/issue-watch'
import { lastLines } from '../git/run'
import { projectRepo } from '../github-board'
import { detectGh, gh, ghPausedUntil, pauseGhForRateLimit } from '../pull-requests'

const M = defineMessages({
  zh: {
    rateLimited: '到了 GitHub 的请求上限，稍后再试',
    signedOut: 'gh 还没有登录：在终端运行 gh auth login',
    ghMissing: '没有找到 gh：装好 GitHub CLI 并运行 gh auth login',
    ghExit: (code: number) => `gh 退出码 ${code}`,
    noJson: 'gh 没有输出 JSON',
    notGitHub: '这个项目不在 GitHub 上',
    projectGone: '项目不在了',
    unreadable: 'gh 的输出读不懂',
    assignFailed: (why: string) => `指派失败：${why}`,
    eyesFailed: (why: string) => `没能加 👀：${why}`,
    bothFailed: '；'
  },
  en: {
    rateLimited: 'Hit the GitHub rate limit; try again later',
    signedOut: 'gh is not signed in: run gh auth login in a terminal',
    ghMissing: "Couldn't find gh: install GitHub CLI and run gh auth login",
    ghExit: (code: number) => `gh exit code ${code}`,
    noJson: "gh didn't print JSON",
    notGitHub: "This project isn't on GitHub",
    projectGone: 'The project is gone',
    unreadable: "Can't read gh's output",
    assignFailed: (why: string) => `Couldn't assign the issue: ${why}`,
    eyesFailed: (why: string) => `Couldn't add 👀: ${why}`,
    bothFailed: '; '
  }
})

/** What one check of a project found: the open issues, or why there is nothing to check. */
export type ProjectScan =
  | { state: 'ok'; repo: GitHubRepo; issues: DiscoveredIssue[] }
  | { state: 'not-github' }
  | { state: 'error'; message: string }

/** The labels' timeline is read up to this many pages (100 events each): enough for anyone's backlog. */
const TIMELINE_PAGES = 5
const ISSUE_LIMIT = 100
/** A write permission is kept this long per user and repository (PRD F26). */
export const PERMISSION_TTL_MS = 60 * 60 * 1000
const permissionCache = new Map<string, { canWrite: boolean; at: number }>()

/** gh's words for a failed call, after noting a rate limit (every later gh call then waits, as F16's do). */
function failure(ran: { code: number; stdout: string; stderr: string }): string {
  const output = `${ran.stderr}\n${ran.stdout}`.trim()
  if (isRateLimited(output)) {
    pauseGhForRateLimit()
    return pick(M).rateLimited
  }
  if (isSignedOut(output)) return pick(M).signedOut
  return lastLines(output, 2, 200) || pick(M).ghExit(ran.code)
}

const paused = (): string | null => (ghPausedUntil() > Date.now() ? pick(M).rateLimited : null)

/** `--hostname=<host>` for a GitHub Enterprise host (`gh api` goes to github.com otherwise). */
const hostFlag = (repo: GitHubRepo): string[] => (repo.host === 'github.com' ? [] : [`--hostname=${repo.host}`])

/** A login from GitHub, safe to put into an API path (GitHub logins are letters, digits and single hyphens). */
const isLogin = (raw: string): boolean => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(raw)

/** The gh user's login, lower case; asked once, asked again next time when gh would not say. */
let viewer: { login: string | null } | null = null
export async function viewerLogin(): Promise<string | null> {
  if (viewer) return viewer.login
  const ran = await gh(['api', 'user', '--jq=.login'])
  if (ran.code !== 0) return null
  const login = ran.stdout.trim().toLowerCase()
  viewer = { login: isLogin(login) ? login : null }
  return viewer.login
}

/** The project's GitHub repository, or why there is none (the settings row shows it and nothing is polled). */
async function repoOf(root: string): Promise<{ repo: GitHubRepo } | { scan: ProjectScan }> {
  const state = await detectGh()
  if (state === 'missing') return { scan: { state: 'error', message: pick(M).ghMissing } }
  if (state === 'signed-out') return { scan: { state: 'error', message: pick(M).signedOut } }
  const where = await projectRepo(root)
  return where ? { repo: where.repo } : { scan: { state: 'not-github' } }
}

/** `gh issue list` for one project: every open issue, newest first as gh sorted them. */
export async function listIssues(root: string): Promise<ProjectScan> {
  const found = await repoOf(root)
  if ('scan' in found) return found.scan
  const { repo } = found
  const wait = paused()
  if (wait) return { state: 'error', message: wait }
  const ran = await gh([
    'issue',
    'list',
    `--repo=${repoArg(repo)}`,
    '--state=open',
    `--limit=${ISSUE_LIMIT}`,
    '--json=number,title,url,author,labels,assignees,createdAt,updatedAt'
  ])
  if (ran.code !== 0) return { state: 'error', message: failure(ran) }
  let json: unknown
  try {
    json = JSON.parse(ran.stdout) as unknown
  } catch {
    return { state: 'error', message: pick(M).noJson }
  }
  const issues = parseDiscoveredIssues(json)
  if (issues.length === 0 && !Array.isArray(json)) return { state: 'error', message: pick(M).unreadable }
  return { state: 'ok', repo, issues }
}

/**
 * Whether `login` has write / maintain / admin on the repository: `gh api repos/{o}/{r}/collaborators/{u}/permission`,
 * kept PERMISSION_TTL_MS per user and repository. A failure counts as no write (PRD F26) and is not kept when it was a
 * rate limit (the next check asks again).
 */
export async function canWrite(repo: GitHubRepo, login: string): Promise<boolean> {
  if (!isLogin(login)) return false
  const key = `${repoArg(repo).toLowerCase()}\n${login.toLowerCase()}`
  const hit = permissionCache.get(key)
  if (hit && Date.now() - hit.at < PERMISSION_TTL_MS) return hit.canWrite
  if (paused()) return false
  const ran = await gh(['api', `repos/${repo.owner}/${repo.name}/collaborators/${login}/permission`, ...hostFlag(repo)])
  if (ran.code !== 0) {
    const output = `${ran.stderr}\n${ran.stdout}`
    if (isRateLimited(output)) pauseGhForRateLimit()
    return false
  }
  let permission: string
  try {
    const json = JSON.parse(ran.stdout) as { permission?: unknown }
    permission = typeof json.permission === 'string' ? json.permission : ''
  } catch {
    return false
  }
  const yes = permission === 'admin' || permission === 'write' || permission === 'maintain'
  permissionCache.set(key, { canWrite: yes, at: Date.now() })
  return yes
}

/**
 * When a member last applied `label` to the issue, from the timeline's `labeled` events: the newest one whose actor has
 * write permission, or null. The labels on the issue itself say nothing about who put them there (an issue-form template
 * adds one for a read-only author), so the timeline decides (PRD F26).
 */
export async function labelActorAt(repo: GitHubRepo, number: number, label: string): Promise<number | null> {
  if (paused()) return null
  const ran = await gh(['api', `repos/${repo.owner}/${repo.name}/issues/${number}/timeline`, '--paginate', '--slurp', ...hostFlag(repo)])
  if (ran.code !== 0) {
    if (isRateLimited(`${ran.stderr}\n${ran.stdout}`)) pauseGhForRateLimit()
    return null
  }
  let pages: unknown
  try {
    pages = JSON.parse(ran.stdout) as unknown
  } catch {
    return null
  }
  const events = (Array.isArray(pages) ? pages.flat() : []).slice(-TIMELINE_PAGES * 100)
  const hits = events.flatMap((event) => {
    if (typeof event !== 'object' || event === null) return []
    const e = event as Record<string, unknown>
    if (e.event !== 'labeled') return []
    const named = typeof e.label === 'object' && e.label !== null ? (e.label as Record<string, unknown>).name : undefined
    const actor = typeof e.actor === 'object' && e.actor !== null ? (e.actor as Record<string, unknown>).login : undefined
    const at = typeof e.created_at === 'string' ? Date.parse(e.created_at) : NaN
    if (named !== label || typeof actor !== 'string' || !Number.isFinite(at)) return []
    return [{ actor, at }]
  })
  hits.sort((a, b) => b.at - a.at)
  for (const hit of hits) if (await canWrite(repo, hit.actor)) return hit.at
  return null
}

/**
 * 领取: assign the issue to @me and add 👀. Neither is required to go on (PRD F26): a failure comes back as a note the
 * report shows, and the issue is handled anyway.
 */
export async function claimIssue(repo: GitHubRepo, number: number): Promise<string | null> {
  const notes: string[] = []
  const wait = paused()
  if (wait) return wait
  const assigned = await gh(['issue', 'edit', String(number), `--repo=${repoArg(repo)}`, '--add-assignee=@me'])
  if (assigned.code !== 0) notes.push(pick(M).assignFailed(failure(assigned)))
  const reacted = await gh(['api', '-X', 'POST', `repos/${repo.owner}/${repo.name}/issues/${number}/reactions`, '-f', 'content=eyes', ...hostFlag(repo)])
  if (reacted.code !== 0) notes.push(pick(M).eyesFailed(failure(reacted)))
  return notes.length > 0 ? stripControl(notes.join(pick(M).bothFailed)).slice(0, 400) : null
}

/** The real dependencies of the watcher's GitHub calls (tests pass their own, or a fake gh on the PATH). */
export const githubCalls = { listIssues, canWrite, labelActorAt, claimIssue, viewerLogin }

export type { DiscoveredIssue }
