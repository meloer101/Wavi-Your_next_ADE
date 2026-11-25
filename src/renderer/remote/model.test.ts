import { describe, expect, it } from 'vitest'
import type { Project, Session, Worktree } from '@shared/types'
import { EMPTY_TEXTS, fail, startState, toGlance } from '../pull-requests/ship-flow'
import { groupsOf, type SideItem } from '../sidebar/model'
import { agentModels, remoteContext, remoteSessions, remoteShip, remoteUsage, sessionUsageVendor } from './model'

const project: Project = { id: 'p1', name: 'acme-web', rootPath: '/code/acme' }
const main: Worktree = { id: 'w0', projectId: 'p1', branch: 'main', path: '/code/acme', isMain: true }
const tree: Worktree = { id: 'w1', projectId: 'p1', branch: 'jacob/refresh', path: '/wt/refresh', isMain: false, baseBranch: 'main' }
const gone: Worktree = { ...tree, id: 'w2', path: '/wt/old', archived: { at: 1 } as Worktree['archived'] }
const session = (o: Partial<Session>): Session => ({ id: 's', worktreeId: 'w1', kind: 'claude', title: 't', status: 'idle', startedAt: 0, lastActivityAt: 5, ...o })

describe('remoteSessions', () => {
  it('lists agent sessions with what the phone row shows, and keeps folders and roots for main', () => {
    const list = remoteSessions({
      projects: [project],
      worktrees: [main, tree, gone],
      sessions: [
        session({ id: 's1', title: '会话过期自动续期', status: 'running', currentAction: '编辑 src/a.ts', statusSince: 3, agentSessionId: 'abc-1', dispatchModel: 'Opus 5.5' }),
        session({ id: 's2', worktreeId: 'w0', kind: 'shell' }),
        session({ id: 's3', worktreeId: 'w2' }),
        session({ id: 's4', worktreeId: 'w0', kind: 'codex', lastReply: 'DONE' })
      ]
    })
    expect(list.projects).toEqual([{ id: 'p1', name: 'acme-web' }])
    expect(list.sessions).toEqual([
      { id: 's1', projectId: 'p1', title: '会话过期自动续期', agent: 'claude', status: 'running', activity: 5, action: '编辑 src/a.ts', since: 3, branch: 'jacob/refresh', model: 'Opus 5.5' },
      { id: 's4', projectId: 'p1', title: 't', agent: 'codex', status: 'idle', activity: 5, branch: 'main', reply: 'DONE' }
    ])
    expect(list.folders).toEqual({ s1: { cwd: '/wt/refresh', base: 'main', agentSession: 'abc-1' }, s4: { cwd: '/code/acme' } })
    expect(list.roots).toEqual({ p1: '/code/acme' })
  })

  it('carries the turn\'s checks, the worktree\'s size and the item it works on (PRD F22 v1.229 ⑤)', () => {
    const sized = { ...tree, added: 12, removed: 3 }
    const checks = { since: 1, edited: true, runs: [{ kind: 'test' as const, command: 'pnpm test', outcome: 'pass' as const, basis: 'exit' as const, full: true, at: 2 }], known: ['lint' as const] }
    const link = { repo: 'github.com/acme/web', kind: 'issue' as const, number: 139 }
    const list = remoteSessions(
      { projects: [project], worktrees: [sized], sessions: [session({ id: 's1', github: link })] },
      undefined,
      undefined,
      (s) => (s.id === 's1' ? checks : undefined)
    )
    expect(list.sessions[0]).toMatchObject({
      checks: { turn: 'current', edited: true, kinds: [{ kind: 'test', status: 'pass' }, { kind: 'lint', status: 'not-run' }] },
      stat: { added: 12, removed: 3 },
      github: link
    })
    // Nothing to say: no checks, no edits, no size and no item → the fields stay off.
    const quiet = remoteSessions({ projects: [project], worktrees: [tree], sessions: [session({ id: 's1' })] }, undefined, undefined, () => ({ since: 0, edited: false, runs: [], known: [] }))
    expect(quiet.sessions[0]).toMatchObject({ id: 's1' })
    expect(quiet.sessions[0]!.checks).toBeUndefined()
    expect(quiet.sessions[0]!.stat).toBeUndefined()
    expect(quiet.sessions[0]!.github).toBeUndefined()
  })
})

describe('remoteSessions groups (PRD v1.243)', () => {
  const parent = session({ id: 'p', title: '主会话', status: 'running' })
  const child = session({ id: 'c', title: '补测试', status: 'needs_you', dispatchedBy: 'p' })
  const grand = session({ id: 'g', title: '补边界', status: 'running', dispatchedBy: 'c' })
  const orphan = session({ id: 'o', title: '孤儿', dispatchedBy: 'not-listed' })
  const items: Record<string, SideItem[]> = {
    p: [
      { id: 'workflow:w1', title: '发版检查', kind: 'workflow', glyph: 'running', right: '1 / 3' },
      { id: 'phase:w1:0', title: '测试', kind: 'phase', glyph: 'running', right: '0 / 2' },
      { id: 'a1', title: '查调用点', model: 'Opus 5.5' }
    ],
    c: [{ id: 'teammate:t1', title: 'reviewer', kind: 'teammate', glyph: 'idle', right: 'Sonnet 5' }]
  }
  const data = { projects: [project], worktrees: [tree], sessions: [parent, child, grand, orphan] }

  it('sets parentId only when the dispatcher is listed, and group on a session with members', () => {
    const rows = Object.fromEntries(remoteSessions(data, undefined, undefined, undefined, undefined, undefined, items).sessions.map((r) => [r.id, r]))
    expect(rows.p!.parentId).toBeUndefined()
    expect(rows.c!.parentId).toBe('p')
    expect(rows.g!.parentId).toBe('c')
    expect(rows.o!.parentId).toBeUndefined()
    expect(rows.o!.group).toBeUndefined()
    expect(rows.g!.group).toBeUndefined()
  })

  it('lists direct members in the group order with their meta, and counts like the sidebar', () => {
    const rows = Object.fromEntries(remoteSessions(data, undefined, undefined, undefined, undefined, undefined, items).sessions.map((r) => [r.id, r]))
    expect(rows.p!.group!.members).toEqual([
      { id: 'c', kind: 'session', title: '补测试', status: 'needs_you' },
      { id: 'workflow:w1', kind: 'workflow', title: '发版检查', status: 'running', meta: '测试' },
      { id: 'a1', kind: 'subagent', title: '查调用点', status: 'running', meta: 'Opus 5.5' }
    ])
    expect(rows.c!.group!.members).toEqual([
      { id: 'g', kind: 'session', title: '补边界', status: 'running' },
      { id: 'teammate:t1', kind: 'teammate', title: 'reviewer', status: 'idle', meta: 'Sonnet 5' }
    ])
    for (const id of ['p', 'c']) {
      const want = groupsOf(data.sessions, items)[id]!
      expect(rows[id]!.group).toMatchObject({ total: want.total, counts: want.counts })
    }
    // Members at any depth: the child, the grandchild, the run, the subagent and the teammate.
    expect(rows.p!.group!.total).toBe(5)
  })

  it('hides local folders in member titles and meta, each under its own session\'s folders', () => {
    const leak: Record<string, SideItem[]> = {
      p: [
        { id: 'a1', title: '读 /wt/refresh/src/a.ts 和 /code/acme/README.md', model: '/wt/refresh/model' },
        { id: 'workflow:w1', title: '检查 /code/acme', kind: 'workflow', glyph: 'running', right: '1 / 2' },
        { id: 'phase:w1:0', title: '跑 /wt/refresh/test', kind: 'phase', glyph: 'running', right: '0 / 1' }
      ]
    }
    const named = session({ id: 'c', title: '改 /wt/refresh/x.ts', dispatchedBy: 'p' })
    const rows = remoteSessions({ projects: [project], worktrees: [tree], sessions: [parent, named] }, undefined, undefined, undefined, undefined, undefined, leak).sessions
    const members = rows.find((r) => r.id === 'p')!.group!.members
    expect(members.map((m) => m.title)).toEqual(['改 ./x.ts', '读 ./src/a.ts 和 ./README.md', '检查 acme'])
    expect(members.map((m) => m.meta)).toEqual([undefined, './model', '跑 ./test'])
    expect(JSON.stringify(members)).not.toContain('/wt/')
    expect(JSON.stringify(members)).not.toContain('/code/')
  })

  it('sends no group without members and counts only sessions the phone lists', () => {
    const plain = remoteSessions({ ...data, sessions: [parent, orphan] }).sessions
    expect(plain.every((r) => r.group === undefined && r.parentId === undefined)).toBe(true)
    // A dispatched session in an archived worktree is not listed, so it is no member.
    const archived = { ...tree, id: 'w9', archived: { at: 1 } as Worktree['archived'] }
    const out = remoteSessions({ projects: [project], worktrees: [tree, archived], sessions: [parent, { ...child, worktreeId: 'w9' }] }).sessions
    expect(out.map((r) => r.id)).toEqual(['p'])
    expect(out[0]!.group).toBeUndefined()
  })
})

describe('remoteShip', () => {
  // 合并 has no glance: 创建 PR is the exit with text to look at.
  const input = { kind: 'pr' as const, agent: 'Claude Code', base: 'main', branch: 'jacob/x', remote: 'origin', review: false }

  it('shows a run on the session row with its glance worked out, and how the last one ended', () => {
    const glance = toGlance(startState(input, '创建 PR'), { ...EMPTY_TEXTS, title: 'feat: refresh', body: 'Body' })
    const list = remoteSessions(
      { projects: [project], worktrees: [tree], sessions: [session({ id: 's1' })] },
      { ships: { '/wt/refresh': glance }, endings: {} }
    )
    expect(list.sessions[0]!.ship).toMatchObject({ kind: 'pr', stage: 'glance', fields: ['title', 'body', 'draft'], submitLabel: '推送并创建 PR', submitBlocker: null, texts: { title: 'feat: refresh', body: 'Body' } })
    const ended = remoteSessions({ projects: [project], worktrees: [tree], sessions: [session({ id: 's1' })] }, { ships: {}, endings: { '/wt/refresh': '已合并到 main · a41c9e2' } })
    expect(ended.sessions[0]!.shipNotice).toBe('已合并到 main · a41c9e2')
  })

  it('carries each session\'s 会话设置 when it has any (Figma 64B)', () => {
    const settings = { items: [{ kind: 'model' as const, current: 'opus', values: [{ value: 'opus', label: 'Opus 5.5' }] }] }
    const list = remoteSessions({ projects: [project], worktrees: [tree], sessions: [session({ id: 'a' }), session({ id: 'b' })] }, undefined, (s) => (s.id === 'a' ? settings : undefined))
    expect(list.sessions.map((s) => s.settings)).toEqual([settings, undefined])
  })

  it('cuts long text to what main accepts and keeps local folders out of messages', () => {
    const empty = toGlance(startState(input, '创建 PR'), EMPTY_TEXTS)
    const failed = fail(empty, { step: 'push', message: 'x'.repeat(3000), output: 'error in /wt/refresh/src/a.ts and /code/acme' })
    const ship = remoteShip(failed, ['/wt/refresh', '/code/acme'])
    expect(ship.error!.message).toHaveLength(2000)
    expect(ship.error!.output).toBe('error in ./src/a.ts and acme')
  })

  it('says what blocks the glance and what a failed step offers', () => {
    const empty = toGlance(startState(input, '创建 PR'), EMPTY_TEXTS)
    expect(remoteShip(empty).submitBlocker).toBe('写一个标题')
    const conflict = fail(startState({ ...input, kind: 'main' }, '合并到 main'), { step: 'merge', message: '合并有冲突', conflicts: ['a.ts'] })
    expect(remoteShip(conflict).error).toEqual({ step: 'merge', message: '合并有冲突', conflicts: true, pushRefused: false })
  })
})


describe('agentModels (新建会话 · 模型, Figma 67A)', () => {
  const opus = { value: 'opus', label: 'Opus 5.5' }
  const haiku = { value: 'haiku', label: 'Haiku 5.5' }

  it('lists what a session of the agent listed before, starting from its last pick', () => {
    expect(agentModels(true, { models: [opus, haiku], model: 'haiku' }, { models: [opus], current: 'opus' })).toEqual({ gui: true, models: [opus, haiku], current: 'haiku' })
  })

  it('falls back to what main asked the agent, and to its default when it names none it lists', () => {
    expect(agentModels(true, undefined, { models: [opus, haiku], current: 'opus' })).toEqual({ gui: true, models: [opus, haiku], current: 'opus' })
    expect(agentModels(true, { model: 'gone' }, { models: [opus] })).toEqual({ gui: true, models: [opus] })
  })

  it('has no row for a session that will run in a terminal, and only 默认 for an agent that lists none', () => {
    expect(agentModels(false, { models: [opus], model: 'opus' }, undefined)).toEqual({ gui: false, models: [] })
    expect(agentModels(true, undefined, undefined)).toEqual({ gui: true, models: [] })
  })
})

describe('context and usage for the phone (PRD F22 v1.230 ④)', () => {
  it('fills a session\'s context with the desktop\'s own high rule and mark', () => {
    const data = { projects: [project], worktrees: [tree], sessions: [session({ id: 's1' }), session({ id: 's2' })] }
    const list = remoteSessions(data, undefined, undefined, undefined, (s) => (s.id === 's1' ? { percent: 91, usedTokens: 182_000, windowTokens: 200_000, compactAt: 190_000, compactPercent: 95 } : undefined))
    expect(list.sessions[0]!.context).toEqual({ percent: 91, usedTokens: 182_000, windowTokens: 200_000, markPercent: 95, high: true })
    expect(list.sessions[1]!.context).toBeUndefined()
  })

  it('tells the phone which vendor\'s windows apply to a session', () => {
    const data = { projects: [project], worktrees: [tree], sessions: [session({ id: 's1' }), session({ id: 's2' })] }
    const list = remoteSessions(data, undefined, undefined, undefined, undefined, (s) => (s.id === 's1' ? 'codex' : undefined))
    expect(list.sessions[0]!.usageVendor).toBe('codex')
    expect(list.sessions[1]!.usageVendor).toBeUndefined()
  })

  it('picks the vendor as the desktop does: the running agent, else the kind, none off the plan', () => {
    expect(sessionUsageVendor({ kind: 'claude' })).toBe('claude')
    expect(sessionUsageVendor({ kind: 'shell' }, { agent: 'codex' })).toBe('codex')
    expect(sessionUsageVendor({ kind: 'claude' }, { agent: 'codex' })).toBe('codex')
    expect(sessionUsageVendor({ kind: 'shell' })).toBeUndefined()
    expect(sessionUsageVendor({ kind: 'claude' }, { plan: false })).toBeUndefined()
    expect(sessionUsageVendor({ kind: 'claude' }, { agent: 'claude', plan: false })).toBeUndefined()
  })

  it('works high and the mark out the way contextHigh and contextMark do', () => {
    // 20k before the compaction point; the mark only when the point is known; 80 % when it is not.
    expect(remoteContext({ percent: 50, usedTokens: 100_000, windowTokens: 200_000, compactAt: 150_000, compactPercent: 75 })).toEqual({ percent: 50, usedTokens: 100_000, windowTokens: 200_000, markPercent: 75, high: false })
    expect(remoteContext({ percent: 80 })).toEqual({ percent: 80, markPercent: 80, high: true })
    expect(remoteContext({ percent: 79 }).markPercent).toBe(80)
    expect(remoteContext({ percent: 140 }).percent).toBe(100)
  })

  it('lists a vendor only when it has live windows, with the plan label', () => {
    const now = 1_000_000
    const usage = { claude: { vendor: 'claude' as const, at: now, windows: [{ minutes: 300, percent: 62, resetsAt: now + 3_600_000 }, { minutes: 10080, scope: 'Sonnet', percent: 40 }] } }
    const accounts = { claude: { vendor: 'claude' as const, state: 'ok' as const, plan: 'max', at: now }, codex: { vendor: 'codex' as const, state: 'ok' as const, plan: 'chatgpt_plus', at: now } }
    expect(remoteUsage(usage, accounts, now)).toEqual([
      { vendor: 'claude', plan: 'Max', windows: [{ minutes: 300, percent: 62, resetsAt: now + 3_600_000 }, { minutes: 10080, scope: 'Sonnet', percent: 40 }] }
    ])
    expect(remoteUsage({}, {}, now)).toEqual([])
    // One window per identity, the first.
    const twice = { claude: { vendor: 'claude' as const, at: now, windows: [{ minutes: 300, percent: 62 }, { minutes: 300, percent: 10 }, { minutes: 300, scope: 'Sonnet', percent: 5 }] } }
    expect(remoteUsage(twice, {}, now)).toEqual([{ vendor: 'claude', windows: [{ minutes: 300, percent: 62 }, { minutes: 300, scope: 'Sonnet', percent: 5 }] }])
  })
})
