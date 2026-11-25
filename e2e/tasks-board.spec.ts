// 看板 · 任务 (PRD F9 v1.246, Figma 115A4 / 115A4′ / 115A4b): open the tab, paste a card with 贴一张 (N), zoom with ⌘-scroll,
// and draw a seeded board in both themes at 100 % and 50 %. Main's task handlers belong to `src/main/tasks`; when they
// are not registered (the renderer is built ahead of them) this spec registers an in-memory stand-in for the same
// channels, so it runs either way. Screenshots go to test-results/tasks/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'tasks')
const WITHIN = { timeout: 20_000 }

let app: ElectronApplication
let page: Page

const overview = () => page.locator('[data-region="overview"]')
const board = () => page.getByTestId('task-board')
const note = (seq: number) => board().locator(`[data-task-id][data-seq="${seq}"]`)
const zoom = () => page.getByTestId('task-zoom')

type TestTask = { id: string; seq: number; projectId: string; title: string; body: string; createdBy: string; manual: string; createdAt: number; updatedAt: number; parentId?: string; sessionId?: string; note?: string }

/** Registers an in-memory stand-in for main's task channels unless the real ones are there. */
async function installTasks(): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as { __tasksFake?: { seed(tasks: unknown[]): void } }
    if (g.__tasksFake) return
    let tasks: Array<Record<string, unknown>> = []
    let nextSeq = 1
    const broadcast = () => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('task:changed', tasks)
    }
    try {
      ipcMain.handle('task:list', () => tasks)
    } catch {
      return // The real handlers are registered.
    }
    ipcMain.handle('task:create', (_e, draft: { projectId: string; title: string; parentId?: string; body?: string }) => {
      if (typeof draft?.title !== 'string' || draft.title.trim() === '') return null
      const now = Date.now()
      const task = { id: `t${nextSeq}`, seq: nextSeq++, projectId: draft.projectId, title: draft.title.trim(), body: draft.body ?? '', createdBy: 'user', manual: 'todo', createdAt: now, updatedAt: now, ...(draft.parentId ? { parentId: draft.parentId } : {}) }
      tasks = [...tasks, task]
      broadcast()
      return task
    })
    ipcMain.handle('task:update', (_e, id: string, patch: Record<string, unknown>) => {
      const at = tasks.findIndex((t) => t.id === id)
      if (at < 0) return null
      tasks = tasks.map((t, i) => (i === at ? { ...t, ...patch, updatedAt: Date.now() } : t))
      broadcast()
      return tasks[at]
    })
    ipcMain.handle('task:remove', (_e, id: string) => {
      const doomed = new Set([id])
      for (let again = true; again; ) {
        again = false
        for (const t of tasks) {
          if (typeof t.parentId === 'string' && doomed.has(t.parentId) && !doomed.has(t.id as string)) {
            doomed.add(t.id as string)
            again = true
          }
        }
      }
      tasks = tasks.filter((t) => !doomed.has(t.id as string))
      broadcast()
    })
    g.__tasksFake = {
      seed(next) {
        tasks = next as Array<Record<string, unknown>>
        nextSeq = Math.max(1, ...tasks.map((t) => (t.seq as number) + 1))
        broadcast()
      }
    }
  })
}

const seed = (tasks: TestTask[]) => app.evaluate((_a, list) => (globalThis as unknown as { __tasksFake?: { seed(t: unknown[]): void } }).__tasksFake?.seed(list), tasks)

const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
  }, theme)

async function shoot(name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  await setTheme('dark')
}

async function openTasks(view?: { x: number; y: number; zoom: number }): Promise<void> {
  await page.addInitScript((v) => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    globalThis.localStorage?.removeItem('tr.overview.v1')
    if (v) globalThis.localStorage?.setItem('tr.tasks.view.v1', JSON.stringify(v))
    else globalThis.localStorage?.removeItem('tr.tasks.view.v1')
  }, view)
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^看板/ }).first().click()
  await overview().getByRole('tab', { name: '任务' }).click()
  await expect(board()).toBeVisible(WITHIN)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await installTasks()
})

test.afterAll(async () => {
  await app?.close()
})

test('the 任务 tab sits between 进度 and GitHub and opens the canvas', async () => {
  await openTasks()
  const tabs = await overview().getByRole('tab').allTextContents()
  expect(tabs).toEqual(['进度', '任务', 'GitHub'])
  await expect(overview().getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('task-zoom')).toHaveText('100%')
})

test('贴一张 (N) pastes a card: type a title, Enter, and the note shows', async () => {
  await board().click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('n')
  const input = page.getByTestId('task-compose-input')
  await expect(input).toBeVisible()
  await input.fill('梳理 auth 中间件的依赖')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('task-compose')).toHaveCount(0)
  await expect(board().locator('[data-task-id]', { hasText: '梳理 auth 中间件的依赖' })).toBeVisible(WITHIN)
})

test('⌘-scroll zooms around the pointer, and the zoom label follows', async () => {
  const box = (await board().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const before = await zoom().textContent()
  await page.keyboard.down('Meta')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Meta')
  await expect.poll(() => zoom().textContent()).not.toBe(before)
  expect(parseInt((await zoom().textContent()) ?? '0', 10)).toBeGreaterThan(parseInt(before ?? '0', 10))
})

test('a seeded board: notes, links, leader label, both themes at 100 % and 50 %', async () => {
  const t = Date.now()
  const base = { body: '', createdBy: 'user', manual: 'todo', updatedAt: t }
  const mk = (seq: number, projectId: string, title: string, over: Partial<TestTask> = {}): TestTask => ({ ...base, id: `s${seq}`, seq, projectId, title, createdAt: t + seq, ...over })
  await seed([
    mk(21, 'p-acme', 'Cookie 会话迁移', { sessionId: 's-cookie' }),
    mk(22, 'p-acme', '登录接口测试', { parentId: 's21', sessionId: 's-nav' }),
    mk(23, 'p-acme', '会话过期自动刷新', { parentId: 's21', sessionId: 's-perf' }),
    mk(24, 'p-acme', '审阅刷新逻辑', { parentId: 's23', sessionId: 's-sidebar' }),
    mk(25, 'p-acme', '移除 localStorage 读写', { parentId: 's21', sessionId: 's-graph' }),
    mk(26, 'p-acme', '扫描 localStorage 调用', { parentId: 's25', sessionId: 's-acme-main', note: '搜索 localStorage' }),
    mk(27, 'p-acme', '梳理 auth 中间件的依赖', { parentId: 's21' }),
    mk(28, 'p-acme', '修复 Safari 17 结算页白屏'),
    mk(7, 'p-tr', '侧边栏状态聚合', { sessionId: 's-graph' }),
    mk(8, 'p-tr', '按状态分组的排序', { parentId: 's7', manual: 'done' }),
    mk(9, 'p-tr', '状态聚合单测', { parentId: 's7' })
  ])
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await page.evaluate(() => {
    const ws = (globalThis as unknown as { __trWorkspace: { setState(p: unknown): void; getState(): { sessions: Array<{ id: string; status: string }> } } }).__trWorkspace
    ws.setState({ leaderSessions: { 'p-acme': 's-cookie' }, sessions: ws.getState().sessions.map((s) => (s.id === 's-graph' ? { ...s, status: 'needs_you' } : s)) })
  })
  await expect(note(21)).toBeVisible(WITHIN)
  await expect(note(25)).toHaveAttribute('data-state', 'attention')
  await expect(note(21)).toContainText('1 个子任务等你处理')
  await expect(note(22)).toHaveAttribute('data-state', 'done')
  await expect(board().getByTestId('task-project-label')).toHaveCount(2)
  await expect(page.getByTestId('task-activity')).toBeVisible()
  await page.mouse.move(520, 470)
  await page.waitForTimeout(500)
  await shoot('board-100')

  await openTasks({ x: 24, y: 24, zoom: 0.5 })
  await page.evaluate(() => {
    const ws = (globalThis as unknown as { __trWorkspace: { setState(p: unknown): void; getState(): { sessions: Array<{ id: string; status: string }> } } }).__trWorkspace
    ws.setState({ leaderSessions: { 'p-acme': 's-cookie' }, sessions: ws.getState().sessions.map((s) => (s.id === 's-graph' ? { ...s, status: 'needs_you' } : s)) })
  })
  await expect(board()).toHaveAttribute('data-drawing', 'chip')
  await expect(zoom()).toHaveText('50%')
  await page.mouse.move(760, 520)
  await page.waitForTimeout(500)
  await shoot('board-50')
})

test('Enter opens the card; 删除 asks first and removes it with what is below', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await note(28).click()
  await page.keyboard.press('Enter')
  const detail = page.getByTestId('task-detail')
  await expect(detail).toBeVisible()
  await shoot('detail')
  await detail.getByRole('button', { name: '删除' }).click()
  await expect(note(28)).toHaveCount(0, WITHIN)
})

test('the board has the keyboard when the tab opens: N works without a click on the canvas', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await page.keyboard.press('n')
  await expect(page.getByTestId('task-compose-input')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-compose')).toHaveCount(0)
})

test('Space-drag over a note selects it on a plain click; a window blur lets go of Space', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(27)).toBeVisible(WITHIN)
  await board().click({ position: { x: 600, y: 700 } })
  await expect(note(27)).toHaveAttribute('data-selected', 'false')
  await page.keyboard.down(' ')
  await expect(board()).toHaveAttribute('data-space', 'true')
  await note(27).click()
  await expect(note(27)).toHaveAttribute('data-selected', 'true')
  await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
  await expect(board()).toHaveAttribute('data-space', 'false')
  await page.keyboard.up(' ')
})

test('the floating panes are not canvas: pressing and scrolling on them does not pan', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  const before = await note(21).boundingBox()
  const bar = (await page.locator('[role="toolbar"]').boundingBox())!
  // The empty strip on the toolbar's left edge, and the zoom control's value.
  await page.mouse.move(bar.x + 2, bar.y + bar.height / 2)
  await page.mouse.down()
  await page.mouse.move(bar.x + 80, bar.y - 120, { steps: 6 })
  await page.mouse.up()
  const zoomBox = (await page.getByTestId('task-zoom').boundingBox())!
  await page.mouse.move(zoomBox.x + 4, zoomBox.y + 4)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(150)
  expect(await note(21).boundingBox()).toEqual(before)
})

test('「动态」 starts collapsed on a narrow canvas and keeps the user’s own toggle', async () => {
  await setWindowSize(app, page, 1000, 900)
  await openTasks({ x: 24, y: 24, zoom: 1 })
  // Something has to happen for the panel to have anything to show: a card appears.
  const t = Date.now()
  await seed([{ id: 'n1', seq: 1, projectId: 'p-acme', title: '第一张', body: '', createdBy: 'user', manual: 'todo', createdAt: t, updatedAt: t }])
  await expect(note(1)).toBeVisible(WITHIN)
  await seed([
    { id: 'n1', seq: 1, projectId: 'p-acme', title: '第一张', body: '', createdBy: 'user', manual: 'todo', createdAt: t, updatedAt: t },
    { id: 'n2', seq: 2, projectId: 'p-acme', title: '第二张', body: '', createdBy: 'user', manual: 'todo', createdAt: t + 1, updatedAt: t }
  ])
  const panel = page.getByTestId('task-activity')
  await expect(panel).toBeVisible(WITHIN)
  await expect(panel).toHaveAttribute('data-open', 'false')
  await panel.getByRole('button').first().click()
  await expect(panel).toHaveAttribute('data-open', 'true')
  expect(await page.evaluate(() => globalThis.localStorage?.getItem('tr.tasks.activity.v1'))).toBe('open')
  await setWindowSize(app, page, 1440, 900)
})
