// 任务看板 end to end (PRD F9 / F21 v1.249) through real processes: a card the user pastes (`window.tr.tasks.create`, what
// the board's 「贴一张」 does) reaches the project's leader once; the leader and other sessions run `wavi task …` and
// `wavi run … --task` in their own shells (the same fake `claude` as e2e/dispatch.spec.ts), and every assertion reads
// main's store through `window.tr.tasks.list()`, not the canvas. Fake agents only, no model.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 30_000 }

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

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

interface Card {
  id: string
  seq: number
  projectId: string
  parentId?: string
  title: string
  body: string
  createdBy: string
  sessionId?: string
  manual: string
  note?: string
}

test.describe('任务看板 · wavi task', () => {
  const fake = fakeHookClaude('tr-e2e-tasks-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'board')
  /** A second session of the same project, in its own worktree: not the leader, bound to no card. */
  const member = join(fake.root, 'board-member')
  /** A project without a leader. */
  const other = join(fake.root, 'plain')
  const profile = join(fake.root, 'profile')
  let app: ElectronApplication
  let page: Page
  let childDir = ''

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
  const cards = (): Promise<Card[]> => page.evaluate(() => (globalThis as unknown as { tr: { tasks: { list(): Promise<unknown> } } }).tr.tasks.list()) as Promise<Card[]>
  const paste = (draft: { projectId: string; title: string; body: string }): Promise<Card | null> =>
    page.evaluate((d) => (globalThis as unknown as { tr: { tasks: { create(d: unknown): Promise<unknown> } } }).tr.tasks.create(d), draft) as Promise<Card | null>
  const cardBySeq = async (seq: number): Promise<Card | undefined> => (await cards()).find((c) => c.seq === seq)
  const childWorktree = (needle: string): string => {
    const root = join(home, '.tr', 'worktrees')
    for (const name of existsSync(root) ? readdirSync(root) : []) {
      for (const wt of existsSync(join(root, name)) ? readdirSync(join(root, name)) : []) {
        const dir = join(root, name, wt)
        if (read(dir, '.fake-argv').includes(needle)) return dir
      }
    }
    return ''
  }
  const repo = (dir: string, readme: string) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), readme)
    writeFileSync(join(dir, '.gitignore'), '.fake-*\n')
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'init')
  }

  let root: Card
  let sub: Card

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    writeFileSync(join(fake.root, 'bin', 'claude'), FAKE_CLAUDE)
    chmodSync(join(fake.root, 'bin', 'claude'), 0o755)
    repo(project, '# board\n')
    git(project, 'worktree', 'add', '-q', '-b', 'jacob/member', member)
    repo(other, '# plain\n')
    for (const dir of [project, member, other]) writeFileSync(join(dir, '.fake-steps'), '')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'board', rootPath: project },
          { id: 'p2', name: 'plain', rootPath: other }
        ],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-member', projectId: 'p1', branch: 'jacob/member', path: member, isMain: false },
          { id: 'w-plain', projectId: 'p2', branch: 'main', path: other, isMain: true }
        ],
        sessions: [
          { id: 's-lead', worktreeId: 'w-main', kind: 'claude', ui: 'cli', title: 'leader', startedAt: 1, lastActivityAt: 1 },
          { id: 's-member', worktreeId: 'w-member', kind: 'claude', ui: 'cli', title: 'member', startedAt: 1, lastActivityAt: 1 },
          { id: 's-plain', worktreeId: 'w-plain', kind: 'claude', ui: 'cli', title: 'plain', startedAt: 1, lastActivityAt: 1 }
        ],
        leaderSessions: { p1: 's-lead' },
        activeSessionId: 's-lead',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    // A session's agent starts when its terminal is first shown: open each one, the leader last.
    for (const [id, dir] of [['s-member', member], ['s-plain', other], ['s-lead', project]] as const) {
      await page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
      await expect.poll(() => read(dir, '.fake-env'), { timeout: 60_000 }).not.toBe('')
    }
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of [project, member, other, childDir].filter(Boolean)) {
      const pid = Number(read(dir, '.fake-pid')) || 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('a pasted root card reaches the leader once; a second card is a second message; a reload re-delivers nothing', async () => {
    const a = await paste({ projectId: 'p1', title: 'Ship the login', body: 'Make it work in Safari too.' })
    expect(a).not.toBeNull()
    root = a!
    await expect.poll(() => inbox(project).length, WITHIN).toBe(1)
    const first = inbox(project)[0]!
    expect(first.startsWith('[Wavi task board]')).toBe(true)
    expect(first).toContain(`#${root.seq}`)
    expect(first).toContain('Ship the login')
    expect(first).toContain('Make it work in Safari too.')
    const b = await paste({ projectId: 'p1', title: 'Second card', body: 'Another one.' })
    await expect.poll(() => inbox(project).length, WITHIN).toBe(2)
    expect(inbox(project)[1]).toContain(`#${b!.seq}`)
    expect(inbox(project)[1]).toContain('Second card')
    await page.reload()
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    await expect.poll(async () => (await cards()).length, WITHIN).toBe(2)
    await page.waitForTimeout(3000)
    expect(inbox(project)).toHaveLength(2)
    // The member and the other project's agent heard nothing.
    expect(inbox(member)).toEqual([])
  })

  test('a project without a leader gets nothing delivered; the card waits on the board', async () => {
    const c = await paste({ projectId: 'p2', title: 'Nobody leads', body: 'Wait for the user.' })
    expect(c).not.toBeNull()
    await page.waitForTimeout(3000)
    expect(await cardBySeq(c!.seq)).toMatchObject({ title: 'Nobody leads', manual: 'todo' })
    expect(inbox(other)).toEqual([])
    expect(read(other, '.fake-typed')).toBe('')
    expect(inbox(project)).toHaveLength(2)
  })

  test('the leader adds a child card under the root; others without a card of their own are refused', async () => {
    const added = await wavi(project, 'task', 'add', 'sub', '--parent', String(root.seq))
    expect(added.code).toBe(0)
    const seq = Number(/#(\d+)/.exec(added.out)?.[1])
    expect(seq).toBeGreaterThan(root.seq)
    sub = (await cardBySeq(seq))!
    expect(sub).toMatchObject({ title: 'sub', parentId: root.id, createdBy: 's-lead', projectId: 'p1' })
    const ls = await wavi(project, 'task', 'ls')
    expect(ls.code).toBe(0)
    expect(ls.out).toContain('sub')
    // A session that is not the leader and has no card: no root cards, and no sub-cards outside its own card.
    const before = (await cards()).length
    const noParent = await wavi(member, 'task', 'add', 'sneaky')
    expect(noParent.code).not.toBe(0)
    expect(noParent.out).toContain('[not_allowed]')
    expect(noParent.out).toContain('no card of its own')
    const outside = await wavi(member, 'task', 'add', 'sneaky', '--parent', String(root.seq))
    expect(outside.code).not.toBe(0)
    expect(outside.out).toContain('[not_allowed]')
    expect((await cards()).length).toBe(before)
  })

  test('wavi run --task starts the card’s session with no confirmation; a second run for the same card is refused', async () => {
    const started = await wavi(project, 'run', 'claude', 'do it', '--task', String(sub.seq), '--title', 'Sub work')
    expect(started.code).toBe(0)
    expect(started.out).toContain('Started session')
    const id = /Started session (\S+)/.exec(started.out)![1]!
    await expect(page.getByTestId('dispatch-strip')).toHaveCount(0)
    await expect.poll(async () => (await cardBySeq(sub.seq))?.sessionId, WITHIN).toBe(id)
    await expect.poll(() => childWorktree('do it'), { timeout: 60_000 }).not.toBe('')
    childDir = childWorktree('do it')
    const again = await wavi(project, 'run', 'claude', 'do it again', '--task', String(sub.seq))
    expect(again.code).not.toBe(0)
    expect(again.out).toContain('[duplicate]')
    expect((await cardBySeq(sub.seq))?.sessionId).toBe(id)
    await expect(page.getByTestId('dispatch-strip')).toHaveCount(0)
  })

  test('wavi task update: --done and --note on the card; a session not bound to it is refused', async () => {
    await expect.poll(() => read(childDir, '.fake-env'), { timeout: 60_000 }).not.toBe('')
    const note = await wavi(project, 'task', 'update', String(sub.seq), '--note', 'x')
    expect(note.code).toBe(0)
    expect((await cardBySeq(sub.seq))?.note).toBe('x')
    const refused = await wavi(member, 'task', 'update', String(sub.seq), '--done')
    expect(refused.code).not.toBe(0)
    expect(refused.out).toContain('[not_allowed]')
    expect((await cardBySeq(sub.seq))?.manual).toBe('todo')
    const done = await wavi(childDir, 'task', 'update', String(sub.seq), '--done')
    expect(done.code).toBe(0)
    expect((await cardBySeq(sub.seq))?.manual).toBe('done')
    const viaLeader = await wavi(project, 'task', 'update', String(sub.seq), '--note', 'y')
    expect(viaLeader.code).toBe(0)
    expect((await cardBySeq(sub.seq))).toMatchObject({ note: 'y', manual: 'done' })
  })
})
