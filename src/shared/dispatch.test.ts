import { describe, expect, it } from 'vitest'
import { withLang } from './i18n'
import { CLI_AGENTS } from './agents'
import { agentArgv } from './agent-launch'
import {
  ackReport,
  adoptBrief,
  adoptRefusal,
  canLead,
  canLeadCard,
  leaderBlock,
  leaderLaunchArgs,
  tellLabel,
  wakesThisHour,
  WAVI_LEADER_PROMPT,
  WAVI_HELP,
  WAVI_SKILL,
  childBrief,
  childEvent,
  childUi,
  confirmHead,
  confirmLabels,
  DISPATCH_LIMITS,
  emptyQueue,
  enqueueReport,
  looksLikeReport,
  maySendNow,
  messagePage,
  noticeText,
  parseNoticeText,
  parseReportText,
  parseWaviArgv,
  parseWaviCommand,
  parseWaviResult,
  planChild,
  reportChannelOf,
  reportText,
  startRefusal,
  systemPromptArgs,
  takeAll,
  takeDue,
  titleFor,
  waviRunIds,
  isWaviRun,
  type ChildReport
} from './dispatch'

describe('who can take part (PRD F21 覆盖)', () => {
  it('lets every CLI dispatch and be dispatched, each with the channel its status allows', () => {
    expect(CLI_AGENTS.every((kind) => parseWaviCommand({ name: 'run', agent: kind, task: 'x' }).ok)).toBe(true)
    expect(reportChannelOf('claude')).toBe('claude-inbox')
    expect(reportChannelOf('codex')).toBe('codex-queue')
    expect(reportChannelOf('pi')).toBe('pi-extension')
    expect(['gemini', 'qwen', 'grok', 'crush', 'goose', 'opencode'].map((k) => reportChannelOf(k as 'grok'))).toEqual(Array(6).fill('send'))
    const manual = ['copilot', 'cursor', 'kimi', 'droid', 'amp', 'kiro', 'cline', 'antigravity', 'auggie', 'codebuddy'] as const
    expect(manual.map(reportChannelOf)).toEqual(Array(10).fill('manual'))
  })

  it('tells the top-level agent about wavi in each CLI’s own way, and nothing for the rest', () => {
    expect(systemPromptArgs('claude', 'w')).toEqual(['--append-system-prompt', 'w'])
    expect(systemPromptArgs('pi', 'w')).toEqual(['--append-system-prompt', 'w'])
    expect(systemPromptArgs('grok', 'w')).toEqual(['--rules', 'w'])
    expect(systemPromptArgs('codex', 'say "hi"')).toEqual(['-c', 'developer_instructions="say \\"hi\\""'])
    expect(systemPromptArgs('cursor', 'w')).toBeNull()
  })
})

describe('parseWaviArgv → parseWaviCommand', () => {
  const command = (...argv: string[]) => {
    const args = parseWaviArgv(argv)
    return args.kind === 'command' ? parseWaviCommand(args.command) : args
  }

  it('reads wavi schedule, schedules and unschedule (PRD F24)', () => {
    expect(command('schedule', 'check', 'CI', '--every', '30m')).toEqual({ ok: true, command: { name: 'schedule', text: 'check CI', when: { every: 30 } } })
    expect(command('schedule', 'weekly', 'notes', '--weekdays=09:00', '--new', 'codex', '--title', 'Notes')).toEqual({
      ok: true,
      command: { name: 'schedule', text: 'weekly notes', when: { weekdays: '09:00' }, title: 'Notes', agent: 'codex' }
    })
    expect(command('schedule', 'x', '--every', '5m')).toMatchObject({ ok: false })
    expect(command('schedule', 'x', '--every', '30m', '--daily', '09:00')).toMatchObject({ ok: false })
    expect(command('schedule', 'x', '--at', '25:00')).toMatchObject({ ok: false })
    expect(command('schedule', 'x', '--new', 'nope', '--at', '14:30')).toMatchObject({ ok: false })
    expect(command('schedules')).toEqual({ ok: true, command: { name: 'schedules' } })
    expect(command('unschedule', 'abc-1')).toEqual({ ok: true, command: { name: 'unschedule', id: 'abc-1' } })
  })

  it('reads each command with its flags, in any order', () => {
    expect(command('run', 'grok', 'Review', 'src/auth', '--base', 'snapshot', '--model=grok-4.7', '--title', 'Auth review')).toEqual({
      ok: true,
      command: { name: 'run', agent: 'grok', task: 'Review src/auth', base: 'snapshot', title: 'Auth review', model: 'grok-4.7' }
    })
    expect(command('run', 'codex', 'Fix it')).toEqual({ ok: true, command: { name: 'run', agent: 'codex', task: 'Fix it', base: 'head' } })
    expect(command('run', 'codex', 'Fix it', '--ui', 'gui')).toEqual({ ok: true, command: { name: 'run', agent: 'codex', task: 'Fix it', base: 'head', ui: 'gui' } })
    expect(command('run', 'codex', 'Fix it', '--ui=cli')).toEqual({ ok: true, command: { name: 'run', agent: 'codex', task: 'Fix it', base: 'head', ui: 'cli' } })
    expect(command('send', 's-1', 'one more thing')).toEqual({ ok: true, command: { name: 'send', id: 's-1', text: 'one more thing' } })
    expect(command('report', 'Done.', 'Tests pass.')).toEqual({ ok: true, command: { name: 'report', text: 'Done. Tests pass.' } })
    expect(command('read', 's-1', '--offset', '16000')).toEqual({ ok: true, command: { name: 'read', id: 's-1', offset: 16000 } })
    expect(command('ls')).toEqual({ ok: true, command: { name: 'ls' } })
    expect(command('stop', 's-1')).toEqual({ ok: true, command: { name: 'stop', id: 's-1' } })
  })

  it('takes - as text from stdin, and knows --skill, --help and --json', () => {
    expect(parseWaviArgv(['run', 'claude', '-'])).toEqual({ kind: 'command-stdin', command: { name: 'run', agent: 'claude' }, field: 'task', json: false })
    expect(parseWaviArgv(['--skill'])).toEqual({ kind: 'skill' })
    expect(parseWaviArgv([])).toEqual({ kind: 'help' })
    expect(parseWaviArgv(['ls', '--json'])).toEqual({ kind: 'command', command: { name: 'ls' }, json: true })
  })

  it('refuses an unknown agent, flag or command, a bad model, an empty task and Wavi’s own messages as a task', () => {
    expect(command('run', 'chatgpt', 'x')).toMatchObject({ ok: false })
    expect(parseWaviArgv(['ls', '--model', 'x'])).toMatchObject({ kind: 'error' })
    expect(parseWaviArgv(['merge'])).toMatchObject({ kind: 'error' })
    expect(command('run', 'claude', 'x', '--model', '--evil')).toMatchObject({ ok: false })
    expect(command('run', 'claude', 'x', '--model', '$(rm)')).toMatchObject({ ok: false })
    expect(command('run', 'claude', '   ')).toMatchObject({ ok: false })
    expect(command('run', 'claude', '[Wavi 派活报告] …')).toMatchObject({ ok: false })
    expect(command('read', 's-1', '--offset', '-3')).toMatchObject({ ok: false })
    expect(command('send', 'a/b', 'x')).toMatchObject({ ok: false })
    expect(command('run', 'claude', 'x', '--ui', 'tui')).toMatchObject({ ok: false, error: '--ui is gui or cli.' })
    expect(parseWaviArgv(['ls', '--ui', 'gui'])).toMatchObject({ kind: 'error' })
  })

  it('reads results back and nothing else', () => {
    expect(parseWaviResult({ ok: false, failure: 'limit', text: 'no' })).toEqual({ ok: false, failure: 'limit', text: 'no' })
    expect(parseWaviResult({ ok: false, failure: 'nope', text: 'no' })).toBeNull()
    expect(titleFor('a'.repeat(200)).length).toBe(DISPATCH_LIMITS.title)
  })
})

describe('childUi (PRD F21 v1.163)', () => {
  const all = (): boolean => true
  const none = (): boolean => false

  it('opens a child as its dispatcher is, GUI only for an agent that can run as one here', () => {
    expect(childUi({ agent: 'codex', parentUi: 'gui', installed: all })).toEqual({ ui: 'gui' })
    expect(childUi({ agent: 'grok', parentUi: 'gui', installed: all })).toEqual({ ui: 'gui' })
    expect(childUi({ agent: 'codex', parentUi: 'cli', installed: all })).toEqual({ ui: 'cli' })
    // Inherited, not asked for: a terminal without a word.
    expect(childUi({ agent: 'crush', parentUi: 'gui', installed: all })).toEqual({ ui: 'cli' })
    expect(childUi({ agent: 'amp', parentUi: 'gui', installed: none })).toEqual({ ui: 'cli' })
  })

  it('follows --ui, and says why a GUI it asked for opens in a terminal', () => {
    expect(childUi({ agent: 'claude', requested: 'gui', parentUi: 'cli', installed: all })).toEqual({ ui: 'gui' })
    expect(childUi({ agent: 'claude', requested: 'cli', parentUi: 'gui', installed: all })).toEqual({ ui: 'cli' })
    expect(childUi({ agent: 'antigravity', requested: 'gui', parentUi: 'gui', installed: all })).toEqual({ ui: 'cli', note: 'Antigravity opens in a terminal: it has no chat mode.' })
    const amp = childUi({ agent: 'amp', requested: 'gui', parentUi: 'cli', installed: none })
    expect(amp.ui).toBe('cli')
    expect(amp.note).toContain('amp-acp')
    expect(childUi({ agent: 'amp', requested: 'gui', parentUi: 'cli', installed: (b) => b === 'amp-acp' })).toEqual({ ui: 'gui' })
  })
})

describe('startRefusal', () => {
  const ask = (over: Partial<Parameters<typeof startRefusal>[0]>) => startRefusal({ depth: 0, toolsOn: true, openTasks: [], treeSize: 0, task: 'new', ...over })
  it('lets the user’s session and its children dispatch, two levels in all', () => {
    expect(ask({})).toBeNull()
    expect(ask({ depth: 1 })).toBeNull()
    expect(ask({ depth: 2 })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining('Do the work yourself') })
  })
  it('keeps to 4 open per dispatcher and 8 per tree, refuses duplicates and obeys the setting', () => {
    expect(ask({ openTasks: ['a', 'b', 'c'] })).toBeNull()
    expect(ask({ openTasks: ['a', 'b', 'c', 'd'] })).toMatchObject({ failure: 'limit' })
    expect(ask({ treeSize: 8 })).toMatchObject({ failure: 'limit' })
    expect(ask({ openTasks: ['Fix  the bug'], task: 'Fix the bug ' })).toMatchObject({ failure: 'duplicate' })
    expect(ask({ toolsOn: false })).toMatchObject({ failure: 'not_allowed' })
  })
})

describe('planChild', () => {
  const plan = (title: string, base: 'head' | 'snapshot', branches: string[] = []) =>
    planChild({
      item: { agent: 'codex', task: 't', title, base },
      root: '/code/acme',
      base: 'jacob/plan',
      from: '/code/acme',
      prefix: 'jacob',
      branches,
      worktreesDir: '/h/.tr/worktrees/acme',
      takenFolders: ['fix-login'],
      prepare: true,
      random: () => 0
    })
  it('names a branch after its title, unique against the repository (a made-up name for Chinese titles)', () => {
    const p = plan('Fix login', 'head', ['main', 'jacob/fix-login'])
    expect(p.branch).toBe('jacob/fix-login-2')
    expect(p.request).toEqual({ root: '/code/acme', branch: 'jacob/fix-login-2', base: 'jacob/plan', folder: p.request.folder, prepare: true })
    expect(plan('修复登录', 'head').branch).toBe('jacob/amber-badger')
  })
  it('gives a snapshot no branch and a folder of its own', () => {
    const p = plan('Review auth', 'snapshot')
    expect(p.branch).toBe('')
    expect(p.request).toMatchObject({ branch: '', snapshotOf: '/code/acme', folder: 'snapshot-review-auth' })
    expect(p.path).toBe('/h/.tr/worktrees/acme/snapshot-review-auth')
  })
})

describe('childBrief', () => {
  const brief = (over: Partial<Parameters<typeof childBrief>[0]>) =>
    childBrief({ task: 'Do X', parentTitle: 'Plan auth', parentAgent: 'claude', depth: 1, branch: 'jacob/x', base: 'main', snapshot: false, ...over })
  it('says who sent it, where it works and how to report', () => {
    const text = brief({})
    expect(text).toContain('Claude Code（会话「Plan auth」）')
    expect(text).toContain('分支 jacob/x，基于 main')
    expect(text).toContain('\n\nDo X\n\n')
    expect(text).toContain('wavi report "<结果>"')
    expect(text).toContain('BLOCKED:')
    expect(text).toContain('只能再派一层')
  })
  it('keeps a snapshot read-only and a grandchild from dispatching', () => {
    expect(brief({ snapshot: true, branch: '' })).toContain('不要改文件')
    expect(brief({ depth: 2, parentAgent: 'grok' })).toContain('这一层不能再派活')
    expect(brief({ depth: 2, parentAgent: 'grok' })).toContain('Grok（会话')
  })
})

describe('childEvent', () => {
  const s = (status: Parameters<typeof childEvent>[0]['status'], exited = false, finishedAt?: number) => ({ status, exited, ...(finishedAt !== undefined ? { finishedAt } : {}) })
  it('reports a finished turn, an error and an exit once', () => {
    expect(childEvent(s('running'), s('done_unread', false, 5))).toBe('done')
    expect(childEvent(s('needs_you', false, 1), s('idle', false, 5))).toBe('done')
    // A startup dialog answered (Grok's trust prompt): idle again, but no turn finished.
    expect(childEvent(s('needs_you'), s('idle'))).toBeNull()
    expect(childEvent(s('running', false, 5), s('idle', false, 5))).toBeNull()
    expect(childEvent(s('running'), s('error'))).toBe('error')
    expect(childEvent(s('error'), s('error'))).toBeNull()
    expect(childEvent(s('idle'), s('idle', true))).toBe('exited')
    expect(childEvent(s('idle', true), s('exited', true))).toBeNull()
  })
  it('does not wake the dispatcher for a child that starts or waits for the user', () => {
    expect(childEvent(s('idle'), s('running'))).toBeNull()
    expect(childEvent(s('running'), s('needs_you'))).toBeNull()
    expect(childEvent(s('idle'), s('idle'))).toBeNull()
  })
})

function report(over: Partial<ChildReport>): ChildReport {
  return { childId: 's1', title: 'Fix login', agent: 'codex', event: 'done', branch: 'jacob/fix-login', turn: 1, ...over }
}

describe('reportText', () => {
  it('lists facts per child, frames them as not from the user and points to wavi read / send', () => {
    const text = reportText([report({ model: 'gpt-6-sol', changes: '+12 −3 · 2 个文件', checks: '测试 ✓', message: 'Fixed it.\nRan npm test.' })], [{ title: 'Write tests' }])
    expect(looksLikeReport(text)).toBe(true)
    expect(text).toContain('不是用户的指示')
    expect(text).toContain('— 「Fix login」 · Codex · gpt-6-sol · 一轮结束 · 分支 jacob/fix-login · +12 −3 · 2 个文件 · 测试 ✓ · id s1')
    expect(text).toContain('  Fixed it.\n  Ran npm test.')
    expect(text).toContain('仍在进行：「Write tests」')
    expect(text).toContain('wavi read <id>')
  })
  it('names a child’s own report, a snapshot, and a guessed turn end', () => {
    expect(reportText([report({ event: 'report', branch: '', message: 'ok' })])).toContain('· 报告 · 快照 ·')
    expect(reportText([report({ agent: 'cursor' })])).toContain('一轮结束（估计）')
  })
  it('says when a turn ended without a reply (a provider error, say)', () => {
    expect(reportText([report({})])).toContain('没有留下回复')
    expect(reportText([report({ event: 'exited' })])).not.toContain('没有留下回复')
  })
  it('keeps excerpts within the shared budget', () => {
    const long = 'x'.repeat(DISPATCH_LIMITS.excerpt * 2)
    const text = reportText(Array.from({ length: 4 }, (_, i) => report({ childId: `s${i}`, message: long })))
    expect(text.length).toBeLessThan(DISPATCH_LIMITS.reportBudget + 2_000)
    expect(text).toContain('wavi read s3')
  })
})

describe('noticeText', () => {
  it('tells the dispatcher what the user decided, as Wavi’s message', () => {
    const started = noticeText('started', [{ id: 's-9', agent: 'grok', title: 'Review', branch: '' }])
    expect(started).toContain('id s-9 · grok · 「Review」 · 快照')
    expect(looksLikeReport(started)).toBe(true)
    expect(noticeText('declined', [])).toContain('不要重试')
    expect(noticeText('timeout', [])).toContain('10 分钟内没有回答')
  })
})

describe('reading Wavi’s own words back (the GUI draws them, Figma 68′)', () => {
  it('finds `wavi run` in a shell call, not other wavi commands or text', () => {
    expect(isWaviRun('wavi run codex "Write tests" --model gpt-6-sol')).toBe(true)
    expect(isWaviRun('cd app && wavi run claude - <<EOF')).toBe(true)
    expect(isWaviRun('wavi report "done"')).toBe(false)
    expect(isWaviRun('echo wavi running')).toBe(false)
    expect(isWaviRun('echo wavi run codex')).toBe(false)
    expect(isWaviRun('git status; wavi run grok "Review"')).toBe(true)
  })
  it('names the sessions a `wavi run` answer opened or holds for 开始, in order', () => {
    const out = [
      "Session s-1a2b3c4d (codex · gpt-6-sol, a new branch off main) waits for the user's 开始 in Wavi.",
      'wavi does not wait: end your turn now.',
      'Started session s-99aa00bb (grok, a snapshot of your working tree). It works on its own.'
    ].join('\n')
    expect(waviRunIds(out)).toEqual(['s-1a2b3c4d', 's-99aa00bb'])
    expect(waviRunIds('[limit] You already have 8 sessions.')).toEqual([])
    // Only wavi's own lines: another program's words in the same command are not a session.
    expect(waviRunIds('npm: Session cache (warm)\nSession s-1 (codex, a new branch) waits')).toEqual(['s-1'])
  })
  it('reads a report back: one entry per child, facts without the agent and event, the excerpt without hints', () => {
    const text = reportText([
      report({ model: 'gpt-6-sol', changes: '+12 −3 · 2 个文件', checks: '测试 ✓', message: 'Fixed it.\nRan npm test.' }),
      report({ childId: 's-2', title: 'A · B', event: 'error', branch: '' })
    ])
    expect(parseReportText(text)).toEqual([
      { childId: 's1', title: 'Fix login', agent: 'Codex', event: 'done', facts: ['gpt-6-sol', '分支 jacob/fix-login', '+12 −3', '2 个文件', '测试 ✓'], excerpt: 'Fixed it.\nRan npm test.' },
      { childId: 's-2', title: 'A · B', agent: 'Codex', event: 'error', facts: ['快照'], excerpt: '' }
    ])
    expect(parseReportText(reportText([report({ event: 'report', message: 'ok' })]))?.[0]?.event).toBe('report')
    expect(parseReportText('hello')).toBeNull()
  })
  it('reads a notice back: what the user decided and for which sessions', () => {
    const started = noticeText('started', [{ id: 's-9', agent: 'grok', title: 'Review', branch: '' }, { id: 's-8', agent: 'codex', title: 'Tests', branch: 'jacob/t' }])
    expect(parseNoticeText(started)).toEqual({ outcome: 'started', ids: ['s-9', 's-8'], titles: ['Review', 'Tests'] })
    expect(parseNoticeText(noticeText('declined', [{ id: 's-9', agent: 'grok', title: 'Review', branch: '' }]))?.outcome).toBe('declined')
    expect(parseNoticeText(noticeText('timeout', []))?.outcome).toBe('timeout')
    expect(parseNoticeText(started.replace('[Wavi 派活]', '[Wavi 派活报告]'))).toBeNull()
  })
  it('reads its own words back in English, and Chinese saved before while the interface is English', () => {
    const zhReport = reportText([report({ message: 'Fixed it.' })])
    const zhNotice = noticeText('declined', [{ id: 's-9', agent: 'grok', title: 'Review', branch: '' }])
    withLang('en', () => {
      // An agent's own line in parentheses stays; Wavi's hint does not.
      const long = 'x'.repeat(5000)
      const text = reportText([report({ message: `(no tests changed)\n${long}` })])
      const [one] = parseReportText(text) ?? []
      expect(one?.event).toBe('done')
      expect(one?.title).toBe('Fix login')
      expect(one?.excerpt.startsWith('(no tests changed)')).toBe(true)
      expect(one?.excerpt).not.toMatch(/read all of it|read it with/)
      const started = noticeText('started', [{ id: 's-9', agent: 'grok', title: 'Review', branch: '' }])
      expect(parseNoticeText(started)).toEqual({ outcome: 'started', ids: ['s-9'], titles: ['Review'] })
      expect(parseReportText(zhReport)?.[0]?.excerpt).toBe('Fixed it.')
      expect(parseNoticeText(zhNotice)?.outcome).toBe('declined')
    })
  })
})

describe('report queue', () => {
  it('coalesces settles, supersedes per child and never repeats a turn', () => {
    let q = enqueueReport(emptyQueue(), report({ childId: 'a', turn: 1 }), 0)
    q = enqueueReport(q, report({ childId: 'a', turn: 2 }), 500)
    q = enqueueReport(q, report({ childId: 'b', turn: 1 }), 1000)
    expect(takeDue(q, 2000)).toMatchObject({ kind: 'wait', ms: DISPATCH_LIMITS.debounceMs - 1000 })
    const due = takeDue(q, 1000 + DISPATCH_LIMITS.debounceMs)
    expect(due.kind).toBe('send')
    if (due.kind !== 'send') return
    expect(due.batch.map((r) => `${r.childId}:${r.turn}`)).toEqual(['a:2', 'b:1'])
    expect(enqueueReport(due.queue, report({ childId: 'a', turn: 2 }), 9000).pending).toEqual([])
  })
  it('drops a pending report the dispatcher read itself', () => {
    const q = ackReport(enqueueReport(emptyQueue(), report({ childId: 'a' }), 0), 'a')
    expect(takeDue(q, 60_000).kind).toBe('none')
  })
  it('holds reports over the hourly wake budget until the user sends them', () => {
    let q = { ...emptyQueue(), sent: Array.from({ length: DISPATCH_LIMITS.wakesPerHour }, (_, i) => i * 1000) }
    q = enqueueReport(q, report({}), 30_000)
    expect(takeDue(q, 40_000).kind).toBe('held')
    expect(takeAll(q).batch).toHaveLength(1)
    expect(takeDue(q, 2 * 60 * 60_000).kind).toBe('send')
  })
})

describe('maySendNow (the 送进去 send’s two checks)', () => {
  it('waits while the dispatcher waits for the user, has a draft, or was typed in within 3 s', () => {
    expect(maySendNow({ status: 'idle', lastKeyAt: null, draft: false, now: 10_000 })).toBe(true)
    expect(maySendNow({ status: 'needs_you', lastKeyAt: null, draft: false, now: 10_000 })).toBe(false)
    expect(maySendNow({ status: 'idle', lastKeyAt: 9_000, draft: false, now: 10_000 })).toBe(false)
    expect(maySendNow({ status: 'idle', lastKeyAt: 1_000, draft: true, now: 10_000 })).toBe(false)
    expect(maySendNow({ status: 'running', lastKeyAt: 1_000, draft: false, now: 10_000 })).toBe(true)
  })
})

describe('the rest', () => {
  it('pages long messages', () => {
    const message = 'y'.repeat(DISPATCH_LIMITS.readPage + 10)
    expect(messagePage(message)).toEqual({ text: 'y'.repeat(DISPATCH_LIMITS.readPage), nextOffset: DISPATCH_LIMITS.readPage })
    expect(messagePage(message, DISPATCH_LIMITS.readPage)).toEqual({ text: 'y'.repeat(10), nextOffset: null })
  })
  it('says how many sessions each dispatcher is waiting to start', () => {
    expect([...confirmLabels([{ parentId: 'a', count: 2 }, { parentId: 'b', count: 1 }, { parentId: 'a', count: 1 }])]).toEqual([
      ['a', '想开 3 个会话'],
      ['b', '想开 1 个会话']
    ])
  })

  it('counts a leader’s adopt requests apart (Figma 81A)', () => {
    expect([...confirmLabels([{ parentId: 'a', count: 1 }, { parentId: 'a', count: 1, adopt: true }, { parentId: 'b', count: 2, adopt: true }])]).toEqual([
      ['a', '想开 1 个会话 · 接管 1 个'],
      ['b', '想接管 2 个会话']
    ])
    expect(confirmHead(3, 0)).toBe('想开 3 个会话')
  })
})

describe('leader session (PRD F21 v1.198)', () => {
  const command = (...argv: string[]) => {
    const args = parseWaviArgv(argv)
    return args.kind === 'command' ? parseWaviCommand(args.command) : args
  }

  it('lets only terminal Claude Code and Codex lead, and says why another cannot', () => {
    expect(CLI_AGENTS.filter((kind) => canLead(kind))).toEqual(['claude', 'codex'])
    expect(canLead('claude', 'gui')).toBe(false)
    expect(canLead('shell')).toBe(false)
    expect(leaderBlock('claude', 'cli', null)).toBeNull()
    expect(leaderBlock('codex', 'cli', { codexSandboxMode: false })).toBeNull()
    expect(leaderBlock('codex', 'cli', { codexSandboxMode: true })).toContain('sandbox_mode')
    expect(leaderBlock('codex', 'gui', null)).toBe('GUI 会话还不能当 leader')
    expect(leaderBlock('gemini', 'cli', null)).toContain('只有终端里的 Claude Code 和 Codex')
  })

  it('reads wavi ls --all, adopt and tell, the task or message from stdin too', () => {
    expect(command('ls', '--all')).toEqual({ ok: true, command: { name: 'ls', all: true } })
    expect(command('ls')).toEqual({ ok: true, command: { name: 'ls' } })
    expect(command('adopt', 's-1', 'Finish', 'the login form')).toEqual({ ok: true, command: { name: 'adopt', id: 's-1', task: 'Finish the login form' } })
    expect(parseWaviArgv(['adopt', 's-1', '-'])).toEqual({ kind: 'command-stdin', command: { name: 'adopt', id: 's-1' }, field: 'task', json: false })
    expect(command('tell', 'Merge', 'A or B?')).toEqual({ ok: true, command: { name: 'tell', text: 'Merge A or B?' } })
  })

  it('refuses --all elsewhere, an adopt without an id or task, a Wavi message as its task, and an empty tell', () => {
    expect(parseWaviArgv(['run', 'codex', 'x', '--all'])).toEqual({ kind: 'error', error: 'wavi run has no --all. Run wavi --skill.' })
    expect(command('adopt')).toMatchObject({ ok: false, error: expect.stringContaining('wavi ls --all') })
    expect(command('adopt', 's-1')).toMatchObject({ ok: false, error: expect.stringContaining('The task is empty') })
    expect(command('adopt', 's-1', '[Wavi 派活报告] x')).toMatchObject({ ok: false, error: expect.stringContaining('Wavi message') })
    expect(command('tell')).toMatchObject({ ok: false })
  })

  const adopt = (over: Partial<Parameters<typeof adoptRefusal>[0]> = {}) =>
    adoptRefusal({ toolsOn: true, leader: true, self: false, kind: 'claude', dispatchedBy: false, archived: false, exited: false, subtreeSize: 0, subtreeDepth: 0, openTasks: [], treeSize: 0, task: 'Finish it', ...over })

  it('adopts a user session of the project within the limits, its own sessions counted', () => {
    expect(adopt()).toBeNull()
    expect(adopt({ subtreeSize: 3, subtreeDepth: 1, treeSize: 4 })).toBeNull()
    expect(adopt({ subtreeSize: 3, subtreeDepth: 1, treeSize: 5 })).toMatchObject({ ok: false, failure: 'limit', text: expect.stringContaining('9 sessions') })
    expect(adopt({ openTasks: ['a', 'b', 'c', 'd'] })).toMatchObject({ ok: false, failure: 'limit' })
    expect(adopt({ openTasks: ['Finish  it'] })).toMatchObject({ ok: false, failure: 'duplicate' })
  })

  it('refuses a non-leader, itself, a plain terminal, a session with a dispatcher, a gone one and one too deep', () => {
    expect(adopt({ leader: false })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining("project's leader") })
    expect(adopt({ self: true })).toMatchObject({ failure: 'not_allowed', text: 'That is your own session.' })
    expect(adopt({ kind: 'shell' })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining('plain terminal') })
    expect(adopt({ dispatchedBy: true })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining('already reports') })
    expect(adopt({ exited: true })).toMatchObject({ failure: 'not_allowed' })
    expect(adopt({ subtreeDepth: 2 })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining('deeper than 2 levels') })
    expect(adopt({ toolsOn: false })).toMatchObject({ failure: 'not_allowed', text: expect.stringContaining('turned off') })
  })

  it('starts a leader at 自动 and keeps it from changing files: Claude without its editing tools, Codex read-only but for its WAVI_DIR', () => {
    expect(leaderLaunchArgs('claude', '/tmp/w')).toEqual(['--permission-mode', 'auto', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
    const codexAuto = ['-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="auto_review"']
    expect(leaderLaunchArgs('codex', '/private/tmp/wavi-501-x/s-1')).toEqual([
      '-c',
      'default_permissions="wavi-leader"',
      '-c',
      'permissions.wavi-leader={extends=":read-only", filesystem={"/private/tmp/wavi-501-x/s-1"="write"}}',
      ...codexAuto
    ])
    expect(leaderLaunchArgs('codex', null)).toEqual(['-c', 'default_permissions="wavi-leader"', '-c', 'permissions.wavi-leader={extends=":read-only"}', ...codexAuto])
    // Not `--approve-for-me`: it also switches the sandbox to workspace-write (codex 0.167 --help).
    expect(leaderLaunchArgs('codex', '/w')).not.toContain('--approve-for-me')
    expect(leaderLaunchArgs('gemini', '/tmp/w')).toEqual([])
  })

  it('puts the leader flags where each CLI reads them: the tool list ends before the next option, the first message after --', () => {
    const prompt = systemPromptArgs('claude', WAVI_LEADER_PROMPT)!
    const claude = agentArgv('claude', '/code/acme', { extraArgs: [...leaderLaunchArgs('claude', '/w'), ...prompt], initialPrompt: 'Plan it' })
    const at = claude.indexOf('--disallowedTools')
    expect(claude.slice(at, at + 6)).toEqual(['--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', '--append-system-prompt'])
    expect(claude.slice(-2)).toEqual(['--', 'Plan it'])
    expect(claude.filter((a) => a === '--permission-mode')).toHaveLength(1)
    expect(claude[claude.indexOf('--permission-mode') + 1]).toBe('auto')
    const codex = agentArgv('codex', '/code/acme', { extraArgs: [...leaderLaunchArgs('codex', '/w'), ...systemPromptArgs('codex', WAVI_LEADER_PROMPT)!] })
    expect(codex).toContain('default_permissions="wavi-leader"')
    expect(codex.some((a) => a.startsWith('developer_instructions='))).toBe(true)
    expect(codex).not.toContain('-s')
  })

  it("keeps the leader's own permission mode over a 定时任务's 权限 and when resuming", () => {
    const leader = leaderLaunchArgs('claude', '/w')
    const modes = (argv: string[]) => argv.flatMap((a, i) => (a === '--permission-mode' ? [argv[i + 1]] : []))
    expect(modes(agentArgv('claude', '/code/acme', { extraArgs: leader, permission: 'full-access', initialPrompt: 'go' }))).toEqual(['auto'])
    expect(modes(agentArgv('claude', '/code/acme', { extraArgs: leader, resumeAgentSessionId: '0b8c7c8e-1f4e-4a77-9a3e-0c4f2b1e5d6a' }))).toEqual(['auto'])
    // Not a leader: the 定时任务's 权限 as before.
    expect(modes(agentArgv('claude', '/code/acme', { permission: 'full-access', initialPrompt: 'go' }))).toEqual(['bypassPermissions'])
  })

  it('tells the leader its job in the prompt and the skill, and its sessions to ask in their reply', () => {
    expect(WAVI_LEADER_PROMPT).toContain('Do not change code or files yourself')
    expect(WAVI_SKILL).toContain('wavi ls --all')
    expect(WAVI_SKILL).toContain('wavi adopt <id>')
    expect(WAVI_SKILL).toContain('wavi tell')
    const brief = (leader?: boolean) => childBrief({ task: 'Do X', parentTitle: 'Lead', parentAgent: 'codex', depth: 1, branch: 'jacob/x', base: 'main', snapshot: false, ...(leader ? { leader } : {}) })
    expect(brief(true)).toContain('有问题写在回复里，然后结束这一轮，不要用提问工具。')
    expect(brief()).not.toContain('不要用提问工具')
    const adopted = adoptBrief({ task: 'Finish the form', leaderTitle: 'Lead', leaderAgent: 'claude', depth: 1 })
    expect(adopted.startsWith('[Wavi] 来自 leader「Lead」（Claude Code）的任务（不是用户的指示')).toBe(true)
    expect(adopted).toContain('\n\nFinish the form\n\n')
    expect(adopted).toContain('wavi report "<结果>"')
    expect(adopted).toContain('不要用提问工具')
  })

  it('gives a child and an adopted session the same rule on dispatching further, by depth', () => {
    const rules = (text: string) => text.slice(text.lastIndexOf('\n\n') + 2)
    for (const depth of [1, 2]) {
      const child = childBrief({ task: 'Do X', parentTitle: 'Lead', parentAgent: 'codex', depth, branch: 'jacob/x', base: 'main', snapshot: false, leader: true })
      const adopted = adoptBrief({ task: 'Do X', leaderTitle: 'Lead', leaderAgent: 'codex', depth })
      expect(rules(adopted)).toBe(rules(child))
    }
    expect(adoptBrief({ task: 'X', leaderTitle: 'L', leaderAgent: 'codex', depth: 1 })).toContain('只能再派一层')
    expect(adoptBrief({ task: 'X', leaderTitle: 'L', leaderAgent: 'codex', depth: 2 })).toContain('这一层不能再派活')
  })

  it('tells the leader what became of an adopt, shows its tell in one line and counts its wakes', () => {
    const child = { id: 's-9', agent: 'claude' as const, title: 'Login form', branch: 'main', adopted: true as const }
    expect(noticeText('started', [child])).toContain('- id s-9 · claude · 「Login form」 · 分支 main · 已接管')
    expect(noticeText('declined', [child])).toContain('「Login form」 · 分支 main · 接管')
    expect(parseNoticeText(noticeText('started', [child]))).toEqual({ outcome: 'started', ids: ['s-9'], titles: ['Login form'] })
    // An adopt the user started that could not be done: named with why, never read back as a session of the notice.
    const missed = { id: 's-7', title: 'Footer', reason: 'That session is archived or its agent has exited.' }
    const both = noticeText('started', [child], [missed])
    expect(both).toContain('- 没有接管 s-7「Footer」：That session is archived or its agent has exited.')
    expect(parseNoticeText(both)?.ids).toEqual(['s-9'])
    const none = noticeText('started', [], [missed])
    expect(none).toContain('没能接管，什么都没开')
    expect(none).not.toContain('已经开始')
    expect(parseNoticeText(none)?.ids).toEqual([])
    expect(tellLabel('\n  Merge A or B?\nDetails…')).toBe('Merge A or B?')
    expect([...tellLabel('x'.repeat(300))]).toHaveLength(200)
    expect(wakesThisHour({ ...emptyQueue(), sent: [0, 10 * 60_000, 50 * 60_000] }, 61 * 60_000)).toBe(2)
  })
})

describe('wavi task and wavi run --task (PRD F21 v1.249)', () => {
  const command = (...argv: string[]) => {
    const args = parseWaviArgv(argv)
    return args.kind === 'command' ? parseWaviCommand(args.command) : args
  }

  it('reads task add, with a parent, a body and the title or body from stdin', () => {
    expect(command('task', 'add', 'Login', 'form')).toEqual({ ok: true, command: { name: 'task-add', title: 'Login form' } })
    expect(command('task', 'add', 'Login', '--parent', '12', '--body', 'Fields and errors')).toEqual({ ok: true, command: { name: 'task-add', title: 'Login', parent: 12, body: 'Fields and errors' } })
    expect(command('task', 'add', 'Login', '--parent=#3')).toEqual({ ok: true, command: { name: 'task-add', title: 'Login', parent: 3 } })
    expect(parseWaviArgv(['task', 'add', '-'])).toEqual({ kind: 'command-stdin', command: { name: 'task-add' }, field: 'title', json: false })
    expect(parseWaviArgv(['task', 'add', 'Login', '--body', '-', '--parent', '2'])).toEqual({
      kind: 'command-stdin',
      command: { name: 'task-add', title: 'Login', parent: '2' },
      field: 'body',
      json: false
    })
    expect(command('task', 'add', '  ')).toMatchObject({ ok: false })
    expect(command('task', 'add', 'x'.repeat(121))).toMatchObject({ ok: false })
    expect(command('task', 'add', 'x', '--parent', 'abc')).toMatchObject({ ok: false })
    expect(command('task', 'add', 'x', '--parent', '0')).toMatchObject({ ok: false })
    expect(parseWaviArgv(['task', 'add', 'x', '--note', 'n'])).toMatchObject({ kind: 'error' })
  })

  it('reads task update, ls and show', () => {
    expect(command('task', 'update', '23', '--note', 'half done', '--done')).toEqual({ ok: true, command: { name: 'task-update', seq: 23, note: 'half done', done: true } })
    expect(command('task', 'update', '23', '--cancel', '--title', 'New')).toEqual({ ok: true, command: { name: 'task-update', seq: 23, title: 'New', cancel: true } })
    expect(command('task', 'update', '23')).toMatchObject({ ok: false })
    expect(command('task', 'update', '23', '--done', '--cancel')).toMatchObject({ ok: false })
    expect(command('task', 'update', 'x', '--done')).toMatchObject({ ok: false })
    expect(command('task', 'update', '23', '--progress', '50')).toMatchObject({ kind: 'error' })
    expect(command('task', 'ls')).toEqual({ ok: true, command: { name: 'task-ls' } })
    expect(command('task', 'ls', '--all')).toEqual({ ok: true, command: { name: 'task-ls', all: true } })
    expect(parseWaviArgv(['task', 'ls', '--json'])).toEqual({ kind: 'command', command: { name: 'task-ls' }, json: true })
    expect(command('task', 'show', '7')).toEqual({ ok: true, command: { name: 'task-show', seq: 7 } })
    expect(command('task', 'show')).toMatchObject({ ok: false })
    expect(command('task', 'done', '7')).toMatchObject({ kind: 'error' })
    expect(command('task')).toMatchObject({ kind: 'error' })
    expect(parseWaviArgv(['task', 'show', '7', '--all'])).toMatchObject({ kind: 'error' })
  })

  it('reads run --task as the card number', () => {
    expect(command('run', 'codex', 'Fix it', '--task', '12')).toEqual({ ok: true, command: { name: 'run', agent: 'codex', task: 'Fix it', base: 'head', card: 12 } })
    expect(command('run', 'codex', 'Fix it', '--task', 'x')).toMatchObject({ ok: false })
    expect(command('run', 'codex', 'Fix it')).toEqual({ ok: true, command: { name: 'run', agent: 'codex', task: 'Fix it', base: 'head' } })
    expect(parseWaviArgv(['ls', '--task', '1'])).toMatchObject({ kind: 'error' })
  })

  it('names the card in the brief of a session bound to it, and only then', () => {
    const base = { task: 'Do X', parentTitle: 'Lead', parentAgent: 'claude' as const, depth: 1, branch: 'jacob/x', base: 'main', snapshot: false }
    const text = withLang('en', () => childBrief({ ...base, card: { seq: 12, title: 'Login form' } }))
    expect(text).toContain('card #12 "Login form"')
    expect(text).toContain('wavi report')
    expect(withLang('en', () => childBrief(base))).not.toContain('task board')
  })

  it('explains the cards in wavi --skill and --help', () => {
    expect(WAVI_SKILL).toContain('## A card from the board')
    expect(WAVI_HELP).toContain('wavi task add')
    expect(WAVI_HELP).toContain('--task <card>')
  })
})

describe('canLeadCard (PRD F9 v1.252)', () => {
  it('lets every terminal agent lead one card, while a project leader stays Claude Code or Codex', () => {
    expect(CLI_AGENTS.filter((kind) => canLeadCard(kind))).toEqual([...CLI_AGENTS])
    expect(canLeadCard('shell')).toBe(false)
    expect(canLeadCard('claude', 'gui')).toBe(false)
    expect(CLI_AGENTS.filter((kind) => canLead(kind))).toEqual(['claude', 'codex'])
  })
})
