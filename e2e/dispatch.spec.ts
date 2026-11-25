// 派活与回报 end to end (PRD F21 v1.103) on a real repository, through the real path: the agent's own shell runs
// `wavi` (Wavi's `<userData>/bin/wavi`, first on PATH) → its WAVI_DIR request file → main → the window → the answer
// file → back; reports go into the dispatcher's channel. Fake agents only, no model: `claude` runs the per-launch hooks
// (like e2e/fake-hook-claude.ts), keeps a cross-session inbox socket whose messages it logs, and runs `wavi` with the
// arguments a test step gives it, logging what it printed; `cursor-agent` (no channel: reports wait for 送进去) does
// the same without hooks or inbox and echoes what is typed. Screenshots in both themes go to test-results/dispatch/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 30_000 }
const SHOTS = join(process.cwd(), 'test-results', 'dispatch')

/** What both fakes share: argv, steps, `wavi` runs, typed input echoed like a TUI's input line. */
const COMMON = `
const { spawnSync, execSync } = require('node:child_process')
const fs = require('node:fs')
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
fs.writeFileSync(dir + '/.fake-env', JSON.stringify({ PATH: process.env.PATH, WAVI_DIR: process.env.WAVI_DIR || '', WAVI_BIN: process.env.WAVI_BIN || '' }))
const wavi = (s) => {
  const r = spawnSync('wavi', s.args, { encoding: 'utf8', input: s.input || '', env: process.env, timeout: 20000 })
  fs.appendFileSync(dir + '/.fake-wavi', JSON.stringify({ id: s.id, code: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') }) + '\\n')
}
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => {
  const text = d.toString()
  fs.appendFileSync(dir + '/.fake-typed', text.replace(/\\r/g, '<ENTER>\\n'))
  process.stdout.write(text.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '\\r\\n❯ '))
})
`

const FAKE_CLAUDE = `#!/usr/bin/env node
${COMMON}
const net = require('node:net')
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const settings = arg('--settings') ? JSON.parse(fs.readFileSync(arg('--settings'), 'utf8')) : {}
// A cross-session inbox like Claude Code's: newline JSON, auth first; its path and token in the env of hooks and Bash.
const inbox = '/tmp/wavi-e2e-inbox-' + process.pid + '.sock'
try { fs.rmSync(inbox) } catch {}
process.env.CLAUDE_CODE_MESSAGING_SOCKET = inbox
process.env.CLAUDE_CODE_MESSAGING_TOKEN = 'tok-' + process.pid
net.createServer((c) => {
  let buf = ''
  c.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.type === 'user') fs.appendFileSync(dir + '/.fake-inbox', JSON.stringify(m.message.content) + '\\n')
    }
  })
}).listen(inbox)
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (!entry) return
  try { execSync(entry.command, { input: JSON.stringify({ hook_event_name: event, session_id: 'fake-' + process.pid, cwd: dir, ...payload }), timeout: 10000, shell: '/bin/sh', stdio: ['pipe', 'ignore', 'ignore'], env: process.env }) } catch {}
}
process.stdout.write('Claude Code v9.9.9\\r\\n\\r\\n❯ \\r\\n')
hook('SessionStart', { source: 'startup' })
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.exit !== undefined) process.exit(step.exit)
    if (step.hook) hook(step.hook, step.payload || {})
    if (step.wavi) wavi(step.wavi)
  }
}, 150)
`

const FAKE_CURSOR = `#!/usr/bin/env node
${COMMON}
process.stdout.write('Cursor Agent (fake)\\r\\n\\r\\n❯ ')
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.wavi) wavi(step.wavi)
  }
}, 150)
`

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

test.describe('派活与回报 · wavi', () => {
  const fake = fakeHookClaude('tr-e2e-dispatch-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'demo')
  /** A second project whose only session runs Cursor Agent: a dispatcher without a channel. */
  const other = join(fake.root, 'other')
  const profile = join(fake.root, 'profile')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  let app: ElectronApplication
  let page: Page
  const dirs: Record<'fix' | 'review' | 'types', string> = { fix: '', review: '', types: '' }
  const ids: Record<'fix' | 'review' | 'types', string> = { fix: '', review: '', types: '' }

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const read = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '')
  const step = (dir: string, value: unknown) => appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify(value)}\n`)
  const waviOut = (dir: string, id: number): { code: number; out: string } | null => {
    for (const line of read(dir, '.fake-wavi').split('\n').filter(Boolean)) {
      const v = JSON.parse(line) as { id: number; code: number; out: string }
      if (v.id === id) return v
    }
    return null
  }
  let nextId = 1
  /** Runs `wavi <args>` in the fake agent's own shell and waits for what it printed. */
  const wavi = async (dir: string, ...args: string[]): Promise<{ code: number; out: string }> => {
    const id = nextId++
    step(dir, { wavi: { id, args } })
    await expect.poll(() => waviOut(dir, id), WITHIN).not.toBeNull()
    return waviOut(dir, id)!
  }
  const inbox = (dir: string): string[] => read(dir, '.fake-inbox').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string)
  const strip = () => page.getByTestId('dispatch-strip')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  const setTheme = (theme: 'dark' | 'light') =>
    page.evaluate((t) => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
    }, theme)
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  const worktreeOf = (needle: string): string => {
    for (const name of existsSync(worktreesDir) ? readdirSync(worktreesDir) : []) {
      const dir = join(worktreesDir, name)
      if (read(dir, '.fake-argv').includes(needle)) return dir
    }
    return ''
  }

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    writeFileSync(join(fake.root, 'bin', 'claude'), FAKE_CLAUDE)
    writeFileSync(join(fake.root, 'bin', 'cursor-agent'), FAKE_CURSOR)
    chmodSync(join(fake.root, 'bin', 'claude'), 0o755)
    chmodSync(join(fake.root, 'bin', 'cursor-agent'), 0o755)
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# demo\n')
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.name', 'Jacob E2E')
    git(project, 'config', 'user.email', 'e2e@example.com')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    mkdirSync(other)
    writeFileSync(join(other, '.gitignore'), '.fake-*\n')
    git(other, 'init', '-q', '-b', 'main')
    git(other, 'add', '.')
    git(other, 'commit', '-q', '-m', 'init')
    writeFileSync(join(other, '.fake-steps'), '')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'demo', rootPath: project },
          { id: 'p2', name: 'other', rootPath: other }
        ],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-other', projectId: 'p2', branch: 'main', path: other, isMain: true }
        ],
        sessions: [
          { id: 's-plan', worktreeId: 'w-main', kind: 'claude', title: '规划登录改版', startedAt: 1, lastActivityAt: 1 },
          { id: 's-cursor', worktreeId: 'w-other', kind: 'cursor', title: '整理文档', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's-plan',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    writeFileSync(join(project, '.fake-steps'), '')
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of [project, other, ...Object.values(dirs)].filter(Boolean)) {
      const pid = Number(read(dir, '.fake-pid')) || 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('the agent finds wavi first on its PATH and a system prompt about it; nothing global is written', async () => {
    await expect.poll(() => read(project, '.fake-argv'), WITHIN).not.toBe('')
    const argv = JSON.parse(read(project, '.fake-argv')) as string[]
    expect(argv).toContain('--append-system-prompt')
    expect(argv[argv.indexOf('--append-system-prompt') + 1]).toContain('wavi --skill')
    expect(argv.join(' ')).not.toMatch(/--mcp-config|mcp_servers/)
    const env = JSON.parse(read(project, '.fake-env')) as { PATH: string; WAVI_DIR: string; WAVI_BIN: string }
    expect(env.PATH.split(':')[0]).toBe(join(profile, 'bin'))
    expect(env.WAVI_DIR).toMatch(/^\/private\/tmp\/wavi-\d+-[a-f0-9]+\/s-plan$/)
    const skill = await wavi(project, '--skill')
    expect(skill.code).toBe(0)
    expect(skill.out).toContain('# wavi')
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  test('wavi run answers at once; the user’s 开始 starts every waiting request and the dispatcher hears it', async () => {
    // Not committed: a branch child goes without it, a snapshot child has it.
    writeFileSync(join(project, 'draft.txt'), 'work in progress\n')
    const fix = await wavi(project, 'run', 'claude', 'Fix the login form\nKeep the API as it is.', '--title', 'Fix login')
    expect(fix.code).toBe(0)
    expect(fix.out).toContain("waits for the user's 开始")
    expect(fix.out).toContain('end your turn now')
    const review = await wavi(project, 'run', 'claude', 'Review the login change', '--base', 'snapshot', '--title', 'Review')
    expect(review.out).toContain('read-only snapshot')
    ids.fix = /Session (\S+)/.exec(fix.out)![1]!
    ids.review = /Session (\S+)/.exec(review.out)![1]!
    // Under the dispatcher's own terminal, not over the window; its row says it is waiting on the user.
    await expect(strip()).toBeVisible(WITHIN)
    await expect(strip()).toContainText('想开 2 个会话')
    await expect(strip()).toContainText('基于 main')
    await expect(strip()).toContainText('未提交的改动不会带到新的 worktree 里')
    await expect(strip().getByTestId('dispatch-row')).toHaveCount(2)
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('jacob/fix-login')
    await expect(strip().getByTestId('dispatch-row').nth(1)).toContainText('当前改动的快照')
    await strip().getByTestId('dispatch-row').first().getByRole('button').click()
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('Keep the API as it is.')
    const dispatcherRow = sidebar().locator('[data-session-id="s-plan"]')
    await expect(dispatcherRow).toHaveAttribute('data-attention', 'true')
    await expect(dispatcherRow).toContainText('想开 2 个会话')
    // Figma 83B: what waits for 开始 hangs under the dispatcher on its line, a dashed row each, gone once answered.
    const waiting = sidebar().getByTestId('pending-row')
    await expect(waiting).toHaveCount(2)
    await expect(waiting.first()).toContainText('Fix login')
    await expect(waiting.first()).toContainText('待开始')
    await expect(waiting.nth(1)).toHaveAttribute('data-tree', 'last')
    expect(existsSync(worktreesDir)).toBe(false)
    await shoot('confirm')
    // A reload (a crash, a rebuild) keeps what waits for the user: the strip and the dispatcher's row come back.
    await page.reload()
    await expect(strip()).toBeVisible(WITHIN)
    await expect(strip().getByTestId('dispatch-row')).toHaveCount(2)
    await expect(dispatcherRow).toHaveAttribute('data-attention', 'true')
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.press('Meta+Enter')
    await expect(strip()).toBeHidden()
    await expect(dispatcherRow).not.toContainText('想开')
    await expect(waiting).toHaveCount(0)
    await expect.poll(() => inbox(project).join('\n'), WITHIN).toContain('[Wavi 派活] 用户同意了')
    const notice = inbox(project)[0]!
    expect(notice).toContain(`id ${ids.fix} · claude · 「Fix login」 · 分支 jacob/fix-login`)
    expect(notice).toContain(`id ${ids.review} · claude · 「Review」 · 快照`)
  })

  test('each child starts in its own worktree with Wavi’s brief, the snapshot with the dispatcher’s uncommitted file', async () => {
    await expect.poll(() => worktreeOf('Fix the login form'), { timeout: 60_000 }).not.toBe('')
    await expect.poll(() => worktreeOf('Review the login change'), { timeout: 60_000 }).not.toBe('')
    dirs.fix = worktreeOf('Fix the login form')
    dirs.review = worktreeOf('Review the login change')
    const brief = (dir: string) => {
      const argv = JSON.parse(read(dir, '.fake-argv')) as string[]
      return { argv, text: argv[argv.indexOf('--') + 1] ?? '' }
    }
    const fix = brief(dirs.fix)
    expect(fix.text).toContain('这是 Wavi 转来的任务：Claude Code（会话「规划登录改版」）')
    expect(fix.text).toContain('分支 jacob/fix-login，基于 main')
    expect(fix.text).toContain('wavi report "<结果>"')
    // A dispatched session learns about wavi from its brief, not a system prompt.
    expect(fix.argv).not.toContain('--append-system-prompt')
    expect(existsSync(join(dirs.fix, 'draft.txt'))).toBe(false)
    expect(brief(dirs.review).text).toContain('不要改文件')
    expect(readFileSync(join(dirs.review, 'draft.txt'), 'utf8')).toBe('work in progress\n')
    expect(git(dirs.review, 'branch', '--show-current').trim()).toBe('')
    expect(git(project, 'branch', '--format=%(refname:short)').trim().split('\n').sort()).toEqual(['jacob/fix-login', 'main'])
    // The other project's Cursor session is not part of this tree.
    const rows = sidebar().locator('[data-session-id]:not([data-session-id="s-cursor"])')
    // PRD v1.243: the children are folded under the dispatcher until its fold row is clicked, which selects nothing.
    const fold = sidebar().locator('[data-testid="fold-row"][data-group-owner="s-plan"]')
    await expect(fold).toContainText('2 个成员', WITHIN)
    await expect(rows).toHaveCount(1)
    await fold.click()
    await expect(rows).toHaveCount(3, WITHIN)
    await expect(rows.nth(1)).toHaveAttribute('data-depth', '1')
    await expect(rows.nth(2)).toHaveAttribute('data-depth', '1')
  })

  test('a child starts a grandchild at once, two levels in; the grandchild may go no deeper', async () => {
    await expect.poll(() => read(dirs.fix, '.fake-env'), WITHIN).not.toBe('')
    const started = await wavi(dirs.fix, 'run', 'claude', 'Check the types of the login form', '--title', 'Types', '--model', 'haiku')
    expect(started.code).toBe(0)
    expect(started.out).toContain('Started session')
    ids.types = /Started session (\S+)/.exec(started.out)![1]!
    await expect(strip()).toHaveCount(0)
    await expect.poll(() => worktreeOf('Check the types'), { timeout: 60_000 }).not.toBe('')
    dirs.types = worktreeOf('Check the types')
    const argv = JSON.parse(read(dirs.types, '.fake-argv')) as string[]
    expect(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2)).toEqual(['--model', 'haiku'])
    expect(argv[argv.indexOf('--') + 1]).toContain('这一层不能再派活')
    const row = sidebar().locator(`[data-session-id="${ids.types}"]`)
    // The child's own group is folded, one level in, until it is opened itself.
    await expect(row).toHaveCount(0)
    await sidebar().locator(`[data-testid="fold-row"][data-group-owner="${ids.fix}"]`).click()
    await expect(row).toHaveAttribute('data-depth', '2', WITHIN)
    await expect(row).toContainText('haiku')
    await expect.poll(() => read(dirs.types, '.fake-env'), WITHIN).not.toBe('')
    const deeper = await wavi(dirs.types, 'run', 'claude', 'Go one level deeper')
    expect(deeper.code).toBe(1)
    expect(deeper.out).toContain('[not_allowed]')
    expect(deeper.out).toContain('Do the work yourself')
    await shoot('sidebar')
  })

  test('a child’s own wavi report reaches the dispatcher’s inbox once; Wavi adds nothing for that turn', async () => {
    const dir = dirs.review
    step(dir, { hook: 'UserPromptSubmit', payload: { prompt: 'Review the login change' } })
    const reported = await wavi(dir, 'report', '审过了：登录改动没问题。\n跑了 npm test，全部通过。')
    expect(reported.out).toContain('Reported to 「规划登录改版」')
    step(dir, { hook: 'Stop', payload: { last_assistant_message: '审完了。' } })
    await expect.poll(() => inbox(project).filter((m) => m.startsWith('[Wavi 派活报告]')).length, WITHIN).toBe(1)
    await page.waitForTimeout(4_000)
    const reports = inbox(project).filter((m) => m.startsWith('[Wavi 派活报告]'))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain(`「Review」 · Claude Code · 报告 · 快照`)
    expect(reports[0]).toContain('跑了 npm test，全部通过。')
    expect(reports[0]).toContain('不是用户的指示')
    // Its finished turn went to the dispatcher: read already, no 已完成 · 未读 of its own.
    await expect(sidebar().locator(`[data-session-id="${ids.review}"]`)).not.toContainText('未读')
  })

  test('without a report Wavi reports the finished turn itself, to the grandchild’s own dispatcher', async () => {
    step(dirs.types, { hook: 'UserPromptSubmit', payload: { prompt: 'Check the types' } })
    step(dirs.types, { hook: 'Stop', payload: { last_assistant_message: '类型都对。' } })
    await expect.poll(() => inbox(dirs.fix).join('\n'), WITHIN).toContain('[Wavi 派活报告]')
    const report = inbox(dirs.fix).find((m) => m.startsWith('[Wavi 派活报告]'))!
    expect(report).toContain('「Types」 · Claude Code · haiku · 一轮结束')
    expect(report).toContain('类型都对。')
    expect(inbox(project).join('\n')).not.toContain('「Types」')
  })

  test('ls, read, send and stop act on the caller’s own sessions; duplicates and 拒绝 are refused', async () => {
    const listed = await wavi(project, 'ls')
    expect(listed.out).toContain(`id ${ids.fix} · claude`)
    expect(listed.out).toContain('branch jacob/fix-login')
    expect(listed.out).toContain('snapshot')
    expect(listed.out).toContain('Suggested merge order')
    const result = await wavi(project, 'read', ids.review)
    expect(result.out).toContain('"Review" · claude')
    expect((await wavi(project, 'read', 's-plan')).out).toContain('[not_found]')
    expect((await wavi(project, 'read', ids.types)).out).toContain('[not_found]')
    const sent = await wavi(project, 'send', ids.fix, 'Also keep the error messages.')
    expect(sent.out).toContain('Wavi is putting it in')
    await expect.poll(() => inbox(dirs.fix).join('\n'), WITHIN).toContain('Also keep the error messages.')
    expect((await wavi(project, 'run', 'claude', 'Fix the login form\nKeep the API as it is.')).out).toContain('[duplicate]')
    await wavi(project, 'run', 'claude', 'Update the docs', '--title', 'Docs')
    await expect(strip()).toBeVisible(WITHIN)
    await strip().getByRole('button', { name: '拒绝' }).click()
    await expect.poll(() => inbox(project).join('\n'), WITHIN).toContain('用户拒绝了')
    expect(readdirSync(worktreesDir)).toHaveLength(3)
  })

  // PRD v1.218 ②: the snapshot's commit is Wavi's own and on no branch, so the last session closing takes the worktree.
  test('closing the snapshot child’s session removes its worktree folder', async () => {
    await sidebar().locator(`[data-session-id="${ids.review}"]`).click()
    await page.keyboard.press('Meta+KeyW')
    await expect.poll(() => existsSync(dirs.review), WITHIN).toBe(false)
    await expect(sidebar().locator(`[data-session-id="${ids.review}"]`)).toHaveCount(0)
    expect(readdirSync(worktreesDir)).toHaveLength(2)
  })

  // PRD v1.243: ⌘J still lands on a member that is folded away, and opens every group above it.
  test('⌘J on a folded member that needs you opens its groups and selects it', async () => {
    await sidebar().locator('[data-session-id="s-plan"]').click()
    const planFold = sidebar().locator('[data-testid="fold-row"][data-group-owner="s-plan"]')
    await planFold.click()
    await expect(planFold).toHaveAttribute('aria-expanded', 'false')
    await expect(sidebar().locator(`[data-session-id="${ids.fix}"]`)).toHaveCount(0)
    step(dirs.fix, { hook: 'PermissionRequest', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } })
    await expect(planFold.getByRole('img', { name: '等你处理' })).toBeVisible(WITHIN)
    await page.keyboard.press('Meta+KeyJ')
    await expect(planFold).toHaveAttribute('aria-expanded', 'true', WITHIN)
    await expect(sidebar().locator(`[data-session-id="${ids.fix}"]`)).toHaveAttribute('aria-current', 'true', WITHIN)
    step(dirs.fix, { hook: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} } })
  })

  test('the child’s header names its dispatcher, and the overview lists them together', async () => {
    await sidebar().locator(`[data-session-id="${ids.fix}"]`).click()
    const link = page.getByTestId('dispatched-by').first()
    await expect(link).toHaveText('由「规划登录改版」派出', WITHIN)
    await shoot('header')
    await link.click()
    await expect(sidebar().locator('[data-session-id="s-plan"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Shift+Meta+A')
    const group = page.getByTestId('dispatch-group').first()
    await expect(group).toContainText('规划登录改版', WITHIN)
    await shoot('overview')
    await page.keyboard.press('Shift+Meta+A')
  })

  test('a dispatcher with no channel gets Wavi’s messages when the user presses 送进去', async () => {
    // Cursor Agent: its status comes from the title only, so nothing is typed into it unasked.
    await sidebar().locator('[data-session-id="s-cursor"]').click()
    await expect.poll(() => read(other, '.fake-env'), WITHIN).not.toBe('')
    const argv = JSON.parse(read(other, '.fake-argv')) as string[]
    expect(argv).not.toContain('--append-system-prompt')
    const asked = await wavi(other, 'run', 'claude', 'Write the changelog entry', '--title', 'Changelog')
    expect(asked.out).toContain("waits for the user's 开始")
    await expect(strip()).toBeVisible(WITHIN)
    await strip().getByRole('button', { name: '拒绝' }).click()
    const held = page.getByTestId('held-reports')
    await expect(held).toContainText('1 条派活消息还没送进去：「派活结果」', WITHIN)
    expect(read(other, '.fake-typed')).toBe('')
    await shoot('held')
    await held.getByRole('button', { name: '送进去' }).click()
    await expect.poll(() => read(other, '.fake-typed'), WITHIN).toContain('用户拒绝了')
    await expect(held).toBeHidden()
  })
})

// The project's leader session (PRD F21 v1.198, Figma 81): 设置 turns it on, the new-session panel (from the project's
// ⋯ · 新建 leader…) makes one in the main checkout, it lists and adopts the user's own session through the confirm
// strip, and its `wavi tell` waits on the user until they send a line in its terminal. The user's session sits in a
// linked worktree, so each fake agent has a folder (and step file) of its own. Codex's config sets sandbox_mode, so the
// panel lists Codex as unable to lead. Screenshots in both themes go to test-results/dispatch/leader-*.
test.describe('leader 会话', () => {
  const fake = fakeHookClaude('tr-e2e-leader-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'lead')
  const userDir = join(fake.root, 'lead-safari')
  const profile = join(fake.root, 'profile')
  const codexHome = join(fake.root, 'codex-home')
  let app: ElectronApplication
  let page: Page

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const read = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '')
  let nextId = 1
  const wavi = async (dir: string, ...args: string[]): Promise<{ code: number; out: string }> => {
    const id = nextId++
    appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify({ wavi: { id, args } })}\n`)
    const out = (): { code: number; out: string } | null =>
      read(dir, '.fake-wavi')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: number; code: number; out: string })
        .find((v) => v.id === id) ?? null
    await expect.poll(out, WITHIN).not.toBeNull()
    return out()!
  }
  const sheet = () => page.getByTestId('new-session-sheet')
  const strip = () => page.getByTestId('dispatch-strip')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  /** The leader's row is the one whose branch line reads `leader · main`. */
  const leaderId = async (): Promise<string | null> => {
    const row = sidebar().locator('[data-session-id]', { hasText: 'leader · main' })
    return (await row.count()) === 1 ? row.getAttribute('data-session-id') : null
  }
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => {
        ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
      }, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `leader-${name}-${theme}.png`) })
    }
    await page.evaluate(() => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = 'dark'
    })
  }
  const openProjectMenu = async () => {
    await sidebar().getByText('lead', { exact: true }).hover()
    await page.getByRole('button', { name: 'lead 项目菜单' }).click()
    return page.getByRole('menu')
  }

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    // The panel's agent menu shows versions (Figma 81C): both fakes answer --version.
    const claude = FAKE_CLAUDE.replace(
      '#!/usr/bin/env node\n',
      "#!/usr/bin/env node\nif (process.argv[2] === '--version') { process.stdout.write('2.1.310 (Claude Code)\\n'); process.exit(0) }\n"
    )
    writeFileSync(join(fake.root, 'bin', 'claude'), claude)
    writeFileSync(join(fake.root, 'bin', 'codex'), '#!/bin/sh\necho "codex-cli 0.164.0"\n')
    chmodSync(join(fake.root, 'bin', 'claude'), 0o755)
    chmodSync(join(fake.root, 'bin', 'codex'), 0o755)
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(join(codexHome, 'config.toml'), 'sandbox_mode = "workspace-write"\n')
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# lead\n')
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    git(project, 'worktree', 'add', '-q', '-b', 'jacob/safari-login', userDir)
    writeFileSync(join(userDir, '.fake-steps'), '')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'lead', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-user', projectId: 'p1', branch: 'jacob/safari-login', path: userDir, isMain: false }
        ],
        sessions: [{ id: 's-user', worktreeId: 'w-user', kind: 'claude', ui: 'cli', title: 'Safari 登录回归', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-user',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of [project, userDir]) {
      const pid = Number(read(dir, '.fake-pid')) || 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('with the setting off, neither the panel nor the project menu offers a leader', async () => {
    await sidebar().getByText('lead', { exact: true }).hover()
    await page.getByRole('button', { name: '在 lead 新建会话' }).click()
    await expect(sheet()).toBeVisible()
    await expect(sheet().getByRole('switch', { name: '作为 leader' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(sheet()).toBeHidden()
    const menu = await openProjectMenu()
    await expect(menu.getByRole('menuitem', { name: '新建会话…' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '新建 leader…' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('设置 · 自动化 · 派活 turns it on; 新建 leader… opens the panel with 作为 leader on and makes one', async () => {
    await page.evaluate(() => (globalThis as unknown as { tr: { ui: { openSettings(): void } } }).tr.ui.openSettings())
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: '自动化', exact: true }).click()
    const toggle = dialog.getByRole('switch', { name: 'leader 会话' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await dialog.getByText('leader 会话', { exact: true }).scrollIntoViewIfNeeded()
    await shoot('settings')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    const menu = await openProjectMenu()
    await expect(menu.getByRole('menuitem')).toHaveText([/新建会话…/, '新建 leader…', '在新窗口中打开', '在 Finder 中显示', '复制路径', /移除项目/])
    await shoot('menu')
    await menu.getByRole('menuitem', { name: '新建 leader…' }).click()
    await expect(sheet()).toBeVisible()
    await expect(sheet().getByRole('switch', { name: '作为 leader' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('radio', { name: '当前目录' })).toBeChecked()
    await expect(sheet().getByRole('radio', { name: '新 worktree' })).toBeDisabled()
    await expect(sheet().getByRole('radio', { name: 'GUI', exact: true })).toBeDisabled()
    await expect(sheet().getByRole('button', { name: '高级' })).toHaveCount(0)
    await expect(sheet().getByRole('button', { name: '智能体' })).toContainText('Claude Code')
    await shoot('sheet')
    await sheet().getByRole('button', { name: '智能体' }).click()
    const agents = page.getByRole('listbox', { name: '智能体' })
    await expect(agents.getByRole('option')).toHaveCount(2)
    await expect(agents.getByRole('option', { name: /Claude Code/ })).toContainText('2.1.310')
    const codex = agents.getByRole('option', { name: /Codex/ })
    await expect(codex).toHaveAttribute('aria-disabled', 'true')
    await expect(codex).toContainText('0.164.0 · config.toml 设了 sandbox_mode')
    await shoot('agents')
    // Not choosable: a click leaves the menu open and Claude Code chosen.
    await codex.click({ force: true })
    await expect(agents).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(agents).toHaveCount(0)
    await expect(sheet().getByRole('button', { name: '智能体' })).toContainText('Claude Code')
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toBeHidden()

    await expect.poll(leaderId, WITHIN).not.toBeNull()
    const id = (await leaderId())!
    await expect.poll(() => read(project, '.fake-argv'), WITHIN).toContain('--disallowedTools')
    const row = sidebar().locator(`[data-session-id="${id}"]`)
    await expect(row).toContainText('leader · main')
    await expect(page.getByTestId('leader-meta')).toHaveText('leader · 本小时叫醒 0 次')
    // One leader per project: the menu and the panel stop offering another.
    const again = await openProjectMenu()
    await expect(again.getByRole('menuitem', { name: '新建 leader…' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('it lists the user’s session as user, adopts it through the strip, and 开始 moves it under the leader', async () => {
    const id = (await leaderId())!
    await expect.poll(() => read(project, '.fake-env'), WITHIN).not.toBe('')
    const listed = await wavi(project, 'ls', '--all')
    expect(listed.code).toBe(0)
    expect(listed.out).toMatch(/id s-user · claude · "Safari 登录回归" · .*· user\n/)
    const started = await wavi(project, 'run', 'claude', 'Cover the new login form with Playwright', '--title', '登录页 e2e')
    expect(started.code).toBe(0)
    const adopted = await wavi(project, 'adopt', 's-user', 'Finish the SameSite fix for Safari login and add a Safari case')
    expect(adopted.code).toBe(0)
    expect(adopted.out).toContain("waits for the user's 开始")
    await expect(strip()).toBeVisible(WITHIN)
    await expect(strip()).toContainText('想开 1 个会话 · 接管 1 个')
    await expect(strip()).toContainText('基于 main')
    const rows = strip().getByTestId('dispatch-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toContainText('接管 Safari 登录回归')
    await expect(rows.nth(1)).toContainText('jacob/safari-login')
    await expect(rows.nth(1)).toContainText('Finish the SameSite fix')
    await expect(strip().getByTestId('dispatch-start')).toContainText('开始 2 个')
    await expect(sidebar().locator(`[data-session-id="${id}"]`)).toContainText('想开 1 个会话 · 接管 1 个')
    await expect(sidebar().locator('[data-session-id="s-user"]')).toHaveAttribute('data-depth', '0')
    await shoot('confirm')
    await strip().getByTestId('dispatch-start').click()
    await expect(strip()).toBeHidden()
    // The adopted session is a member now: folded into the leader's row until that is opened (PRD v1.243).
    const leaderFold = sidebar().locator(`[data-testid="fold-row"][data-group-owner="${id}"]`)
    await expect(leaderFold).toContainText(/\d+ 个成员/, WITHIN)
    await expect(sidebar().locator('[data-session-id="s-user"]')).toHaveCount(0)
    await leaderFold.click()
    await expect(sidebar().locator('[data-session-id="s-user"]')).toHaveAttribute('data-depth', '1', WITHIN)
    await expect(sidebar().locator(`[data-session-id="${id}"]`)).not.toContainText('想开')
  })

  test('wavi tell waits on the user in the sidebar and the overview until they send a line in the leader', async () => {
    const id = (await leaderId())!
    const told = await wavi(project, 'tell', '旧的「记住我」还留吗？留就要多改一处 cookie')
    expect(told.code).toBe(0)
    const row = sidebar().locator(`[data-session-id="${id}"]`)
    await expect(row).toHaveAttribute('data-attention', 'true', WITHIN)
    await expect(row).toContainText('旧的「记住我」还留吗？')
    await shoot('tell')
    await page.keyboard.press('Shift+Meta+A')
    // 看板 · 进度 (main's board) lists the leader under 等你处理; its overlay's header names what it waits for.
    const card = page.locator('[data-region="overview"] section[aria-label="等你处理"]').locator(`[data-session-id="${id}"]`)
    await expect(card).toBeVisible(WITHIN)
    await expect(page.getByTestId('dispatch-group')).toContainText('Safari 登录回归')
    await card.click()
    const overlay = page.locator('[data-region="overview-overlay"]')
    await expect(overlay).toContainText('等你回答', WITHIN)
    await shoot('overview')
    await overlay.getByRole('button', { name: '关闭' }).click()
    await expect(overlay).toBeHidden()
    await page.keyboard.press('Shift+Meta+A')
    await row.click()
    await page.locator('[data-region="terminal"] .xterm:visible').first().click()
    await page.keyboard.type('keep it')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(project, '.fake-typed'), WITHIN).toContain('keep it<ENTER>')
    await expect(row).not.toHaveAttribute('data-attention', 'true', WITHIN)
    await expect(row).not.toContainText('旧的「记住我」')
  })
})
