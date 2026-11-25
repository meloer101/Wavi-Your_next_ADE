// 手机看板 · GitHub end to end (PRD F22 v1.229 ⑤, F9): a stand-in phone (src/main/remote/test-phone.ts) asks the Mac for
// each project's board and for one issue's detail through a fake `gh` (e2e/fake-gh.ts), gets 交给 agent's answer, and
// starts the session with the same `new-session` + task the phone's form sends. The session the Mac builds is the
// desktop's: the item's title in the sidebar, its link in workspace.json, the item's branch, and the task as the agent's
// first message. A CLI-only agent (`agy`, the fake in bin/) gets the task on its command line, as a terminal agent does;
// the phone's Claude session is a GUI session (F22 v1.161), so its task arrives as the first message and the Mac's chat
// shows the fake's answer to it.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RemoteSession, RemoteStatus } from '../src/shared/remote'
import type { BoardDetailResult, BoardStart } from '../src/shared/github-board'
import { pairPhone, TestPhone } from '../src/main/remote/test-phone'
import { outerClaudeEnv } from './fake-claude'
import { fakeGh } from './fake-gh'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 20_000 }
const LONG = { timeout: 60_000 }
const FIXTURES = join(process.cwd(), 'src', 'main', 'gui', 'fixtures')

type SavedSession = { id: string; title: string; titleSource?: string; github?: { repo: string; kind: string; number: number } }
type Board = { state: string; repo: { host: string; owner: string; name: string }; issues: { number: number }[]; prs: { number: number; checks: { state: string } }[] }
type BoardAnswer = { gh: string; projects: { project: string; board: Board }[] }

interface Hooks {
  tr: { settings: { update(patch: unknown): Promise<unknown> }; ui: { openSettings(): void }; remote: { status(): Promise<RemoteStatus> } }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

const macKey = (link: string): string => (JSON.parse(Buffer.from(link.slice('wavi://pair?d='.length), 'base64url').toString('utf8')) as { key: string }).key
const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString()

test.describe('手机看板 · GitHub', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-remote-gh-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'web')
  // A second project on GitHub: the answer has one entry per project, in the session list's order.
  const notes = join(root, 'notes')
  const home = join(root, 'home')
  const profile = join(root, 'profile')
  const argsFile = join(root, 'claude-args.json')
  const agyArgv = join(root, 'agy-argv')
  for (const dir of [bin, zdot, project, notes, home, profile]) mkdirSync(dir, { recursive: true })
  // The headless Claude the GUI session runs (src/main/gui/fixtures); the fake's chat answers `Hello: <text>`.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, 'fake-claude.mjs')}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  // A CLI-only agent (AGENT_GUI has none for it): its first message is a command-line argument, as §6.14 has it.
  writeFileSync(join(bin, 'agy'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${agyArgv}"\nexit 0\n`)
  chmodSync(join(bin, 'agy'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_ARGS_FILE="${argsFile}"\n`)
  const gh = fakeGh(bin, join(root, 'gh'))

  let app: ElectronApplication
  let page: Page
  let phone: TestPhone

  const workspace = (): { sessions: SavedSession[] } => JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8')) as { sessions: SavedSession[] }
  const sessions = async (): Promise<RemoteSession[]> => {
    const answer = await phone.request({ type: 'snapshot' })
    return answer.ok ? ((answer.data as { sessions: RemoteSession[] }).sessions ?? []) : []
  }
  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)

  test.beforeAll(async () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
    for (const [dir, repo] of [
      [project, 'web'],
      [notes, 'notes']
    ] as const) {
      writeFileSync(join(dir, 'README.md'), '# r\n')
      git(dir, 'init', '-q', '-b', 'main')
      git(dir, 'config', 'user.name', 'Jacob Yu')
      git(dir, 'add', '.')
      git(dir, 'commit', '-q', '-m', 'init')
      git(dir, 'remote', 'add', 'origin', `https://github.com/acme/${repo}.git`)
    }

    const author = (login: string) => ({ login })
    gh.setBoard(
      [
        { number: 142, title: '登录后刷新页面会丢失会话', url: 'https://github.com/acme/web/issues/142', author: author('mika'), labels: [{ name: 'bug' }], comments: [], updatedAt: ago(2) },
        { number: 139, title: 'Safari 17 上结算页白屏', url: 'https://github.com/acme/web/issues/139', author: author('lin-wei'), labels: [{ name: 'bug' }], comments: [{}, {}], updatedAt: ago(26) }
      ],
      [
        {
          number: 140,
          title: 'chore: 升级 Vite 到 7',
          url: 'https://github.com/acme/web/pull/140',
          author: author('jacob'),
          labels: [],
          comments: [{}, {}],
          updatedAt: ago(25),
          isDraft: false,
          reviewDecision: null,
          reviewRequests: [],
          statusCheckRollup: [
            { __typename: 'CheckRun', name: 'e2e (playwright)', status: 'COMPLETED', conclusion: 'FAILURE' },
            { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }
          ]
        }
      ]
    )
    gh.setView('issue', 139, {
      number: 139,
      title: 'Safari 17 上结算页白屏',
      url: 'https://github.com/acme/web/issues/139',
      state: 'OPEN',
      author: author('lin-wei'),
      createdAt: ago(72),
      labels: [{ name: 'bug' }],
      assignees: [{ login: 'jacob' }],
      body: '## 复现步骤\n\n1. 在 Safari 17.4 打开 /checkout\n2. 点「去付款」\n3. 页面白屏',
      comments: [
        { author: author('jacob'), createdAt: ago(24), body: '特性检测写反了：先判断了 `canMakePayment`。' },
        { author: author('mika'), createdAt: ago(6), body: '临时方案：checkout 页先不调 PaymentRequest。' }
      ]
    })

    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'web', rootPath: project },
          { id: 'p2', name: 'notes', rootPath: notes }
        ],
        worktrees: [
          { id: 'w1', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w2', projectId: 'p2', branch: 'main', path: notes, isMain: true }
        ],
        sessions: [{ id: 's1', worktreeId: 'w1', kind: 'shell', title: '终端', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ...gh.env, ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config'), HOME: home }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.waitForSelector('[data-region="sidebar"]')
    await setWindowSize(app, page, 1440, 900)
    const port = await freePort()
    await page.evaluate((p) => (globalThis as unknown as Hooks).tr.settings.update({ remote: { port: p } }), port)
    await page.evaluate(() => (globalThis as unknown as Hooks).tr.ui.openSettings())
    await page.getByRole('tab', { name: '手机' }).click()
    await page.getByRole('switch', { name: '允许手机连接' }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as unknown as Hooks).tr.remote.status())).pairing?.code, WITHIN).toBeTruthy()
    const status = await page.evaluate(() => (globalThis as unknown as Hooks).tr.remote.status())
    const url = `ws://127.0.0.1:${port}`
    phone = await TestPhone.connect(url, await pairPhone(url, macKey(status.pairing!.link), status.pairing!.code))
    await page.keyboard.press('Escape')
    // The window publishes its sessions and project roots a moment after the phone connects.
    await expect.poll(async () => (await phone.request({ type: 'snapshot' })).ok, WITHIN).toBe(true)
    await expect.poll(async () => {
      const answer = await phone.request({ type: 'github-board', scope: 'all' })
      return answer.ok ? (answer.data as { projects?: { project: string }[] }).projects?.map((p) => p.project) : undefined
    }, LONG).toEqual(['p1', 'p2'])
  })

  test.afterAll(async () => {
    phone?.close()
    await app?.close().catch(() => {})
  })

  test('the phone gets each project\'s issues and PRs, and one item\'s body and comments', async () => {
    const answer = await phone.request({ type: 'github-board', scope: 'all', force: true }, 30_000)
    expect(answer).toMatchObject({ ok: true, data: { gh: 'ready' } })
    const data = (answer as { data: BoardAnswer }).data
    // Every project is answered, in the session list's order: two gh lists that both come back.
    expect(data.projects.map((p) => p.project)).toEqual(['p1', 'p2'])
    expect(data.projects.map((p) => p.board.state)).toEqual(['ok', 'ok'])
    const board = data.projects[0]!.board
    expect(board).toMatchObject({ repo: { host: 'github.com', owner: 'acme', name: 'web' } })
    expect(board.issues.map((i) => i.number)).toEqual([142, 139])
    expect(board.prs.map((p) => p.number)).toEqual([140])
    expect(board.prs[0]!.checks.state).toBe('failing')
    expect(data.projects[1]!.board.issues.map((i) => i.number)).toEqual([142, 139])
    // The phone's 刷新 bypasses the minute of cache; a scope reaches gh as its filter.
    await phone.request({ type: 'github-board', scope: 'review', force: true }, 30_000)
    await expect.poll(() => gh.calls().some((c) => c.includes('--search=review-requested:@me')), WITHIN).toBe(true)

    const detail = await phone.request({ type: 'github-detail', project: 'p1', kind: 'issue', number: 139 }, 30_000)
    const result = (detail as { data: BoardDetailResult }).data
    expect(result.ok).toBe(true)
    expect(result.ok && result.detail).toMatchObject({ number: 139, title: 'Safari 17 上结算页白屏', commentCount: 2, state: 'open' })
    expect(result.ok && result.detail?.body).toContain('复现步骤')
    expect(result.ok && result.detail?.comments[1]?.body).toContain('临时方案')
    // A project the Mac does not have is refused, not guessed at.
    expect(await phone.request({ type: 'github-detail', project: 'nope', kind: 'issue', number: 139 })).toMatchObject({ ok: false })
  })

  test('交给 agent answers with the item\'s title, task and branch, and the session starts from it', async () => {
    const answer = await phone.request({ type: 'github-start', project: 'p1', kind: 'issue', number: 139 }, 30_000)
    expect(answer.ok).toBe(true)
    const start = (answer as { data: BoardStart }).data
    expect(start).toMatchObject({ link: { repo: 'github.com/acme/web', kind: 'issue', number: 139 }, title: '#139 Safari 17 上结算页白屏', branch: 'jacob/issue-139-safari-17', base: null })
    expect(start.startAt).toBeUndefined()
    expect(start.prompt).toContain('处理 GitHub issue acme/web#139')
    expect(start.prompt).toContain('<issue>')

    // The phone's 创建并发送: the same new-session command, with the task the form shows.
    const created = await phone.request(
      {
        type: 'new-session',
        project: 'p1',
        workdir: 'worktree',
        agent: 'claude',
        branch: start.branch,
        prompt: start.prompt,
        task: { link: start.link, title: start.title }
      },
      LONG.timeout
    )
    expect(created).toMatchObject({ ok: true, data: { session: expect.any(String) } })
    const id = (created as { data: { session: string } }).data.session

    // The Mac's session is the item's: title, link, and the worktree on the item's branch.
    await expect(row(id)).toContainText('#139 Safari 17 上结算页白屏', WITHIN)
    await expect.poll(() => workspace().sessions.find((s) => s.id === id)).toMatchObject({ title: '#139 Safari 17 上结算页白屏', titleSource: 'prompt', github: { repo: 'github.com/acme/web', kind: 'issue', number: 139 } })
    const worktrees = join(home, '.tr', 'worktrees', 'web')
    await expect.poll(() => (existsSync(worktrees) ? readdirSync(worktrees) : []).length, WITHIN).toBe(1)
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: join(worktrees, readdirSync(worktrees)[0]!) }).toString().trim()).toBe('jacob/issue-139-safari-17')

    // The phone now sees the session with the item it works on (RemoteSession.github).
    await expect.poll(async () => (await sessions()).find((s) => s.id === id)?.github, WITHIN).toEqual({ repo: 'github.com/acme/web', kind: 'issue', number: 139 })

    // The task reaches the agent as the session's first message: the fake answers it in the Mac's chat.
    await row(id).click()
    await expect(page.locator('[data-region="gui-feed"]')).toContainText('Hello: 处理 GitHub issue acme/web#139', WITHIN)
  })

  test('a terminal agent gets the task on its command line (handTask, as the desktop hands one over)', async () => {
    const answer = await phone.request(
      { type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'antigravity', branch: 'jacob/issue-139-cli', prompt: '处理 GitHub issue acme/web#139\n\n修好它', task: { link: { repo: 'github.com/acme/web', kind: 'issue', number: 139 }, title: '#139 Safari 17 上结算页白屏' } },
      LONG.timeout
    )
    expect(answer).toMatchObject({ ok: true })
    await expect.poll(() => (existsSync(agyArgv) ? readFileSync(agyArgv, 'utf8') : ''), WITHIN).toContain('--prompt-interactive')
    expect(readFileSync(agyArgv, 'utf8')).toContain('处理 GitHub issue acme/web#139')
  })
})
