import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { DISPATCH_LIMITS, waviRunIds, type DispatchRequest, type PendingRun, type PendingStart, type WaviCommand, type WaviResult } from '@shared/dispatch'
import type { Task, TaskDraft } from '@shared/task-board'
import type { Session } from '@shared/types'
import { decideConfirms, dropConfirmsOf, handleWaviRequest, resumeConfirmTimers, setDispatchSettings } from './handler'
import { restoreDispatch, savedDispatch, useDispatch } from './store'

let sessions: Session[] = []
let leaderSessions: Record<string, string> = {}
const patchSession = vi.fn()
const addBackgroundSession = vi.fn((_project: string, _target: unknown, _kind: string, id?: string, _ui?: string): string | null => id ?? 'child')
const deliverMessage = vi.fn(async (): Promise<'delivered' | 'held'> => 'delivered')
const queueReport = vi.fn()

vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({
      sessions,
      worktrees: [{ id: 'w1', projectId: 'p1', path: '/repo', isMain: false, branch: 'jacob/plan', archived: false }],
      projects: [{ id: 'p1', rootPath: '/repo', name: 'repo' }],
      leaderSessions,
      addBackgroundSession,
      patchSession: (...args: unknown[]) => patchSession(...args)
    })
  }
}))
let ids = 0
vi.mock('../state/workspace-model', async (importOriginal) => ({ ...(await importOriginal<typeof import('../state/workspace-model')>()), randomId: (prefix: string) => `${prefix}-new${++ids}` }))
vi.mock('../new-session/creation', () => ({ createWorktreeFor: async () => true, holdForWorktree: () => {}, startEagerly: () => {} }))
vi.mock('../session-io', () => ({ interruptAgent: () => {} }))
let attemptGroups: { id: string; members: string[]; reportTo?: string }[] = []
vi.mock('../state/attempt-groups', () => ({ useAttemptGroups: { getState: () => ({ groups: attemptGroups }) } }))
vi.mock('../session-meta/store', () => ({ useSessionMeta: { getState: () => ({ bySession: {} }) } }))
vi.mock('../conflict-radar/store', () => ({ markFor: () => null, useRadar: { getState: () => ({ byRoot: {} }) } }))
vi.mock('./reports', () => ({ deliverMessage: (...args: unknown[]) => deliverMessage(...(args as [])), queueReport: (...args: unknown[]) => queueReport(...args) }))

const session = (id: string, over: Partial<Session> = {}): Session => ({ id, worktreeId: 'w1', kind: 'claude', title: id, status: 'idle', startedAt: 1, lastActivityAt: 1, ...over })

/** A waiting `wavi run`'s plan (the request is one: these tests only make runs there). */
const planOf = (c: PendingStart | undefined): PendingRun['plan'] => {
  if (c?.kind !== 'start') throw new Error('not a wavi run')
  return c.plan
}

let n = 0
const call = (sessionId: string, command: WaviCommand, deadline = Date.now() + 60_000): Promise<WaviResult> =>
  handleWaviRequest({ callId: `c${++n}`, sessionId, command, deadline } satisfies DispatchRequest)
const runCmd = (task: string, over: Partial<Extract<WaviCommand, { name: 'run' }>> = {}): WaviCommand => ({ name: 'run', agent: 'grok', task, base: 'head', ...over })

describe('wavi in a window (PRD F21)', () => {
  beforeEach(() => {
    sessions = [session('top'), session('child', { dispatchedBy: 'top', kind: 'codex' }), session('grand', { dispatchedBy: 'child', kind: 'gemini' })]
    addBackgroundSession.mockClear()
    deliverMessage.mockClear()
    queueReport.mockClear()
    useDispatch.setState({ confirms: [], held: {}, reported: {} })
    vi.stubGlobal('document', { hasFocus: () => true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      tr: {
        app: { detectAgents: async () => ({ claude: true, codex: true, grok: true, gemini: true }) },
        gitWorktrees: {
          newSessionInfo: async () => ({ repo: true, currentBranch: 'jacob/plan', defaultBranch: 'main', branches: [], prefix: 'jacob', worktreesDir: '/wt', takenFolders: [], includeCount: 0, hasSetup: false })
        },
        git: { changes: async () => null },
        ui: { notify: () => {} }
      }
    })
    setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('answers a run from the user’s session at once, naming the session that waits for 开始', async () => {
    const result = await call('top', runCmd('Review the auth code', { base: 'snapshot', title: 'Auth review' }))
    expect(result).toMatchObject({ ok: true, text: expect.stringContaining("waits for the user's 开始") })
    expect(result.text).toContain('end your turn now')
    const [pending] = useDispatch.getState().confirms
    expect(result.text).toContain(`Session ${pending!.childId}`)
    // A GUI dispatcher finds the session in this answer (Figma 68′).
    expect(waviRunIds(result.text)).toEqual([pending!.childId])
    expect(planOf(pending)).toMatchObject({ branch: '', request: { snapshotOf: '/repo' } })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('starts every waiting request of the dispatcher on 开始 and tells it which ones, in one message', async () => {
    await call('top', runCmd('Fix the login form'))
    await call('top', runCmd('Write login tests', { agent: 'claude' }))
    const [a, b] = useDispatch.getState().confirms
    expect(planOf(a).branch).not.toBe(planOf(b).branch)
    decideConfirms('top', true)
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(addBackgroundSession.mock.calls.map((c) => c[3])).toEqual([a!.childId, b!.childId])
    expect(deliverMessage).toHaveBeenCalledTimes(1)
    const text = (deliverMessage.mock.calls[0] as unknown[])[1] as string
    expect(text).toContain('用户同意了')
    expect(text).toContain(`id ${a!.childId} · grok`)
  })

  it('starts nothing on 拒绝 and says so; an agent that went away takes its requests along silently', async () => {
    await call('top', runCmd('Fix the login form'))
    decideConfirms('top', false)
    expect(addBackgroundSession).not.toHaveBeenCalled()
    expect((deliverMessage.mock.calls[0] as unknown[])[1]).toContain('用户拒绝了')
    await call('top', runCmd('Another thing'))
    dropConfirmsOf('top')
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(deliverMessage).toHaveBeenCalledTimes(1)
  })

  it('saves what waits for the user, and after a reload still tells the dispatcher when nobody answered', async () => {
    await call('top', runCmd('Fix the login form'))
    const saved = savedDispatch(useDispatch.getState())!
    expect(saved.confirms).toHaveLength(1)
    // The window goes (its request and timer with it); a new one takes the request up and its 10 minutes run again.
    dropConfirmsOf('top')
    restoreDispatch(saved)
    expect(useDispatch.getState().confirms).toEqual(saved.confirms)
    vi.useFakeTimers()
    Object.assign(window, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    try {
      resumeConfirmTimers()
      vi.advanceTimersByTime(DISPATCH_LIMITS.confirmMs)
    } finally {
      vi.useRealTimers()
    }
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect((deliverMessage.mock.calls.at(-1) as unknown[])[1]).toContain('10 分钟内没有回答')
    expect(savedDispatch(useDispatch.getState())).toBeNull()
  })

  it('lets a child start a grandchild at once, and refuses a grandchild that tries again', async () => {
    const started = await call('child', runCmd('Check the types'))
    expect(started).toMatchObject({ ok: true, text: expect.stringContaining('Started session') })
    expect(addBackgroundSession).toHaveBeenCalledTimes(1)
    expect(waviRunIds(started.text)).toEqual([addBackgroundSession.mock.calls[0]![3]])
    expect(await call('grand', runCmd('Go deeper'))).toMatchObject({ ok: false, failure: 'not_allowed' })
  })

  it('refuses an agent that is not installed, a duplicate, and a branch off a detached checkout', async () => {
    expect(await call('top', runCmd('x', { agent: 'cursor' }))).toMatchObject({ ok: false, failure: 'agent_unavailable' })
    await call('top', runCmd('Same task'))
    expect(await call('top', runCmd('Same  task'))).toMatchObject({ ok: false, failure: 'duplicate' })
  })

  it('keeps a tree to 8 sessions, waiting ones included', async () => {
    sessions = [session('top'), ...Array.from({ length: 7 }, (_, i) => session(`k${i}`, { dispatchedBy: i < 3 ? 'top' : 'k0' }))]
    expect(await call('k1', runCmd('one more'))).toMatchObject({ ok: true })
    sessions.push(session('k7', { dispatchedBy: 'k1' }))
    expect(await call('k2', runCmd('and another'))).toMatchObject({ ok: false, failure: 'limit' })
  })

  it('takes a report only from a dispatched session, and hands it to the reports queue', async () => {
    expect(await call('top', { name: 'report', text: 'done' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('child', { name: 'report', text: 'Fixed. Tests pass.' })).toMatchObject({ ok: true, text: expect.stringContaining('Reported to 「top」') })
    expect(queueReport).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }), 'report', 'Fixed. Tests pass.')
    expect(useDispatch.getState().reported.child).toBe(true)
  })

  it('does nothing once wavi has been told Wavi did not answer', async () => {
    expect(await call('child', runCmd('Too slow'), Date.now() - 1)).toMatchObject({ ok: false, failure: 'wavi_unavailable' })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('runs two wavi run at once one after the other, so the limits see both', async () => {
    sessions = [session('top'), ...Array.from({ length: 3 }, (_, i) => session(`k${i}`, { dispatchedBy: 'top' }))]
    const [a, b] = await Promise.all([call('top', runCmd('fourth')), call('top', runCmd('fifth'))])
    expect(a).toMatchObject({ ok: true })
    expect(b).toMatchObject({ ok: false, failure: 'limit' })
  })

  it('never answers a child’s permission prompt with stop, and refuses everything when dispatch is off', async () => {
    sessions[1] = { ...sessions[1]!, status: 'needs_you' }
    expect(await call('top', { name: 'stop', id: 'child' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    setDispatchSettings({ tools: false, autoApprove: false, leader: false })
    expect(await call('top', { name: 'ls' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('child', { name: 'report', text: 'x' })).toMatchObject({ ok: false, failure: 'not_allowed' })
  })

  it('answers send at once and delivers behind it', async () => {
    expect(await call('top', { name: 'send', id: 'child', text: 'one more thing' })).toMatchObject({ ok: true, text: expect.stringContaining('putting it in') })
    expect((deliverMessage.mock.calls[0] as unknown[])[1]).toContain('one more thing')
  })

  it('opens a GUI dispatcher’s children as GUI when their agent can (PRD F21 v1.163)', async () => {
    sessions[0] = { ...sessions[0]!, ui: 'gui' }
    sessions[1] = { ...sessions[1]!, ui: 'gui' }
    // A dispatched session's child starts at once.
    const started = await call('child', runCmd('Check the types', { agent: 'codex' }))
    expect(started).toMatchObject({ ok: true, text: expect.stringContaining('shown as a chat') })
    expect(addBackgroundSession.mock.calls[0]?.[4]).toBe('gui')
    // The user's own session's child waits for 开始 with its 界面 decided, and keeps it.
    await call('top', runCmd('Fix the login form', { agent: 'claude' }))
    expect(planOf(useDispatch.getState().confirms[0]).item.ui).toBe('gui')
    decideConfirms('top', true)
    expect(addBackgroundSession.mock.calls[1]?.[4]).toBe('gui')
  })

  it('starts a GUI child at its GUI dispatcher’s 权限 (PRD F21 v1.209)', async () => {
    sessions[1] = { ...sessions[1]!, ui: 'gui', guiPermission: 'full-access' }
    patchSession.mockClear()
    await call('child', runCmd('Check the types', { agent: 'codex' }))
    const id = addBackgroundSession.mock.calls[0]?.[3]
    expect(patchSession).toHaveBeenCalledWith(id, expect.objectContaining({ guiPermission: 'full-access' }))
    expect(useDispatch.getState().launches[id!]?.permission).toBeUndefined()
  })

  it('follows --ui, and tells the dispatcher when the GUI it asked for cannot be', async () => {
    const tr = (window as unknown as { tr: { app: { detectAgents: () => Promise<unknown> } } }).tr
    tr.app.detectAgents = async () => ({ claude: true, codex: true, crush: true })
    sessions[1] = { ...sessions[1]!, ui: 'gui' }
    await call('child', runCmd('As a terminal', { agent: 'codex', ui: 'cli' }))
    expect(addBackgroundSession.mock.calls[0]?.[4]).toBe('cli')
    const crush = await call('child', runCmd('Crush in a chat', { agent: 'crush', ui: 'gui' }))
    expect(crush).toMatchObject({ ok: true, text: expect.stringContaining('Crush opens in a terminal: it has no chat mode.') })
    expect(addBackgroundSession.mock.calls[1]?.[4]).toBe('cli')
    // A CLI dispatcher can ask for a chat too; without asking its children stay terminals.
    expect(await call('top', runCmd('Claude in a chat', { agent: 'claude', ui: 'gui' }))).toMatchObject({ ok: true, text: expect.stringContaining('shown as a chat') })
    await call('top', runCmd('Claude in a terminal', { agent: 'claude' }))
    expect(useDispatch.getState().confirms.map((c) => planOf(c).item.ui)).toEqual(['gui', undefined])
  })

  it('acts only on the caller’s own sessions', async () => {
    expect(await call('child', { name: 'read', id: 'top', offset: 0 })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('top', { name: 'stop', id: 'grand' })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('top', { name: 'ls' })).toMatchObject({ ok: true, text: expect.stringContaining('id child · codex') })
  })
})

describe('wavi for a project’s leader (PRD F21 v1.198)', () => {
  beforeEach(() => {
    sessions = [
      session('lead'),
      session('user1', { status: 'needs_you', waitingFor: 'permission', lastReply: 'Shall I go on?' }),
      session('kid', { dispatchedBy: 'lead', kind: 'codex', status: 'running' }),
      session('top'),
      session('child', { dispatchedBy: 'top', kind: 'codex' }),
      session('term', { kind: 'shell' })
    ]
    leaderSessions = { p1: 'lead' }
    addBackgroundSession.mockClear()
    deliverMessage.mockClear()
    patchSession.mockClear()
    useDispatch.setState({ confirms: [], held: {}, reported: {}, tells: {}, messages: {} })
    vi.stubGlobal('document', { hasFocus: () => true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      tr: {
        app: { detectAgents: async () => ({ claude: true, codex: true }) },
        gitWorktrees: { newSessionInfo: async () => ({ repo: true, currentBranch: 'main', defaultBranch: 'main', branches: [], prefix: 'jacob', worktreesDir: '/wt', takenFolders: [], includeCount: 0, hasSetup: false }) },
        git: { changes: async () => null },
        ui: { notify: () => {} }
      }
    })
    setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  })
  afterEach(() => {
    leaderSessions = {}
    vi.unstubAllGlobals()
  })

  it('starts the leader’s sessions at its 自动: 完全访问 for an agent without one, as a launch flag (PRD F21 v1.209)', async () => {
    const tr = (window as unknown as { tr: { app: { detectAgents: () => Promise<unknown> } } }).tr
    tr.app.detectAgents = async () => ({ claude: true, codex: true, gemini: true })
    await call('lead', runCmd('Fix the login form', { agent: 'claude' }))
    await call('lead', runCmd('Write the tests', { agent: 'gemini' }))
    const [a, b] = useDispatch.getState().confirms
    decideConfirms('lead', true)
    expect(useDispatch.getState().launches[a!.childId]?.permission).toBe('auto')
    expect(useDispatch.getState().launches[b!.childId]?.permission).toBe('full-access')
    // Not a leader, nothing reported: the agent's own default.
    await call('top', runCmd('Another thing', { agent: 'claude' }))
    const [c] = useDispatch.getState().confirms
    decideConfirms('top', true)
    expect(useDispatch.getState().launches[c!.childId]?.permission).toBeUndefined()
  })

  it('lists every other agent session of the project, mine or the user’s, telling a permission from a question', async () => {
    const result = await call('lead', { name: 'ls', all: true })
    expect(result.ok).toBe(true)
    const lines = result.text.split('\n')
    expect(lines.find((l) => l.startsWith('- id user1'))).toContain('waiting for the user to answer a permission prompt in its terminal')
    expect(lines.find((l) => l.startsWith('- id user1'))).toMatch(/ · user$/)
    expect(result.text).toContain('last: Shall I go on?')
    expect(lines.find((l) => l.startsWith('- id kid'))).toMatch(/ · mine$/)
    expect(lines.find((l) => l.startsWith('- id child'))).toContain('user (dispatched by top)')
    expect(result.text).not.toContain('id lead')
    expect(result.text).not.toContain('id term')
  })

  it('keeps every other session to its own scope: no ls --all, adopt or tell, and read only its own', async () => {
    expect(await call('top', { name: 'ls', all: true })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('top', { name: 'read', id: 'user1', offset: 0 })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('top', { name: 'adopt', id: 'user1', task: 'Finish it' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('top', { name: 'tell', text: 'Pick one' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(useDispatch.getState().tells.top).toBeUndefined()
  })

  it('reads any session of its project whole, still not stopping or sending to the user’s', async () => {
    useDispatch.setState({ messages: { user1: 'The whole last message' } })
    expect(await call('lead', { name: 'read', id: 'user1', offset: 0 })).toMatchObject({ ok: true, text: expect.stringContaining('The whole last message') })
    expect(await call('lead', { name: 'read', id: 'nope', offset: 0 })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('lead', { name: 'send', id: 'user1', text: 'hi' })).toMatchObject({ ok: false, failure: 'not_found' })
  })

  it('adopts a user session after the user’s 开始: it reports to the leader and gets the task as a message', async () => {
    const asked = await call('lead', { name: 'adopt', id: 'user1', task: 'Finish the login form' })
    expect(asked).toMatchObject({ ok: true, text: expect.stringContaining("waits for the user's 开始") })
    expect(useDispatch.getState().confirms).toEqual([{ kind: 'adopt', callId: expect.any(String), parentId: 'lead', childId: 'user1', agent: 'claude', title: 'user1', branch: 'jacob/plan', task: 'Finish the login form' }])
    expect(await call('lead', { name: 'adopt', id: 'user1', task: 'Again' })).toMatchObject({ ok: false, failure: 'duplicate' })
    decideConfirms('lead', true)
    expect(addBackgroundSession).not.toHaveBeenCalled()
    expect(patchSession).toHaveBeenCalledWith('user1', { dispatchedBy: 'lead', dispatchTask: 'Finish the login form' })
    const [toChild, toLeader] = deliverMessage.mock.calls as unknown as [Session, string][]
    expect(toChild![0]).toMatchObject({ id: 'user1' })
    expect(toChild![1]).toContain('来自 leader「lead」')
    expect(toChild![1]).toContain('Finish the login form')
    expect(toLeader![0]).toMatchObject({ id: 'lead' })
    expect(toLeader![1]).toContain('- id user1 · claude · 「user1」')
    expect(toLeader![1]).toContain('已接管')
  })

  it('checks again at 开始: a session that dispatched two levels meanwhile is not adopted, and the leader hears why', async () => {
    await call('lead', { name: 'adopt', id: 'user1', task: 'Finish the login form' })
    // While the request waited, the user's session dispatched a session that dispatched one of its own.
    sessions.push(session('u-kid', { dispatchedBy: 'user1', kind: 'codex' }), session('u-grand', { dispatchedBy: 'u-kid', kind: 'codex' }))
    decideConfirms('lead', true)
    expect(patchSession).not.toHaveBeenCalled()
    expect(deliverMessage).toHaveBeenCalledTimes(1)
    const [to, text] = deliverMessage.mock.calls[0] as unknown as [Session, string]
    expect(to).toMatchObject({ id: 'lead' })
    expect(text).toContain('没能接管')
    expect(text).toContain('- 没有接管 user1「user1」：')
    expect(text).toContain('deeper than 2 levels')
    expect(text).not.toContain('已经开始')
  })

  it('says which adopt failed at 开始 next to the ones that went through: one exited, one closed', async () => {
    sessions.push(session('user2'), session('user3'))
    await call('lead', { name: 'adopt', id: 'user1', task: 'Finish the login form' })
    await call('lead', { name: 'adopt', id: 'user2', task: 'Fix the footer' })
    await call('lead', { name: 'adopt', id: 'user3', task: 'Bump deps' })
    sessions = sessions.filter((s) => s.id !== 'user3').map((s) => (s.id === 'user2' ? { ...s, phase: 'exited' as const } : s))
    decideConfirms('lead', true)
    expect(patchSession.mock.calls.map((c) => c[0])).toEqual(['user1'])
    const text = (deliverMessage.mock.calls.at(-1) as unknown as [Session, string])[1]
    expect(text).toContain('- id user1 · claude · 「user1」')
    expect(text).toContain('- 没有接管 user2「user2」：That session is archived or its agent has exited.')
    expect(text).toContain('- 没有接管 user3「user3」：That session was closed.')
  })

  it('refuses to adopt a session with a dispatcher, itself, a plain terminal, another project’s and a gone one', async () => {
    const adopt = (id: string) => call('lead', { name: 'adopt', id, task: 'Do it' })
    expect(await adopt('child')).toMatchObject({ ok: false, failure: 'not_allowed', text: expect.stringContaining('already reports') })
    expect(await adopt('lead')).toMatchObject({ ok: false, failure: 'not_allowed', text: 'That is your own session.' })
    expect(await adopt('term')).toMatchObject({ ok: false, failure: 'not_allowed', text: expect.stringContaining('plain terminal') })
    expect(await adopt('nope')).toMatchObject({ ok: false, failure: 'not_found' })
    sessions[1] = { ...sessions[1]!, phase: 'exited' }
    expect(await adopt('user1')).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(useDispatch.getState().confirms).toHaveLength(0)
  })

  it('refuses to adopt a member of a 同任务多解 group: it reports to the session the task came from', async () => {
    attemptGroups = [{ id: 'g1', members: ['user1'], reportTo: 'top' }]
    try {
      expect(await call('lead', { name: 'adopt', id: 'user1', task: 'Do it' })).toMatchObject({ ok: false, failure: 'not_allowed', text: expect.stringContaining('同任务多解') })
      expect(useDispatch.getState().confirms).toHaveLength(0)
    } finally {
      attemptGroups = []
    }
  })

  it('tells its sessions to ask in their reply, and puts a decision in front of the user with tell', async () => {
    await call('lead', runCmd('Write the tests', { agent: 'codex' }))
    expect(await call('lead', { name: 'tell', text: 'Merge A or B first?' })).toMatchObject({ ok: true, text: expect.stringContaining('End your turn') })
    expect(useDispatch.getState().tells.lead).toBe('Merge A or B first?')
    decideConfirms('lead', true)
    const launches = useDispatch.getState().launches
    const brief = Object.values(launches).find((l) => l?.initialPrompt.includes('Write the tests'))?.initialPrompt
    expect(brief).toContain('不要用提问工具')
  })
})

describe('wavi task and --task in a window (PRD F21 v1.246)', () => {
  let board: Task[] = []
  const update = vi.fn(async (id: string, patch: Partial<Task>) => {
    const at = board.findIndex((t) => t.id === id)
    if (at < 0) return null
    board[at] = { ...board[at]!, ...patch } as Task
    return board[at]!
  })
  const create = vi.fn(async (draft: TaskDraft) => {
    const made: Task = { id: `t${board.length + 1}`, seq: board.length + 1, projectId: draft.projectId, title: draft.title, body: draft.body ?? '', createdBy: draft.createdBy ?? 'user', manual: 'todo', createdAt: 1, updatedAt: 1, ...(draft.parentId ? { parentId: draft.parentId } : {}) }
    board.push(made)
    return made
  })
  const card = (seq: number, over: Partial<Task> = {}): Task => ({ id: `t${seq}`, seq, projectId: 'p1', title: `Card ${seq}`, body: '', createdBy: 'user', manual: 'todo', createdAt: seq, updatedAt: seq, ...over })

  beforeEach(() => {
    sessions = [session('lead'), session('kid', { dispatchedBy: 'lead', kind: 'codex', status: 'running' }), session('grand', { dispatchedBy: 'kid', kind: 'gemini' }), session('top')]
    leaderSessions = { p1: 'lead' }
    board = [card(1), card(2, { parentId: 't1', sessionId: 'kid' })]
    addBackgroundSession.mockClear()
    deliverMessage.mockClear()
    patchSession.mockClear()
    update.mockClear()
    create.mockClear()
    useDispatch.setState({ confirms: [], held: {}, reported: {}, tells: {}, messages: {}, launches: {} })
    vi.stubGlobal('document', { hasFocus: () => true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      tr: {
        app: { detectAgents: async () => ({ claude: true, codex: true, grok: true }) },
        gitWorktrees: { newSessionInfo: async () => ({ repo: true, currentBranch: 'main', defaultBranch: 'main', branches: [], prefix: 'jacob', worktreesDir: '/wt', takenFolders: [], includeCount: 0, hasSetup: false }) },
        git: { changes: async () => null },
        ui: { notify: () => {} },
        tasks: { list: async () => board.map((t) => ({ ...t })), create, update }
      }
    })
    setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  })
  afterEach(() => {
    leaderSessions = {}
    vi.unstubAllGlobals()
  })

  it('starts a session for a card without asking, binds it and names the card in its brief', async () => {
    const result = await call('lead', runCmd('Build the form', { agent: 'claude', card: 1 }))
    expect(result).toMatchObject({ ok: true, text: expect.stringContaining('bound to card #1') })
    expect(useDispatch.getState().confirms).toHaveLength(0)
    const childId = addBackgroundSession.mock.calls[0]![3]
    expect(update).toHaveBeenCalledWith('t1', { sessionId: childId })
    expect(Object.values(useDispatch.getState().launches).find((l) => l?.initialPrompt.includes('Build the form'))?.initialPrompt).toContain('#1')
  })

  it('still asks for a run without --task, and still obeys the duplicate rule for one with it', async () => {
    await call('top', runCmd('Plain task'))
    expect(useDispatch.getState().confirms).toHaveLength(1)
    // `kid` is the lead's open session with this task already.
    sessions = sessions.map((s) => (s.id === 'kid' ? { ...s, dispatchTask: 'Same words' } : s))
    expect(await call('lead', runCmd('Same words', { card: 1 }))).toMatchObject({ ok: false, failure: 'duplicate' })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('refuses --task for a card the caller may not hand out', async () => {
    expect(await call('top', runCmd('x', { card: 1 }))).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('lead', runCmd('x', { card: 9 }))).toMatchObject({ ok: false, failure: 'not_found' })
    // The card already has the session kid.
    expect(await call('lead', runCmd('x', { card: 2 }))).toMatchObject({ ok: false, failure: 'duplicate' })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('adds cards under the caller’s bound card, a root only for the leader, and nothing at the last level', async () => {
    expect(await call('kid', { name: 'task-add', title: 'Form' })).toMatchObject({ ok: true, text: expect.stringContaining('under #2') })
    expect(create).toHaveBeenLastCalledWith({ projectId: 'p1', title: 'Form', parentId: 't2', createdBy: 'kid' })
    expect(await call('top', { name: 'task-add', title: 'Root' })).toMatchObject({ ok: false, text: expect.stringContaining('--parent') })
    expect(await call('lead', { name: 'task-add', title: 'Root' })).toMatchObject({ ok: true })
    expect(create).toHaveBeenLastCalledWith({ projectId: 'p1', title: 'Root', createdBy: 'lead' })
    expect(await call('grand', { name: 'task-add', title: 'x', parent: 2 })).toMatchObject({ ok: false, text: expect.stringContaining("can't split further") })
  })

  it('lets an agent finish its card and refuses another’s', async () => {
    expect(await call('kid', { name: 'task-update', seq: 2, note: 'form is in', done: true })).toMatchObject({ ok: true })
    expect(update).toHaveBeenCalledWith('t2', { note: 'form is in', manual: 'done' })
    expect(await call('kid', { name: 'task-update', seq: 1, done: true })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('lead', { name: 'task-update', seq: 1, cancel: true })).toMatchObject({ ok: true })
    expect(update).toHaveBeenLastCalledWith('t1', { manual: 'canceled' })
  })

  it('lists the project’s cards with their states', async () => {
    const listed = await call('top', { name: 'task-ls' })
    expect(listed.text).toContain('#1 · "Card 1" · not started')
    expect(listed.text).toContain('#2 · "Card 2" · working · session kid "kid" · under #1')
  })
})
