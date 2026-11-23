import { describe, expect, it } from 'vitest'
import { formatPairingCode, normalizePairingCode, pairingLink, parsePhoneRequest, parseRemoteResult, parseWindowSessions, REMOTE_LIMITS } from './remote'

describe('pairing codes', () => {
  it('reads what the phone typed, with or without the dash, and refuses misreadable letters', () => {
    expect(normalizePairingCode('4kx-92q')).toBe('4KX92Q')
    expect(normalizePairingCode(' 4KX 92Q ')).toBe('4KX92Q')
    expect(normalizePairingCode('4KX-920')).toBeNull()
    expect(normalizePairingCode('4KX9')).toBeNull()
    expect(normalizePairingCode(42)).toBeNull()
    expect(formatPairingCode('4KX92Q')).toBe('4KX-92Q')
  })

  it('puts the offer in a wavi:// link the camera can open', () => {
    const link = pairingLink({ v: 1, name: 'MacBook Pro', urls: ['ws://10.0.0.2:7429'], code: '4KX92Q', key: 'abc' })
    expect(link.startsWith('wavi://pair?d=')).toBe(true)
    const b64 = link.slice('wavi://pair?d='.length).replace(/-/g, '+').replace(/_/g, '/')
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    expect(JSON.parse(json)).toEqual({ v: 1, name: 'MacBook Pro', urls: ['ws://10.0.0.2:7429'], code: '4KX92Q', key: 'abc' })
  })
})

describe('parsePhoneRequest', () => {
  it('accepts each command in its documented shape', () => {
    expect(parsePhoneRequest({ id: 1, type: 'snapshot' })).toEqual({ id: 1, type: 'snapshot' })
    expect(parsePhoneRequest({ id: 2, type: 'watch', session: null })).toEqual({ id: 2, type: 'watch', session: null })
    expect(parsePhoneRequest({ id: 3, type: 'feed', session: 's1', before: 40 })).toEqual({ id: 3, type: 'feed', session: 's1', before: 40 })
    expect(parsePhoneRequest({ id: 4, type: 'send', session: 's1', text: '看截图', photos: [{ name: 'IMG_1.HEIC', data: 'AAAA' }] })).toEqual({
      id: 4,
      type: 'send',
      session: 's1',
      text: '看截图',
      photos: [{ name: 'IMG_1.HEIC', data: 'AAAA' }]
    })
    expect(parsePhoneRequest({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny' })).toEqual({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny' })
    // A reason with 拒绝 (a GUI session's card shows it to the agent); empty or absent leaves it out.
    expect(parsePhoneRequest({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny', message: '改完再跑' })).toEqual({
      id: 5,
      type: 'permission',
      prompt: 'p1',
      decision: 'deny',
      message: '改完再跑'
    })
    expect(parsePhoneRequest({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny', message: '' })).toEqual({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny' })
    // A GUI session's plan (the phone's sheet is Figma 100): three decisions, and the reason only with 继续规划.
    expect(parsePhoneRequest({ id: 8, type: 'plan', prompt: 'p3', decision: 'approve-auto' })).toEqual({ id: 8, type: 'plan', prompt: 'p3', decision: 'approve-auto' })
    expect(parsePhoneRequest({ id: 8, type: 'plan', prompt: 'p3', decision: 'keep-planning', message: '先把测试补上' })).toEqual({
      id: 8,
      type: 'plan',
      prompt: 'p3',
      decision: 'keep-planning',
      message: '先把测试补上'
    })
    expect(parsePhoneRequest({ id: 6, type: 'answer', prompt: 'p2', answers: { '要不要提示？': '显示' } })).toEqual({ id: 6, type: 'answer', prompt: 'p2', answers: { '要不要提示？': '显示' } })
    expect(parsePhoneRequest({ id: 7, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'jacob/x', prompt: '  ' })).toEqual({
      id: 7,
      type: 'new-session',
      project: 'p',
      workdir: 'worktree',
      agent: 'claude',
      base: 'main',
      branch: 'jacob/x'
    })
    expect(parsePhoneRequest({ id: 8, type: 'diff', session: 's1', path: 'src/a.ts', scope: 'committed' })).toEqual({ id: 8, type: 'diff', session: 's1', path: 'src/a.ts', scope: 'committed' })
    expect(parsePhoneRequest({ id: 9, type: 'diff', session: 's1', path: 'b.ts', oldPath: 'a.ts', scope: 'uncommitted', untracked: false })).toEqual({ id: 9, type: 'diff', session: 's1', path: 'b.ts', oldPath: 'a.ts', scope: 'uncommitted' })
    expect(parsePhoneRequest({ id: 10, type: 'set-setting', session: 's1', kind: 'permission', value: 'plan' })).toEqual({ id: 10, type: 'set-setting', session: 's1', kind: 'permission', value: 'plan' })
  })

  it('refuses a setting it does not know or a value that is not one short line', () => {
    expect(parsePhoneRequest({ id: 1, type: 'set-setting', session: 's1', kind: 'speed', value: 'x' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'set-setting', session: 's1', kind: 'model', value: 'opus\r' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'set-setting', session: '../x', kind: 'model', value: 'opus' })).toBeNull()
  })

  it('refuses anything off: unknown types, bad ids, empty sends, paths out of the worktree, too many photos', () => {
    expect(parsePhoneRequest({ type: 'snapshot' })).toBeNull()
    expect(parsePhoneRequest({ id: -1, type: 'snapshot' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'rm-rf' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '   ' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: '../x', text: 'hi' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: 'a\0b' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: 'x'.repeat(REMOTE_LIMITS.textChars + 1) })).toBeNull()
    const photo = { name: 'a.jpg', data: 'AAAA' }
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: Array(REMOTE_LIMITS.photos + 1).fill(photo) })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: [{ name: 'a', data: 'not base64!' }] })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: '../etc/passwd', scope: 'committed' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: '/etc/passwd', scope: 'committed' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: 'a.ts', scope: 'all' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'p', decision: 'yes' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'p', decision: 'deny', message: 42 })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'p', decision: 'deny', message: 'x'.repeat(REMOTE_LIMITS.answerChars + 1) })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'plan', prompt: 'p', decision: 'approve' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'a:0', decision: 'allow-once' })).toEqual({ id: 1, type: 'permission', prompt: 'a:0', decision: 'allow-once' })
    // A GUI prompt's id: the session and a 22-character digest of the driver's id (src/main/remote/gui-prompts.ts).
    const gui = 'a:Ab3x_9-zQ8kY7wV6uT5sR4'
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: gui, decision: 'allow-once' })).toEqual({ id: 1, type: 'permission', prompt: gui, decision: 'allow-once' })
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'a b:0', decision: 'allow-once' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'a:req.1/a b', decision: 'allow-once' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: `${'x'.repeat(200)}:0`, decision: 'allow-once' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'plan', prompt: '', decision: 'approve-auto' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'answer', prompt: 'p', answers: {} })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'bash' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'claude', branch: 'a b' })).toBeNull()
  })

  it('takes the model picked in 新建会话 and asks for an agent\'s models (PRD F22 v1.161)', () => {
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p', workdir: 'current', agent: 'codex', model: 'gpt-5.5-codex' })).toEqual({
      id: 1,
      type: 'new-session',
      project: 'p',
      workdir: 'current',
      agent: 'codex',
      model: 'gpt-5.5-codex'
    })
    expect(parsePhoneRequest({ id: 2, type: 'new-session', project: 'p', workdir: 'current', agent: 'claude', model: '--dangerously-skip-permissions' })).toBeNull()
    expect(parsePhoneRequest({ id: 3, type: 'agent-models', agent: 'pi' })).toEqual({ id: 3, type: 'agent-models', agent: 'pi' })
    expect(parsePhoneRequest({ id: 4, type: 'agent-models', agent: 'shell' })).toBeNull()
  })

  it('takes 看板 · GitHub\'s three commands and a new session\'s task (PRD F22 v1.227 ⑤)', () => {
    expect(parsePhoneRequest({ id: 1, type: 'github-board', scope: 'review' })).toEqual({ id: 1, type: 'github-board', scope: 'review' })
    expect(parsePhoneRequest({ id: 2, type: 'github-board', scope: 'all', force: true })).toEqual({ id: 2, type: 'github-board', scope: 'all', force: true })
    expect(parsePhoneRequest({ id: 3, type: 'github-detail', project: 'p1', kind: 'pr', number: 140 })).toEqual({ id: 3, type: 'github-detail', project: 'p1', kind: 'pr', number: 140 })
    expect(parsePhoneRequest({ id: 4, type: 'github-start', project: 'p1', kind: 'issue', number: 139 })).toEqual({ id: 4, type: 'github-start', project: 'p1', kind: 'issue', number: 139 })
    const task = { link: { repo: 'github.com/acme/web', kind: 'issue' as const, number: 139 }, title: '#139 Safari 17 上结算页白屏' }
    expect(parsePhoneRequest({ id: 5, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', branch: 'jacoy/issue-139', prompt: '修好它', task })).toEqual({
      id: 5,
      type: 'new-session',
      project: 'p1',
      workdir: 'worktree',
      agent: 'claude',
      branch: 'jacoy/issue-139',
      prompt: '修好它',
      task
    })
    // A PR's head travels with the task: only the two refs prStart fetches are taken.
    expect(parsePhoneRequest({ id: 6, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, startAt: 'refs/remotes/origin/jacoy/vite-7' } })).toMatchObject({
      task: { startAt: 'refs/remotes/origin/jacoy/vite-7' }
    })
    expect(parsePhoneRequest({ id: 6, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, startAt: 'refs/wavi/pull/140' } })).toMatchObject({
      task: { startAt: 'refs/wavi/pull/140' }
    })
    // Off: an unknown scope, a number gh could not take, a link that is not one.
    expect(parsePhoneRequest({ id: 1, type: 'github-board', scope: 'everything' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'github-board', scope: 'all', force: 'yes' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'github-detail', project: 'p1', kind: 'discussion', number: 1 })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'github-detail', project: 'p1', kind: 'pr', number: '--web' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'github-start', project: '../x', kind: 'pr', number: 1 })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, link: { repo: 'acme/web', kind: 'issue', number: 139 } } })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, title: 42 } })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, startAt: 'refs/a\0b' } })).toBeNull()
    // A ref the phone made up: a local branch, a bare remote name, a ref that is not a valid ref name, a bad PR number.
    for (const startAt of ['refs/heads/main', 'origin/main', 'refs/remotes/origin/../x', 'refs/remotes/origin', 'refs/wavi/pull/0', 'refs/wavi/pull/x', 'refs/remotes/origin/feat/x extra']) {
      expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', task: { ...task, startAt } }), startAt).toBeNull()
    }
  })

  it('takes a photo-only send', () => {
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: [{ name: 'a.jpg', data: 'AAAA' }] })).toMatchObject({ text: '', photos: [{ name: 'a.jpg' }] })
  })
})

describe('window messages', () => {
  it('reads a window answer and treats anything else as unreadable', () => {
    expect(parseRemoteResult({ ok: true })).toEqual({ ok: true })
    expect(parseRemoteResult({ ok: false, error: '会话不存在' })).toEqual({ ok: false, error: '会话不存在' })
    expect(parseRemoteResult({ ok: 'maybe' })).toBeNull()
  })

  it('validates the session list the window hands main', () => {
    const good = {
      projects: [{ id: 'p1', name: 'acme-web' }],
      sessions: [{ id: 's1', projectId: 'p1', title: '会话过期自动续期', agent: 'claude', status: 'running', action: '编辑 src/a.ts', activity: 1, branch: 'jacob/x' }],
      folders: { s1: { cwd: '/Users/me/acme', base: 'main', agentSession: '0f1e-22' } },
      roots: { p1: '/Users/me/acme' }
    }
    expect(parseWindowSessions(good)).toEqual(good)
    const settings = { items: [{ kind: 'effort', current: 'high', values: [{ value: 'high', label: '高' }] }], locked: 'running' }
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], settings }] })?.sessions[0]?.settings).toEqual(settings)
    // Settings that do not validate are left off; the session itself stays on the list.
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], settings: { items: 'x' } }] })?.sessions).toEqual(good.sessions)
    // A bad entry is left out, not the whole list.
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], status: 'busy' }] })?.sessions).toEqual([])
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], agent: 'rm' }] })?.sessions).toEqual([])
    const relative = parseWindowSessions({ ...good, folders: { s1: { cwd: '~/wt/x' } } })
    expect(relative?.folders).toEqual({})
    expect(relative?.sessions).toEqual([])
    expect(parseWindowSessions({ ...good, roots: { p1: '/a/../b' } })?.roots).toEqual({})
    expect(parseWindowSessions({ ...good, sessions: 'all' })).toBeNull()
  })

  it('carries 看板 · 进度\'s checks and size and 看板 · GitHub\'s link, and leaves a bad one off (PRD F22 v1.227 ⑤)', () => {
    const row = {
      projects: [{ id: 'p1', name: 'acme-web' }],
      sessions: [{ id: 's1', projectId: 'p1', title: '修好登录', agent: 'claude', status: 'running', activity: 1 }],
      folders: { s1: { cwd: '/Users/me/acme' } },
      roots: { p1: '/Users/me/acme' }
    }
    const checks = { turn: 'previous', edited: true, kinds: [{ kind: 'test', status: 'pass' }, { kind: 'lint', status: 'not-run' }] }
    const stat = { added: 12, removed: 3 }
    const github = { repo: 'github.com/acme/web', kind: 'issue', number: 139 }
    const full = { ...row, sessions: [{ ...row.sessions[0], checks, stat, github }] }
    expect(parseWindowSessions(full)?.sessions[0]).toMatchObject({ checks, stat, github })
    // Off: an unknown check kind or status, a negative size, a link without the host.
    expect(parseWindowSessions({ ...full, sessions: [{ ...row.sessions[0], checks: { ...checks, kinds: [{ kind: 'e2e', status: 'pass' }] } }] })?.sessions[0]?.checks).toBeUndefined()
    expect(parseWindowSessions({ ...full, sessions: [{ ...row.sessions[0], checks: { ...checks, turn: 'now' } }] })?.sessions[0]?.checks).toBeUndefined()
    expect(parseWindowSessions({ ...full, sessions: [{ ...row.sessions[0], stat: { added: -1, removed: 0 } }] })?.sessions[0]?.stat).toBeUndefined()
    expect(parseWindowSessions({ ...full, sessions: [{ ...row.sessions[0], stat: { added: 0, removed: 0 } }] })?.sessions[0]?.stat).toBeUndefined()
    expect(parseWindowSessions({ ...full, sessions: [{ ...row.sessions[0], github: { ...github, repo: 'acme/web' } }] })?.sessions[0]?.github).toBeUndefined()
  })
})

describe('exits from the phone', () => {
  it('reads exits, ship actions and archive, and refuses what is off', () => {
    expect(parsePhoneRequest({ id: 1, type: 'exits', session: 's1' })).toEqual({ id: 1, type: 'exits', session: 's1' })
    expect(parsePhoneRequest({ id: 2, type: 'archive', session: 's1' })).toEqual({ id: 2, type: 'archive', session: 's1' })
    expect(parsePhoneRequest({ id: 3, type: 'ship', session: 's1', action: { do: 'start', exit: 'pr' } })).toEqual({ id: 3, type: 'ship', session: 's1', action: { do: 'start', exit: 'pr' } })
    expect(parsePhoneRequest({ id: 4, type: 'ship', session: 's1', action: { do: 'edit', texts: { commit: 'feat: x', draft: true, other: 1 } } })).toEqual({
      id: 4,
      type: 'ship',
      session: 's1',
      action: { do: 'edit', texts: { commit: 'feat: x', draft: true } }
    })
    expect(parsePhoneRequest({ id: 5, type: 'ship', session: 's1', action: { do: 'submit' } })?.type).toBe('ship')
    expect(parsePhoneRequest({ id: 6, type: 'ship', session: 's1', action: { do: 'start', exit: 'open-pr' } })).toBeNull()
    expect(parsePhoneRequest({ id: 7, type: 'ship', session: 's1', action: { do: 'edit', texts: {} } })).toBeNull()
    expect(parsePhoneRequest({ id: 8, type: 'ship', session: 's1', action: { do: 'edit', texts: { title: 'x'.repeat(501) } } })).toBeNull()
    expect(parsePhoneRequest({ id: 9, type: 'ship', session: 's1', action: { do: 'force-push' } })).toBeNull()
  })

  it('carries an exit in progress in the session list, and drops a session whose one is malformed', () => {
    const ship = {
      kind: 'pr',
      title: '创建 PR',
      agent: 'Claude Code',
      stage: 'glance',
      steps: [{ id: 'write', label: 'Claude Code 写标题和正文', state: 'done' }, { id: 'push', label: '推送 jacob/x', state: 'pending' }],
      texts: { commit: '', title: 'feat: refresh', body: '…', draft: false },
      fields: ['title', 'body', 'draft'],
      submitLabel: '推送并创建 PR',
      submitBlocker: null,
      error: null
    }
    const list = {
      projects: [{ id: 'p1', name: 'acme' }],
      sessions: [{ id: 's1', projectId: 'p1', title: 't', agent: 'claude', status: 'idle', activity: 1, ship, shipNotice: '已创建 PR #12' }],
      folders: { s1: { cwd: '/w' } },
      roots: {}
    }
    expect(parseWindowSessions(list)?.sessions[0]).toMatchObject({ ship, shipNotice: '已创建 PR #12' })
    const bad = { ...list, sessions: [{ ...list.sessions[0], ship: { ...ship, stage: 'done' } }] }
    expect(parseWindowSessions(bad)?.sessions).toEqual([])
  })
})

