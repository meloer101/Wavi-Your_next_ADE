import { describe, expect, it } from 'vitest'
import type { Project, Session, SessionStatus, Worktree } from '@shared/types'
import {
  adjacentSessionId,
  buildSidebarGroups,
  nestedTitle,
  nextAttentionSessionId,
  pendingItems,
  pickSessions,
  teamItems,
  sameRow,
  sameSubagent,
  workflowItems,
  sessionForShortcut,
  visibleSessionIds
} from './model'

const projects: Project[] = [
  { id: 'pa', name: 'alpha', rootPath: '/a' },
  { id: 'pb', name: 'beta', rootPath: '/b' },
  { id: 'pc', name: 'empty', rootPath: '/c' }
]
const worktrees: Worktree[] = [
  { id: 'wa1', projectId: 'pa', branch: 'x/one', path: '/wt/one', isMain: false, added: 3, removed: 1 },
  { id: 'wa2', projectId: 'pa', branch: 'x/two', path: '/wt/two', isMain: false, added: 0, removed: 0 },
  { id: 'wam', projectId: 'pa', branch: 'main', path: '/a', isMain: true },
  { id: 'wb1', projectId: 'pb', branch: 'x/three', path: '/wt/three', isMain: false, added: 10, removed: 2 }
]

/** Every group the tests below draw is open: members are folded unless their session is listed (PRD v1.243). */
const OPEN = ['lead', 'parent', 'c1', 'c2', 's1']

function session(id: string, worktreeId: string, status: SessionStatus, lastActivityAt = 0, extra: Partial<Session> = {}): Session {
  return { id, worktreeId, kind: 'claude', title: id, status, startedAt: 0, lastActivityAt, ...extra }
}

describe('buildSidebarGroups', () => {
  it('groups by project in store order and keeps projects without sessions', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('s1', 'wa1', 'running'), session('s2', 'wb1', 'idle'), session('s3', 'wa2', 'running')]
    })
    expect(groups.map((g) => g.title)).toEqual(['alpha', 'beta', 'empty'])
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['s1', 's3'])
    expect(groups[2]).toMatchObject({ rows: [], sessionCount: 0 })
  })

  it('keeps every session under its own project, whatever its status', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('done', 'wa1', 'done_unread', 50),
        session('run', 'wa2', 'running', 100),
        session('err', 'wb1', 'error', 10),
        session('ask', 'wam', 'needs_you', 5)
      ]
    })
    expect(groups.map((g) => g.id)).toEqual(['pa', 'pb', 'pc'])
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['done', 'run', 'ask'])
    expect(groups[1]).toMatchObject({ rows: [{ session: { id: 'err' } }], sessionCount: 1 })
  })

  it('a collapsed project draws no rows but keeps its count and its most urgent attention status', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      collapsedProjectIds: ['pa'],
      sessions: [session('done', 'wa1', 'done_unread', 50), session('ask', 'wam', 'needs_you', 5), session('run', 'wa2', 'running')]
    })
    expect(groups[0]).toMatchObject({ collapsed: true, rows: [], sessionCount: 3, attention: 'needs_you' })
    expect(groups[1]).toMatchObject({ collapsed: false, attention: null })
  })

  it('derives secondary line, attention flag and branch', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('a', 'wa1', 'running', 0, { currentAction: '编辑 a.ts' }),
        session('b', 'wa2', 'running'),
        session('c', 'wam', 'idle')
      ]
    })
    const [a, b, c] = group?.rows ?? []
    expect(a).toMatchObject({ secondary: '编辑 a.ts', attention: false, branch: 'x/one' })
    expect(b).toMatchObject({ secondary: '', branch: 'x/two' })
    // The main checkout no longer spells out its folder: the project header names it (Figma 34P).
    expect(c).toMatchObject({ secondary: '', branch: 'main' })
    expect(a).not.toHaveProperty('stat')
  })

  it('a finished turn shows its last reply, marked while unread', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [
        session('u', 'wa1', 'done_unread', 0, { lastReply: '修好了登录' }),
        session('n', 'wa2', 'done_unread'),
        session('i', 'wam', 'idle', 0, { lastReply: '修好了登录' })
      ]
    })
    expect(group?.rows.map((r) => r.secondary)).toEqual(['已完成 · 修好了登录', '已完成 · 未读', '修好了登录'])
  })

  it('flags only needs_you as the attention variant', () => {
    const [group] = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('q', 'wa1', 'needs_you'), session('e', 'wa2', 'error')]
    })
    expect(group?.rows.map((r) => [r.session.id, r.attention])).toEqual([
      ['q', true],
      ['e', false]
    ])
  })
})

describe('leader session (PRD F21 v1.198, Figma 81A)', () => {
  it('writes leader before the branch on the leader’s third line, in both views', () => {
    const sessions = [session('lead', 'wam', 'idle'), session('kid', 'wa1', 'running', 0, { dispatchedBy: 'lead' })]
    const [alpha] = buildSidebarGroups({ projects, worktrees, sessions, expandedGroups: OPEN, leaderSessions: { pa: 'lead' } })
    expect(alpha?.rows.map((r) => [r.session.id, r.branch, r.depth])).toEqual([
      ['lead', 'leader · main', 0],
      ['kid', 'x/one', 1]
    ])
    const byStatus = buildSidebarGroups({ projects, worktrees, sessions, leaderSessions: { pa: 'lead' }, groupBy: 'status' })
    expect(byStatus.flatMap((g) => g.rows).find((r) => r.session.id === 'lead')?.branch).toBe('alpha › leader · main')
  })
})

describe('keyboard targets', () => {
  const sessions = [
    session('run1', 'wa1', 'running'),
    session('run2', 'wb1', 'running'),
    session('ask', 'wa2', 'needs_you'),
    session('err', 'wam', 'error')
  ]
  const groups = buildSidebarGroups({ projects, worktrees, sessions })
  // on-screen order: alpha (run1, ask, err) | beta (run2)
  it('orders visible sessions as drawn', () => {
    expect(visibleSessionIds(groups)).toEqual(['run1', 'ask', 'err', 'run2'])
  })

  it('maps ⌘1–⌘9 to the nth visible session', () => {
    expect(sessionForShortcut(groups, 1)).toBe('run1')
    expect(sessionForShortcut(groups, 4)).toBe('run2')
    expect(sessionForShortcut(groups, 5)).toBeNull()
    expect(sessionForShortcut(groups, 0)).toBeNull()
    expect(sessionForShortcut(groups, 10)).toBeNull()
  })

  it('skips the rows of a collapsed project for ⌘1–9', () => {
    const folded = buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds: ['pa'] })
    expect(sessionForShortcut(folded, 1)).toBe('run2')
  })

  it('cycles ⌘J through sessions needing attention, most urgent first, collapsed projects included', () => {
    expect(nextAttentionSessionId(sessions, 'run1')).toBe('ask')
    expect(nextAttentionSessionId(sessions, null)).toBe('ask')
    expect(nextAttentionSessionId(sessions, 'ask')).toBe('err')
    expect(nextAttentionSessionId(sessions, 'err')).toBe('ask')
  })

  it('has no ⌘J target without attention sessions', () => {
    expect(nextAttentionSessionId([session('r', 'wa1', 'running')], 'r')).toBeNull()
  })

  it('moves with ↑/↓, clamped at the ends', () => {
    expect(adjacentSessionId(groups, 'run1', 1)).toBe('ask')
    expect(adjacentSessionId(groups, 'run2', 1)).toBe('run2')
    expect(adjacentSessionId(groups, 'run1', -1)).toBe('run1')
    expect(adjacentSessionId(groups, null, 1)).toBe('run1')
    expect(adjacentSessionId(groups, null, -1)).toBe('run2')
    expect(adjacentSessionId([], 'x', 1)).toBeNull()
  })
})

describe('dispatched sessions (PRD F21)', () => {
  it('follow the session that started them, one step in; others keep store order', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [
        session('child-b', 'wa2', 'running', 0, { dispatchedBy: 'parent' }),
        session('parent', 'wam', 'idle'),
        session('other', 'wa1', 'idle'),
        session('child-a', 'wa1', 'idle', 0, { dispatchedBy: 'parent' }),
        session('orphan', 'wa1', 'idle', 0, { dispatchedBy: 'gone' })
      ]
    })
    expect(groups[0]?.rows.map((r) => `${r.session.id}:${r.depth}`)).toEqual(['parent:0', 'child-b:1', 'child-a:1', 'other:0', 'orphan:0'])
    // The line in the glyph column (Figma 40C): from the dispatcher, through each child, ending at the last.
    expect(groups[0]?.rows.map((r) => r.tree)).toEqual(['parent', 'child', 'last', undefined, undefined])
  })

  it('shows a nested 同任务多解 part by the name after its parent’s title', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [
        session('parent', 'wam', 'idle', 0, { title: 'Cookie 会话迁移' }),
        session('part', 'wa1', 'running', 0, { title: 'Cookie 会话迁移 · Codex', dispatchedBy: 'parent' })
      ]
    })
    expect(groups[0]?.rows.map((r) => r.title)).toEqual(['Cookie 会话迁移', 'Codex'])
    expect(nestedTitle('别的名字', 'Cookie 会话迁移')).toBe('别的名字')
    expect(nestedTitle('Cookie 会话迁移 · ', 'Cookie 会话迁移')).toBe('Cookie 会话迁移 · ')
  })
})

describe('subagents under their session (PRD F21 v1.109, Figma 44B)', () => {
  const sub = (id: string, title = id, model?: string) => ({ id, title, ...(model ? { model } : {}) })
  const draw = (rows: ReturnType<typeof buildSidebarGroups>[number]['rows']) =>
    rows.flatMap((r) => [
      `${r.session.id}:${r.depth}:${r.tree ?? '-'}${r.opens ? ':opens' : ''}`,
      ...(r.after ?? []).map((a) => `  ${a.id}:${a.depth}:${a.tree}${a.pass ? ':pass' : ''}${a.attention ? ':asks' : ''}`)
    ])

  it('hangs a top-level session’s subagents under it on its line, and keeps them out of the keyboard order', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [session('s1', 'wa1', 'running', 0, { askingAgents: ['a2'] }), session('s2', 'wa2', 'idle')],
      subagents: { s1: [sub('a1', '梳理 auth', 'Fable 5.1'), sub('a2')] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['s1:0:parent', '  a1:1:child', '  a2:1:last:asks', 's2:0:-'])
    expect(groups[0]!.rows[0]!.after?.[0]).toMatchObject({ sessionId: 's1', title: '梳理 auth', model: 'Fable 5.1' })
    expect(visibleSessionIds(groups)).toEqual(['s1', 's2'])
  })

  it('puts a dispatcher’s own subagents after its children, and a child’s one level in', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [
        session('parent', 'wam', 'running'),
        session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' }),
        session('c2', 'wa2', 'needs_you', 0, { dispatchedBy: 'parent', askingAgents: ['x'] })
      ],
      subagents: { parent: [sub('p1'), sub('p2')], c1: [sub('k')], c2: [sub('x')] }
    })
    expect(draw(groups[0]!.rows)).toEqual([
      'parent:0:parent',
      'c1:1:child:opens',
      '  k:2:last:pass',
      'c2:1:child:opens',
      // The dispatcher's line goes on past c2's subagent to its own two.
      '  x:2:last:pass:asks',
      '  p1:1:child',
      '  p2:1:last'
    ])
  })

  it('nests a grandchild under its own dispatcher one more step in, before that child’s subagents (Figma 44B)', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [
        session('parent', 'wam', 'running'),
        session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent', dispatchModel: 'gpt-6-sol' }),
        session('g1', 'wa2', 'running', 0, { dispatchedBy: 'c1', title: 'c1 · review', dispatchBase: 'snapshot' }),
        session('c2', 'wa2', 'idle', 0, { dispatchedBy: 'parent' })
      ],
      subagents: { c1: [sub('k')] }
    })
    const rows = groups[0]!.rows
    expect(rows.map((r) => `${r.session.id}:${r.depth}:${r.tree ?? '-'}${r.opens ? ':opens' : ''}${r.pass ? ':pass' : ''}`)).toEqual([
      'parent:0:parent',
      'c1:1:child:opens',
      'g1:2:child:pass',
      'c2:1:last'
    ])
    expect(rows[2]!.after?.map((a) => `${a.id}:${a.depth}:${a.tree}${a.pass ? ':pass' : ''}`)).toEqual(['k:2:last:pass'])
    expect(rows[1]!.model).toBe('gpt-6-sol')
    expect(rows[2]!.title).toBe('review')
    expect(rows[2]!.branch).toBe('快照')
    expect(visibleSessionIds(groups)).toEqual(['parent', 'c1', 'g1', 'c2'])
  })

  it('hangs the sessions a wavi run waits to start after the dispatcher’s children, on its line (Figma 83B)', () => {
    const plan = (title: string) => ({ item: { title } }) as never
    const waiting = pendingItems([
      { childId: 'n1', parentId: 'parent', plan: plan('登录页 e2e') },
      { childId: 'n2', parentId: 'parent', plan: plan('Safari 用例') },
      { childId: 'n3', parentId: 'c1', plan: plan('review') }
    ])
    expect(waiting.parent?.map((w) => `${w.id} ${w.title} ${w.kind} ${w.right}`)).toEqual(['pending:n1 登录页 e2e pending 待开始', 'pending:n2 Safari 用例 pending 待开始'])
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [session('parent', 'wam', 'needs_you'), session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' })],
      subagents: { parent: [...(waiting.parent ?? []), sub('p1')], c1: waiting.c1 ?? [] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['parent:0:parent', 'c1:1:child:opens', '  pending:n3:2:last:pass', '  pending:n1:1:child', '  pending:n2:1:child', '  p1:1:last'])
    // Waiting is not asking: the row is never the attention variant, and no keyboard stop.
    expect(groups[0]!.rows[1]!.after?.[0]).toMatchObject({ kind: 'pending', attention: false })
    expect(visibleSessionIds(groups)).toEqual(['parent', 'c1'])
  })

  it('hangs an agent team under its lead after its tree, a head line then a row per teammate (Figma 82′F)', () => {
    const team = {
      startedAt: 0,
      members: [
        { name: 'lead', agentId: '', state: 'idle' as const, spans: [] },
        { name: 'coder', agentId: 'acoder', model: 'Sonnet 5.5', state: 'working' as const, action: '编辑 refund.ts', spans: [] },
        { name: 'docs', agentId: 'adocs', state: 'asking' as const, action: '写入 docs/pay.md', spans: [] }
      ],
      messages: []
    }
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [session('lead', 'wam', 'running'), session('c1', 'wa1', 'running', 0, { dispatchedBy: 'lead' })],
      subagents: { lead: [...teamItems(team), sub('p1')] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['lead:0:parent', 'c1:1:child', '  p1:1:last', '  team:1:child', '  teammate:acoder:1:child', '  teammate:adocs:1:last:asks'])
    const rows = groups[0]!.rows[1]!.after!
    expect(rows.map((r) => `${r.kind}|${r.title}|${r.glyph ?? '-'}|${r.right ?? '-'}|${r.detail ?? '-'}`)).toEqual([
      'undefined|p1|-|-|-',
      'team|队伍 · 2 人|-|-|-',
      'teammate|coder|running|Sonnet 5.5|编辑 refund.ts',
      'teammate|docs|needs_you|-|等你确认：写入 docs/pay.md'
    ])
    expect(teamItems(undefined)).toEqual([])
  })

  it('ends the dispatcher’s line at its last child when it has no subagents of its own', () => {
    const groups = buildSidebarGroups({
      projects,
      worktrees,
      expandedGroups: OPEN,
      sessions: [session('parent', 'wam', 'idle'), session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' })],
      subagents: { c1: [sub('k')] }
    })
    expect(draw(groups[0]!.rows)).toEqual(['parent:0:parent', 'c1:1:last:opens', '  k:2:last'])
  })

  it('does not redraw the session row when only its subagents change, but does when its line starts', () => {
    const parent = session('parent', 'wam', 'running')
    const child = session('c1', 'wa1', 'running', 0, { dispatchedBy: 'parent' })
    const rows = (subagents: Record<string, ReturnType<typeof sub>[]>) =>
      buildSidebarGroups({ projects, worktrees, sessions: [parent, child], expandedGroups: OPEN, subagents })[0]!.rows
    const one = rows({ c1: [sub('a', 'one')] })
    const named = rows({ c1: [sub('a', 'one', 'Opus 5.5')] })
    const none = rows({})
    // SubagentRow compares its own row; the session row draws only where its line starts.
    expect(sameRow(one[1]!, named[1]!)).toBe(true)
    expect(sameRow(one[1]!, none[1]!)).toBe(false)
    expect(sameSubagent(one[1]!.after![0]!, named[1]!.after![0]!)).toBe(false)
  })
})

describe('sameRow', () => {
  const rows = (sessions: Session[], trees = worktrees) => buildSidebarGroups({ projects, worktrees: trees, sessions })[0]!.rows

  it('treats a rebuilt row of an untouched session as the same, and a touched one as different', () => {
    const s1 = session('s1', 'wa1', 'running')
    const s3 = session('s3', 'wa2', 'running')
    const before = rows([s1, s3])
    // An agent's hook event replaces one session object; the store keeps the others.
    const after = rows([{ ...s1, lastActivityAt: 5 }, s3])
    expect(after[1]).not.toBe(before[1])
    expect(sameRow(before[1]!, after[1]!)).toBe(true)
    expect(sameRow(before[0]!, after[0]!)).toBe(false)
  })

  it('notices a changed branch from the worktree', () => {
    const s1 = session('s1', 'wa1', 'running')
    const before = rows([s1])
    const after = rows([s1], worktrees.map((w) => (w.id === 'wa1' ? { ...w, branch: 'x/renamed' } : w)))
    expect(sameRow(before[0]!, after[0]!)).toBe(false)
  })
})

describe('按状态 view (PRD §3.3, Figma 53C)', () => {
  const sessions = [
    session('a-run', 'wa1', 'running', 90),
    session('b-ask', 'wb1', 'needs_you', 10),
    session('a-done', 'wa2', 'done_unread', 50),
    session('a-ask', 'wam', 'needs_you', 80),
    session('b-idle', 'wb1', 'idle'),
    session('a-child', 'wa2', 'running', 0, { dispatchedBy: 'a-run' })
  ]

  it('groups by status, most urgent first, and leaves out statuses nobody has', () => {
    const groups = buildSidebarGroups({ projects, worktrees, sessions, groupBy: 'status' })
    expect(groups.map((g) => [g.id, g.title])).toEqual([
      ['status:needs_you', '等你处理'],
      ['status:done_unread', '已完成'],
      ['status:running', '运行中'],
      ['status:idle', '空闲']
    ])
    expect(groups.every((g) => g.kind === 'status' && g.attention === null)).toBe(true)
  })

  it('keeps the 按项目 order inside a group, whatever the activity times', () => {
    const groups = buildSidebarGroups({ projects, worktrees, sessions, groupBy: 'status' })
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['a-ask', 'b-ask'])
    expect(visibleSessionIds(groups)).toEqual(['a-ask', 'b-ask', 'a-done', 'a-run', 'a-child', 'b-idle'])
  })

  it('draws rows flat and names the project before the branch', () => {
    const groups = buildSidebarGroups({ projects, worktrees, sessions, groupBy: 'status' })
    const running = groups.find((g) => g.status === 'running')!
    expect(running.rows.map((r) => [r.session.id, r.depth, r.tree, r.branch])).toEqual([
      ['a-run', 0, undefined, 'alpha › x/one'],
      ['a-child', 0, undefined, 'alpha › x/two']
    ])
    const outsideGit = buildSidebarGroups({
      projects,
      worktrees: [{ id: 'wb1', projectId: 'pb', branch: '', path: '/b', isMain: true }],
      sessions: [session('plain', 'wb1', 'idle')],
      groupBy: 'status'
    })
    expect(outsideGit[0]?.rows[0]?.branch).toBe('beta')
  })

  it('folds a session’s own subagents under it, and draws them once its group is open', () => {
    const input = { projects, worktrees, sessions, groupBy: 'status' as const, subagents: { 'a-run': [{ id: 'ag1', title: '扫描', model: 'Opus 5.5' }] } }
    const folded = buildSidebarGroups(input).find((g) => g.status === 'running')!.rows[0]!
    expect(folded.after).toBeUndefined()
    expect(folded.fold).toMatchObject({ ownerId: 'a-run', expanded: false, total: 1, counts: [{ status: 'running', count: 1 }] })
    const open = buildSidebarGroups({ ...input, expandedGroups: ['a-run'] }).find((g) => g.status === 'running')!.rows[0]!
    expect(open).toMatchObject({ tree: 'parent', after: [{ id: 'ag1', depth: 1, tree: 'last' }], fold: { expanded: true } })
  })

  it('folds a collapsed status group: no rows, its count kept, its rows out of ⌘1–9', () => {
    const groups = buildSidebarGroups({ projects, worktrees, sessions, groupBy: 'status', collapsedStatusGroups: ['needs_you'] })
    expect(groups[0]).toMatchObject({ status: 'needs_you', collapsed: true, rows: [], sessionCount: 2 })
    expect(sessionForShortcut(groups, 1)).toBe('a-done')
  })

  it('lists only sessions of the listed projects and skips archived worktrees', () => {
    const onlyBeta = buildSidebarGroups({ projects: projects.filter((p) => p.id === 'pb'), worktrees, sessions, groupBy: 'status' })
    expect(visibleSessionIds(onlyBeta)).toEqual(['b-ask', 'b-idle'])
    const archive = { id: 'x', at: 0, commit: 'c' } as Worktree['archived']
    const archived = buildSidebarGroups({
      projects,
      worktrees: worktrees.map((w) => (w.id === 'wa1' ? { ...w, archived: archive } : w)),
      sessions,
      groupBy: 'status'
    })
    expect(visibleSessionIds(archived)).not.toContain('a-run')
  })
})

describe('workflow runs under their session (PRD F25, Figma 74D)', () => {
  const run = (status: 'running' | 'completed', key = 'wf_abcdef12'): import('@shared/workflow-run').WorkflowRun => ({
    key,
    name: 'auth',
    status,
    phases: [{ title: '调研' }, { title: '改写' }, { title: '核对' }],
    agents: [
      { label: 'a', phase: 0, state: 'done' },
      { label: 'b', phase: 1, state: 'done' },
      { label: 'c', phase: 1, state: status === 'running' ? 'running' : 'done' }
    ]
  })

  it('lists a live run with the current phase and its phases; folded, only the run', () => {
    const lines = workflowItems([run('running')], { unread: false, folded: new Set() })
    expect(lines.map((l) => [l.kind, l.title, l.glyph, l.right])).toEqual([
      ['workflow', 'auth', 'running', '1 / 2'],
      ['phase', '调研', 'done_unread', '1 / 1'],
      ['phase', '改写', 'running', '1 / 2'],
      ['phase', '核对', 'idle', '—']
    ])
    expect(workflowItems([run('running')], { unread: false, folded: new Set(['wf_abcdef12']) })).toHaveLength(1)
  })

  it('keeps an ended run only while the turn is unread', () => {
    expect(workflowItems([run('completed')], { unread: true, folded: new Set() })[0]).toMatchObject({ glyph: 'done_unread', right: '3 / 3' })
    expect(workflowItems([run('completed')], { unread: false, folded: new Set() })).toEqual([])
  })
})

describe('pickSessions (issue #6)', () => {
  const ordered = ['a', 'b', 'c', 'd', 'e']
  const pick = (picked: string[], anchor: string | null, active: string | null, id: string, how: 'range' | 'toggle') =>
    pickSessions({ ordered, picked, anchor, active, id, how })

  it('⇧ picks from the row clicked last to the clicked one, both ends included, in drawn order', () => {
    expect(pick([], 'b', 'b', 'd', 'range')).toEqual(['b', 'c', 'd'])
    expect(pick([], 'd', 'd', 'a', 'range')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('⇧ starts at the active session until a row was clicked', () => {
    expect(pick([], null, 'c', 'e', 'range')).toEqual(['c', 'd', 'e'])
    expect(pick([], null, null, 'c', 'range')).toEqual(['c'])
  })

  it('⇧ adds to what is already picked', () => {
    expect(pick(['a'], 'c', 'a', 'e', 'range')).toEqual(['a', 'c', 'd', 'e'])
  })

  it('⌘ toggles one row; the active row counts as picked when picking starts', () => {
    expect(pick([], 'b', 'b', 'd', 'toggle')).toEqual(['b', 'd'])
    expect(pick(['b', 'd'], 'd', 'b', 'b', 'toggle')).toEqual(['d'])
    expect(pick([], 'b', 'b', 'b', 'toggle')).toEqual(['b'])
  })

  it('rows no longer drawn (closed, folded) drop out, and a hidden anchor falls back to the active row', () => {
    expect(pick(['x', 'b'], 'x', 'b', 'c', 'toggle')).toEqual(['b', 'c'])
    expect(pick([], 'x', 'a', 'c', 'range')).toEqual(['a', 'b', 'c'])
  })
})

describe('collaboration groups fold their members (PRD v1.243)', () => {
  const sub = (id: string) => ({ id, title: id })
  const family = [
    session('parent', 'wam', 'idle'),
    session('c1', 'wa1', 'needs_you', 0, { dispatchedBy: 'parent' }),
    session('g1', 'wa2', 'running', 0, { dispatchedBy: 'c1' }),
    session('c2', 'wa2', 'idle', 0, { dispatchedBy: 'parent' })
  ]
  const build = (expandedGroups: string[], extra: Partial<Parameters<typeof buildSidebarGroups>[0]> = {}) =>
    buildSidebarGroups({ projects, worktrees, sessions: family, subagents: { parent: [sub('p1')], c1: [sub('k')] }, expandedGroups, ...extra })

  it('draws one fold row under a new group and no members, counting every descendant', () => {
    const rows = build([])[0]!.rows
    expect(rows.map((r) => r.session.id)).toEqual(['parent'])
    expect(rows[0]).toMatchObject({ fold: { ownerId: 'parent', expanded: false, total: 5, line: false } })
    expect(rows[0]!.fold!.counts).toEqual([
      { status: 'needs_you', count: 1 },
      { status: 'running', count: 3 },
      { status: 'idle', count: 1 }
    ])
    expect(rows[0]!.tree).toBeUndefined()
    expect(rows[0]!.after).toBeUndefined()
  })

  it('opens one level: a member with members of its own shows its own folded row, one level deeper', () => {
    const rows = build(['parent'])[0]!.rows
    expect(rows.map((r) => `${r.session.id}:${r.depth}`)).toEqual(['parent:0', 'c1:1', 'c2:1'])
    expect(rows[0]!.fold).toMatchObject({ expanded: true, depth: 1, line: true })
    expect(rows[1]!.fold).toMatchObject({ ownerId: 'c1', expanded: false, depth: 2, total: 2, line: false })
    expect(rows[1]!.opens).toBeUndefined()
    expect(rows[2]!.fold).toBeUndefined()
    // The dispatcher's own subagent is drawn after its children, on its line.
    expect(rows[2]!.after?.map((a) => a.id)).toEqual(['p1'])
    expect(rows.map((r) => r.tree)).toEqual(['parent', 'child', 'child'])
  })

  it('opens a member’s group on its own', () => {
    const rows = build(['parent', 'c1'])[0]!.rows
    expect(rows.map((r) => `${r.session.id}:${r.depth}`)).toEqual(['parent:0', 'c1:1', 'g1:2', 'c2:1'])
    expect(rows[1]!.fold).toMatchObject({ expanded: true, depth: 2, line: true, pass: true })
    expect(rows[2]!.after?.map((a) => a.id)).toEqual(['k'])
  })

  it('keeps ⌘1–9 and ↑↓ off folded members, and leaves ⌘J on them', () => {
    const groups = build([])
    expect(visibleSessionIds(groups)).toEqual(['parent'])
    expect(sessionForShortcut(groups, 2)).toBeNull()
    expect(nextAttentionSessionId(family, 'parent')).toBe('c1')
    expect(visibleSessionIds(build(['parent']))).toEqual(['parent', 'c1', 'c2'])
  })

  it('↑/↓ from a member hidden by a fold start at its nearest visible dispatcher', () => {
    const groups = build([])
    const above = ['c1', 'parent']
    expect(adjacentSessionId(groups, 'g1', 1, above)).toBe('parent')
    expect(adjacentSessionId(groups, 'g1', -1, above)).toBe('parent')
    const open = build(['parent'])
    // c1 is drawn, g1 is not: down from g1 continues after c1.
    expect(adjacentSessionId(open, 'g1', 1, above)).toBe('c2')
    expect(adjacentSessionId(open, 'g1', -1, above)).toBe('parent')
    expect(adjacentSessionId(open, 'g1', 1)).toBe('parent')
  })

  it('does not fold a pending confirm: it stays under the session that asked', () => {
    const plan = { item: { title: '登录页 e2e' } } as never
    const rows = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('parent', 'wam', 'idle')],
      subagents: pendingItems([{ childId: 'n1', parentId: 'parent', plan }])
    })[0]!.rows
    expect(rows[0]!.fold).toBeUndefined()
    expect(rows[0]!.after?.map((a) => a.id)).toEqual(['pending:n1'])
    // With members as well, the confirm stays while the members fold.
    const both = buildSidebarGroups({
      projects,
      worktrees,
      sessions: [session('parent', 'wam', 'idle')],
      subagents: { parent: [...(pendingItems([{ childId: 'n1', parentId: 'parent', plan }]).parent ?? []), sub('p1')] }
    })[0]!.rows[0]!
    expect(both.fold).toMatchObject({ total: 1, expanded: false, line: true })
    expect(both.after?.map((a) => a.id)).toEqual(['pending:n1'])
    expect(both.tree).toBe('parent')
  })

  it('counts a workflow run and a teammate, not its phases or the team heading', () => {
    const team = {
      startedAt: 0,
      members: [{ name: 'docs', agentId: 'adocs', state: 'asking' as const, action: '写入', spans: [] }],
      messages: []
    }
    const run = workflowItems(
      [{ key: 'r1', name: 'review', agents: [], phases: [{ title: 'one', agents: [] }] } as never],
      { unread: true, folded: new Set() }
    )
    const row = buildSidebarGroups({ projects, worktrees, sessions: [session('lead', 'wam', 'idle')], subagents: { lead: [...teamItems(team), ...run] } })[0]!.rows[0]!
    expect(row.fold?.total).toBe(2)
    expect(row.fold?.counts.map((c) => c.status)).toEqual(['needs_you', 'running'])
  })

  it('draws the same fold row and rows for the same input, so memoized rows hold', () => {
    expect(sameRow(build(['parent'])[0]!.rows[0]!, build(['parent'])[0]!.rows[0]!)).toBe(true)
    expect(sameRow(build(['parent'])[0]!.rows[0]!, build([])[0]!.rows[0]!)).toBe(false)
  })
})
