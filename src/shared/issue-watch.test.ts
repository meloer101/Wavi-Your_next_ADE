// src/shared/issue-watch.test.ts
import { describe, expect, it } from 'vitest'
import {
  ACCEPT_TIMEOUT_MS,
  DEFAULT_LABEL,
  MAX_ACCEPT_OUTPUT,
  MAX_FIX_ROUNDS,
  MAX_ISSUES,
  ISSUE_STATES,
  activeIssues,
  afterAcceptance,
  agentCanReportTurn,
  agentEligible,
  byCreatedAt,
  canTransition,
  cappedPermission,
  claimBudget,
  claimDecision,
  claimsToday,
  dailyCapReached,
  fixPrompt,
  issueBranch,
  issueKey,
  issueNotice,
  issueReason,
  issueStateLabel,
  issueTitle,
  localDay,
  parseAcceptRequest,
  parseFile,
  parseIssueRecord,
  parseLinked,
  parseProject,
  parseProjectDraft,
  parseReport,
  parseSettings,
  savedProject,
  splitIssueKey,
  tailOutput,
  transition,
  type ClaimInput,
  type DiscoveredIssue,
  type IssueAcceptance,
  type IssueRecord,
  type IssueState,
  type IssueWatchProjectSettings
} from './issue-watch'
import { setLang, withLang } from './i18n'
import { squashMessage, withClosing } from './git-merge'
import { parseShipMainRequest } from './ship-requests'

const at = (d: number, h: number): number => new Date(2026, 10, d, h).getTime()
const enabledAt = at(10, 9)

const issue = (over: Partial<DiscoveredIssue> = {}): DiscoveredIssue => ({
  number: 1,
  title: '结算页在 Safari 17 上白屏',
  url: 'https://github.com/acme/widget/issues/1',
  author: 'someone',
  labels: [],
  assignees: [],
  createdAt: at(11, 12),
  updatedAt: at(11, 12),
  ...over
})

const settings = (over: Partial<IssueWatchProjectSettings> = {}): IssueWatchProjectSettings => ({
  projectId: 'p1',
  enabled: true,
  enabledAt,
  mode: 'members',
  label: DEFAULT_LABEL,
  agent: 'claude',
  ui: 'cli',
  ...over
})

const claimInput = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  issue: issue(),
  settings: settings(),
  handled: false,
  linked: false,
  viewer: 'me',
  authorCanWrite: true,
  labelAt: null,
  ...over
})

const record = (over: Partial<IssueRecord> = {}): IssueRecord => ({
  key: issueKey('github.com/acme/widget', 1),
  projectId: 'p1',
  repo: 'github.com/acme/widget',
  number: 1,
  title: '结算页在 Safari 17 上白屏',
  url: 'https://github.com/acme/widget/issues/1',
  author: 'someone',
  createdAt: at(11, 12),
  claimedAt: at(11, 13),
  state: 'queued',
  rounds: 0,
  ...over
})

describe('claimDecision', () => {
  it('members: claims an author who can write, once the issue is newer than the switch', () => {
    expect(claimDecision(claimInput())).toEqual({ claim: true })
    expect(claimDecision(claimInput({ issue: issue({ createdAt: at(10, 8) }) }))).toEqual({ claim: false, reason: 'before' })
  })

  it('members: an outsider needs the label, and a member has to have added it after the switch', () => {
    const outsider = claimInput({ authorCanWrite: false, issue: issue({ labels: [DEFAULT_LABEL] }) })
    expect(claimDecision(outsider)).toEqual({ claim: false, reason: 'label' })
    // The label was there before the switch was turned on.
    expect(claimDecision({ ...outsider, labelAt: at(10, 8) })).toEqual({ claim: false, reason: 'label' })
    expect(claimDecision({ ...outsider, labelAt: at(11, 14) })).toEqual({ claim: true })
    // Unknown permission counts as an outsider.
    expect(claimDecision({ ...outsider, authorCanWrite: null })).toEqual({ claim: false, reason: 'label' })
    // No label on the issue at all: labelAt is never asked and cannot make it eligible.
    expect(claimDecision({ ...outsider, issue: issue() })).toEqual({ claim: false, reason: 'label' })
  })

  it('members: a label added by an issue-form template (no member actor) does not count', () => {
    // The template adds the label for a read-only author: the label is on the issue, but no member applied it.
    const templated = claimInput({ authorCanWrite: false, issue: issue({ labels: ['bug', DEFAULT_LABEL] }), labelAt: null })
    expect(claimDecision(templated)).toEqual({ claim: false, reason: 'label' })
  })

  it('members: a label added by a read-only user does not count', () => {
    // Main only asks the timeline for a member's labelled event; a read-only actor leaves labelAt null.
    const byReader = claimInput({ authorCanWrite: false, issue: issue({ labels: [DEFAULT_LABEL] }), labelAt: null })
    expect(claimDecision(byReader)).toEqual({ claim: false, reason: 'label' })
  })

  it('all: claims anyone’s issue, even without the label', () => {
    const input = claimInput({ settings: settings({ mode: 'all' }), authorCanWrite: false, issue: issue({ author: 'stranger' }) })
    expect(claimDecision(input)).toEqual({ claim: true })
    expect(claimDecision({ ...input, issue: issue({ createdAt: at(10, 8) }) })).toEqual({ claim: false, reason: 'before' })
    // An old issue labelled after the switch is still new enough.
    expect(claimDecision({ ...input, issue: issue({ createdAt: at(10, 8), labels: [DEFAULT_LABEL] }), labelAt: at(11, 1) })).toEqual({ claim: true })
  })

  it('never claims an issue twice, one an open session has, or one assigned to someone else', () => {
    expect(claimDecision(claimInput({ handled: true }))).toEqual({ claim: false, reason: 'handled' })
    expect(claimDecision(claimInput({ linked: true }))).toEqual({ claim: false, reason: 'linked' })
    expect(claimDecision(claimInput({ issue: issue({ assignees: ['other'] }) }))).toEqual({ claim: false, reason: 'assigned' })
    // Assigned to the viewer: still ours to claim (the assign is a no-op).
    expect(claimDecision(claimInput({ issue: issue({ assignees: ['Me'] }) }))).toEqual({ claim: true })
    // Off: nothing is claimed whatever the issue is.
    expect(claimDecision(claimInput({ settings: settings({ enabled: false }) }))).toEqual({ claim: false, reason: 'before' })
    expect(claimDecision(claimInput({ settings: settings({ enabledAt: null }) }))).toEqual({ claim: false, reason: 'before' })
  })

  it('the queue is ordered by creation, oldest first', () => {
    const issues = [issue({ number: 3, createdAt: at(11, 15) }), issue({ number: 2, createdAt: at(11, 10) }), issue({ number: 1, createdAt: at(11, 10) })]
    expect([...issues].sort(byCreatedAt).map((i) => i.number)).toEqual([1, 2, 3])
  })
})

describe('queue and the day’s cap', () => {
  const records = [
    record({ key: issueKey('github.com/acme/widget', 1), state: 'working' }),
    record({ key: issueKey('github.com/acme/widget', 2), state: 'accepting' })
  ]

  it('counts the issues claimed and not yet reported', () => {
    expect(activeIssues(records, 'p1')).toHaveLength(2)
    expect(activeIssues([...records, record({ key: issueKey('github.com/acme/widget', 3), state: 'awaiting' })], 'p1')).toHaveLength(2)
    expect(activeIssues(records, 'p2')).toHaveLength(0)
  })

  it('leaves what the concurrency and the day’s cap leave', () => {
    expect(claimBudget(records, { intervalMinutes: 5, concurrent: 2, daily: 10 }, 'p1', at(11, 20))).toBe(0)
    expect(claimBudget(records, { intervalMinutes: 5, concurrent: 3, daily: 10 }, 'p1', at(11, 20))).toBe(1)
    // 10 claims today, all reported: the day is over for this project.
    const done = Array.from({ length: 10 }, (_, i) =>
      record({ key: issueKey('github.com/acme/widget', i + 1), number: i + 1, state: 'merged', claimedAt: at(11, 1) })
    )
    expect(claimsToday(done, 'p1', at(11, 20))).toBe(10)
    expect(dailyCapReached(done, { intervalMinutes: 5, concurrent: 2, daily: 10 }, 'p1', at(11, 20))).toBe(true)
    expect(claimBudget(done, { intervalMinutes: 5, concurrent: 2, daily: 10 }, 'p1', at(11, 20))).toBe(0)
    // Tomorrow the cap is fresh, same records.
    expect(claimsToday(done, 'p1', at(12, 0))).toBe(0)
    expect(claimBudget(done, { intervalMinutes: 5, concurrent: 2, daily: 10 }, 'p1', at(12, 0))).toBe(2)
  })

  it('counts the day by the local clock', () => {
    expect(localDay(at(11, 23))).toBe('2026-11-11')
    expect(localDay(new Date(2026, 10, 12, 0, 0, 1).getTime())).toBe('2026-11-12')
  })
})

describe('the state machine', () => {
  const allowed: Array<[IssueState, IssueState]> = [
    ['queued', 'working'],
    ['queued', 'dropped'],
    ['working', 'accepting'],
    ['working', 'awaiting'],
    ['working', 'dropped'],
    ['accepting', 'fixing'],
    ['accepting', 'awaiting'],
    ['accepting', 'dropped'],
    ['fixing', 'accepting'],
    ['fixing', 'awaiting'],
    ['fixing', 'dropped'],
    ['awaiting', 'merged'],
    ['awaiting', 'dropped']
  ]
  const moves = ISSUE_STATES.flatMap((from) => ISSUE_STATES.map((to) => [from, to] as const))

  it('allows exactly the chain’s moves', () => {
    for (const [from, to] of moves) {
      const ok = allowed.some(([a, b]) => a === from && b === to)
      expect(canTransition(from, to), `${from} → ${to}`).toBe(ok)
    }
  })

  it('moves a record and refuses everything else', () => {
    const queued = record()
    const working = transition(queued, 'working', { sessionId: 's1' })
    expect(working).toMatchObject({ state: 'working', sessionId: 's1' })
    expect(transition(working!, 'merged')).toBeNull()
    expect(transition(record({ state: 'merged' }), 'dropped')).toBeNull()
    // A late report after the issue was abandoned changes nothing.
    expect(transition(record({ state: 'dropped' }), 'working')).toBeNull()
  })

  it('counts fix rounds and stops at two', () => {
    const acceptance = (passed: boolean): IssueAcceptance => ({ passed, command: 'npm test', at: at(11, 30), rounds: 0 })
    let current = transition(record(), 'working')!
    current = transition(current, 'accepting')!
    const first = afterAcceptance(current, acceptance(false))
    expect(first.to).toBe('fixing')
    current = transition(current, first.to, first.patch)!
    expect(current.rounds).toBe(1)

    current = transition(current, 'accepting')!
    const second = afterAcceptance(current, acceptance(false))
    expect(second.to).toBe('fixing')
    current = transition(current, second.to, second.patch)!
    expect(current.rounds).toBe(2)

    current = transition(current, 'accepting')!
    const third = afterAcceptance(current, acceptance(false))
    expect(third.to).toBe('awaiting')
    expect(third.patch.reason).toBe('验收失败')
    expect(MAX_FIX_ROUNDS).toBe(2)

    // A passing acceptance goes to 待批准 with its result.
    const passed = afterAcceptance(transition(record({ state: 'working' }), 'accepting')!, acceptance(true))
    expect(passed.to).toBe('awaiting')
  })
})

describe('the permission cap', () => {
  it('caps an outsider’s session at 接受编辑 in 全部直接领', () => {
    expect(cappedPermission('all', false, 'full-access')).toBe('accept-edits')
    expect(cappedPermission('all', false, 'auto')).toBe('accept-edits')
    expect(cappedPermission('all', false, 'accept-edits')).toBe('accept-edits')
    expect(cappedPermission('all', false, 'ask')).toBe('ask')
    expect(cappedPermission('all', false, undefined)).toBeUndefined()
    // A member's issue keeps what was picked.
    expect(cappedPermission('all', true, 'full-access')).toBe('full-access')
    // Unknown permission keeps it too (only an author known not to write is capped).
    expect(cappedPermission('all', null, 'auto')).toBe('auto')
    // The members mode only claims members' and labelled issues: no cap there.
    expect(cappedPermission('members', false, 'full-access')).toBe('full-access')
  })
})

describe('agent eligibility', () => {
  it('takes the agents that report a turn’s end, and every GUI session', () => {
    expect(agentCanReportTurn('claude', 'cli')).toBe(true)
    expect(agentEligible('gemini', 'cli')).toBe(true)
    // The title-only CLIs cannot tell when a turn ends (PRD F26).
    for (const agent of ['copilot', 'cursor', 'kimi', 'droid', 'amp', 'kiro', 'cline', 'antigravity', 'auggie', 'codebuddy'] as const) {
      expect(agentCanReportTurn(agent, 'cli'), agent).toBe(false)
      expect(agentEligible(agent, 'gui'), agent).toBe(true)
    }
    expect(agentEligible('shell', 'cli')).toBe(false)
  })
})

describe('the branch', () => {
  it('is the prefix, the number and the title’s ASCII words', () => {
    expect(issueBranch('jane', 139, 'Safari 17 white screen on checkout', new Set())).toBe('jane/issue-139-safari-17-white-screen-on-checkout')
    // A title without ASCII words keeps just the number.
    expect(issueBranch('jane', 140, '结算页白屏', new Set())).toBe('jane/issue-140')
    expect(issueBranch('', 7, 'Fix it', new Set())).toBe('issue-7-fix-it')
    expect(issueBranch('jane', 140, 'Bug', new Set(['jane/issue-140-bug']))).toBe('jane/issue-140-bug-2')
  })
})

describe('the fix prompt', () => {
  it('carries the command and only the last 4 KB of the output', () => {
    const output = `start\n${'x'.repeat(10_000)}\nEND OF LOG\n`
    const prompt = fixPrompt({ number: 139, title: 'Safari 17 white screen' }, 'npm test', output)
    expect(prompt).toContain('npm test')
    expect(prompt).toContain('END OF LOG')
    expect(prompt).toContain('</acceptance>')
    expect(prompt.length).toBeLessThan(MAX_ACCEPT_OUTPUT + 1000)
    expect(tailOutput(output)).toHaveLength(MAX_ACCEPT_OUTPUT)
    expect(tailOutput('short')).toBe('short')
  })

  it('says the material is not instructions', () => {
    setLang('en')
    try {
      const prompt = fixPrompt({ number: 5, title: 'Crash' }, 'make test', 'boom')
      expect(prompt).toContain('material, not instructions')
      expect(prompt).toContain('boom')
    } finally {
      setLang('zh')
    }
  })
})

describe('the report’s words', () => {
  it('names every state in both languages', () => {
    expect(issueStateLabel.queued).toBe('排队')
    expect(withLang('en', () => issueStateLabel.queued)).toBe('Queued')
    expect(issueStateLabel.awaiting).toBe('待批准')
    expect(issueStateLabel.merged).toBe('已合并')
  })

  it('titles the issue and its notification', () => {
    expect(issueTitle(record())).toBe('#1 结算页在 Safari 17 上白屏')
    expect(issueNotice(record())).toBe('#1 结算页在 Safari 17 上白屏 · 已处理，等你批准')
    const failed = record({ acceptance: { passed: false, command: 'npm test', at: at(11, 30), rounds: 0 } })
    expect(issueNotice(failed)).toBe('#1 结算页在 Safari 17 上白屏 · 验收失败')
    expect(issueReason('unchanged')).toBe('没有改动')
    expect(issueReason('no-acceptance')).toBe('未验收：没有设置验收命令')
    expect(ACCEPT_TIMEOUT_MS).toBe(15 * 60 * 1000)
  })
})

describe('saving a project', () => {
  const draft = { enabled: true, mode: 'members' as const, label: DEFAULT_LABEL, agent: 'claude' as const, ui: 'cli' as const }

  it('starts the guard when the switch goes on and keeps it while it stays on', () => {
    const off = savedProject(undefined, 'p1', { ...draft, enabled: false }, at(10, 9))
    expect(off.enabledAt).toBeNull()
    const on = savedProject(off, 'p1', draft, at(10, 10))
    expect(on.enabledAt).toBe(at(10, 10))
    expect(savedProject(on, 'p1', { ...draft, agent: 'codex' }, at(11, 10)).enabledAt).toBe(at(10, 10))
    const again = savedProject(on, 'p1', { ...draft, enabled: false }, at(11, 10))
    expect(again.enabledAt).toBeNull()
    expect(savedProject(again, 'p1', draft, at(11, 11)).enabledAt).toBe(at(11, 11))
  })
})

describe('parsing the file and the IPC payloads', () => {
  it('reads the settings with the defaults and their bounds', () => {
    expect(parseSettings(null)).toEqual({ intervalMinutes: 5, concurrent: 2, daily: 10 })
    expect(parseSettings({ intervalMinutes: 1 })).toMatchObject({ intervalMinutes: 5 })
    expect(parseSettings({ intervalMinutes: 2, concurrent: 4, daily: 20 })).toEqual({ intervalMinutes: 2, concurrent: 4, daily: 20 })
    expect(parseSettings({ intervalMinutes: 99_999, concurrent: 0, daily: -3 })).toEqual({ intervalMinutes: 5, concurrent: 2, daily: 10 })
  })

  it('validates a project’s settings', () => {
    const project = parseProject({ projectId: 'p1', enabled: true, enabledAt: 5, mode: 'all', label: 'wavi', agent: 'codex', ui: 'gui', model: 'gpt-6-sol', permission: 'auto', accept: 'npm test' })
    expect(project).toMatchObject({ projectId: 'p1', enabledAt: 5, mode: 'all', accept: 'npm test' })
    expect(parseProjectDraft({ enabled: true, mode: 'weird', label: 'wavi', agent: 'claude', ui: 'cli' })).toBeNull()
    expect(parseProjectDraft({ enabled: true, mode: 'all', label: '', agent: 'claude', ui: 'cli' })).toBeNull()
    expect(parseProjectDraft({ enabled: true, mode: 'all', label: 'wavi', agent: 'claude', ui: 'cli', permission: 'yolo' })).toBeNull()
    expect(parseProject({ projectId: 'p1', enabled: true, enabledAt: 'yesterday', mode: 'all', label: 'wavi', agent: 'claude', ui: 'cli' })).toBeNull()
  })

  it('drops malformed records rather than half-reading them', () => {
    const good = record({ sessionId: 's1', acceptance: { passed: true, command: 'npm test', at: at(11, 30), rounds: 0 } })
    expect(parseIssueRecord(good)).toMatchObject({ key: good.key, state: 'queued', sessionId: 's1' })
    expect(parseIssueRecord({ ...good, state: 'nowhere' })).toBeNull()
    expect(parseIssueRecord({ ...good, key: 'not-a-key' })).toBeNull()
    expect(parseIssueRecord({ ...good, url: 'javascript:alert(1)' })).toBeNull()
    expect(parseIssueRecord({ ...good, rounds: 9 })).toBeNull()
  })

  it('reads a whole file: unknown tasks dropped, duplicates kept once', () => {
    const data = parseFile({
      version: 1,
      settings: { intervalMinutes: 3 },
      projects: [{ projectId: 'p1', enabled: true, enabledAt: 1, mode: 'all', label: 'wavi', agent: 'claude', ui: 'cli' }, { projectId: '' }],
      issues: [record(), record(), { key: 'bad' }]
    })
    expect(data.settings.intervalMinutes).toBe(3)
    expect(data.projects).toHaveLength(1)
    expect(data.issues).toHaveLength(1)
    expect(parseFile(undefined).issues).toEqual([])
    expect(parseFile({ issues: Array.from({ length: MAX_ISSUES + 5 }, (_, i) => record({ key: issueKey('github.com/a/b', i + 1), number: i + 1 })) }).issues).toHaveLength(MAX_ISSUES)
  })

  it('keys are host/owner/repo#n', () => {
    expect(issueKey('github.com/acme/widget', 12)).toBe('github.com/acme/widget#12')
    expect(splitIssueKey('github.com/acme/widget#12')).toEqual({ repo: 'github.com/acme/widget', number: 12 })
    expect(splitIssueKey('github.com/acme/widget#0')).toBeNull()
    expect(splitIssueKey('#12')).toBeNull()
  })

  it('validates the window’s reports, acceptance requests and linked keys', () => {
    expect(parseReport({ key: record().key, type: 'opened', sessionId: 's1' })).toEqual({ key: record().key, type: 'opened', sessionId: 's1' })
    expect(parseReport({ key: record().key, type: 'awaiting', because: 'unchanged' })).toMatchObject({ type: 'awaiting', because: 'unchanged' })
    expect(parseReport({ key: record().key, type: 'awaiting', because: 'whatever' })).toBeNull()
    expect(parseReport({ key: 'bad', type: 'merged' })).toBeNull()
    expect(parseReport({ key: record().key, type: 'dropped', reason: 'issue closed' })).toMatchObject({ type: 'dropped', reason: 'issue closed' })
    expect(parseReport({ key: record().key, type: 'note', note: '' })).toBeNull()
    expect(parseAcceptRequest({ key: record().key, root: '/tmp/repo', worktree: '/tmp/repo-wt' })).toEqual({ key: record().key, root: '/tmp/repo', worktree: '/tmp/repo-wt' })
    expect(parseAcceptRequest({ key: record().key, root: 'repo', worktree: '/tmp/repo-wt' })).toBeNull()
    expect(parseLinked([record().key, record().key])).toEqual([record().key])
    expect(parseLinked(['nope'])).toBeNull()
    expect(parseLinked('x')).toBeNull()
  })
})

describe('Closes #N', () => {
  it('ends a squash message with the closing line once', () => {
    const commits = [{ subject: 'Fix the checkout', body: 'Fix the checkout\n\nCloses #12' }]
    const message = squashMessage('feat', commits, 'Checkout fix', 12)
    expect(message.trimEnd().endsWith('\nCloses #12')).toBe(true)
    expect(message.match(/Closes #12/g)).toHaveLength(1)
    // No closing line in the commits: it is added.
    const bare = squashMessage('feat', [{ subject: 'Fix it', body: 'Fix it' }], 'Checkout fix', 7)
    expect(bare.trimEnd().endsWith('\nCloses #7')).toBe(true)
    // Another issue is not touched.
    expect(squashMessage('feat', [{ subject: 'x', body: 'x\n\nCloses #3' }], 't', 7)).toContain('Closes #3')
  })

  it('completes an agent-written message once, and only when that issue is not closed yet', () => {
    expect(withClosing('Fix the checkout\n\nWhy: it crashed', 12)).toBe('Fix the checkout\n\nWhy: it crashed\n\nCloses #12')
    expect(withClosing('Fix the checkout\n\nCloses #12', 12)).toBe('Fix the checkout\n\nCloses #12')
    expect(withClosing('Fix the checkout\n\nfixes acme/web#12', 12)).toBe('Fix the checkout\n\nfixes acme/web#12')
    expect(withClosing('Fix the checkout\n\nCloses #13', 12)).toBe('Fix the checkout\n\nCloses #13\n\nCloses #12')
    expect(withClosing('Fix the checkout', undefined)).toBe('Fix the checkout')
  })

  it('the 合并 request carries the issue, and only a real one', () => {
    const request = { root: '/r', worktree: '/w', method: 'squash', head: 'a'.repeat(40), baseHead: 'b'.repeat(40), push: false, message: 'Fix it' }
    expect(parseShipMainRequest({ ...request, closes: 12 })).toMatchObject({ closes: 12 })
    expect(parseShipMainRequest(request)).not.toHaveProperty('closes')
    expect(parseShipMainRequest({ ...request, closes: 0 })).toBeNull()
    expect(parseShipMainRequest({ ...request, closes: 1.5 })).toBeNull()
    expect(parseShipMainRequest({ ...request, closes: '12' })).toBeNull()
  })

  it('is the only thing added when there is no title and one commit', () => {
    const message = squashMessage('feat', [{ subject: 'Fix it', body: 'Fix it\n\nWhy: it broke' }], undefined, 9)
    expect(message).toBe('Fix it\n\nWhy: it broke\n\nCloses #9')
    expect(squashMessage('feat', [{ subject: 'Fix it', body: 'Fix it\n\nCloses #9' }], undefined, 9)).toBe('Fix it\n\nCloses #9')
  })
})
