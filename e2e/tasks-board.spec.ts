// 看板 · 任务 (PRD F9 v1.249, Figma 115A4 / 115A4′ / 115A4b) against main's real task handlers (`src/main/tasks`, stored in
// `<userData>/tasks.json`): open the tab, paste a card with 贴一张 (N), zoom with ⌘-scroll, keep it across a reload, remove
// a parent with its children, and draw a seeded board in both themes at 100 % and 50 %. Cards are made through
// `window.tr.tasks`; every test starts from an empty board and finds notes by the id `create` returned. Screenshots go
// to test-results/tasks/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'tasks')
const WITHIN = { timeout: 20_000 }

let app: ElectronApplication
let page: Page

const overview = () => page.locator('[data-region="overview"]')
const board = () => page.getByTestId('task-board')
const note = (card: Made) => board().locator(`[data-task-id="${card.id}"]`)
const zoom = () => page.getByTestId('task-zoom')

interface Made {
  id: string
  seq: number
  title: string
}
interface MakeOptions {
  parent?: Made
  manual?: 'done' | 'canceled'
  sessionId?: string
  note?: string
}

/** Makes a card through the real handler; `manual` / `sessionId` / `note` go in with an update, as the app does it. */
async function make(projectId: string, title: string, options: MakeOptions = {}): Promise<Made> {
  return page.evaluate(
    async ([projectId, title, parentId, patch]) => {
      const tasks = (globalThis as unknown as { tr: { tasks: { create(d: unknown): Promise<{ id: string; seq: number; title: string } | null>; update(id: string, p: unknown): Promise<unknown> } } }).tr.tasks
      const made = await tasks.create({ projectId, title, ...(parentId ? { parentId } : {}) })
      if (!made) throw new Error(`refused: ${title}`)
      if (Object.keys(patch as object).length > 0) await tasks.update(made.id, patch)
      return { id: made.id, seq: made.seq, title: made.title }
    },
    [projectId, title, options.parent?.id ?? '', { ...(options.manual ? { manual: options.manual } : {}), ...(options.sessionId ? { sessionId: options.sessionId } : {}), ...(options.note ? { note: options.note } : {}) }] as const
  )
}

/** Removes every card (a root takes its children with it), so each test starts from an empty board. */
async function clearBoard(): Promise<void> {
  await page.evaluate(async () => {
    const tasks = (globalThis as unknown as { tr: { tasks: { list(): Promise<Array<{ id: string; parentId?: string }>>; remove(id: string): Promise<void> } } }).tr.tasks
    for (const t of await tasks.list()) if (!t.parentId) await tasks.remove(t.id)
    for (const t of await tasks.list()) await tasks.remove(t.id)
  })
  expect(await listTasks()).toHaveLength(0)
}

const listTasks = () => page.evaluate(() => (globalThis as unknown as { tr: { tasks: { list(): Promise<unknown[]> } } }).tr.tasks.list())

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
  await page.waitForFunction(() => Boolean((globalThis as unknown as { tr?: unknown }).tr))
})

test.beforeEach(async () => {
  await clearBoard()
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
  await openTasks()
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
  await openTasks()
  const box = (await board().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const before = await zoom().textContent()
  await page.keyboard.down('Meta')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Meta')
  await expect.poll(() => zoom().textContent()).not.toBe(before)
  expect(parseInt((await zoom().textContent()) ?? '0', 10)).toBeGreaterThan(parseInt(before ?? '0', 10))
})

test('a seeded board: notes, links, no project labels, both themes at 100 % and 50 %', async () => {
  const root = await make('p-acme', 'Cookie 会话迁移', { sessionId: 's-cookie' })
  const login = await make('p-acme', '登录接口测试', { parent: root, sessionId: 's-nav' })
  const refresh = await make('p-acme', '会话过期自动刷新', { parent: root, sessionId: 's-perf' })
  await make('p-acme', '审阅刷新逻辑', { parent: refresh, sessionId: 's-sidebar' })
  const remove = await make('p-acme', '移除 localStorage 读写', { parent: root, sessionId: 's-graph' })
  await make('p-acme', '扫描 localStorage 调用', { parent: remove, sessionId: 's-acme-main', note: '搜索 localStorage' })
  await make('p-acme', '梳理 auth 中间件的依赖', { parent: root })
  await make('p-acme', '修复 Safari 17 结算页白屏')
  const sidebar = await make('p-tr', '侧边栏状态聚合', { sessionId: 's-graph' })
  await make('p-tr', '按状态分组的排序', { parent: sidebar, manual: 'done' })
  await make('p-tr', '状态聚合单测', { parent: sidebar })
  const setUp = async () => {
    await page.evaluate(() => {
      const ws = (globalThis as unknown as { __trWorkspace: { setState(p: unknown): void; getState(): { sessions: Array<{ id: string; status: string }> } } }).__trWorkspace
      ws.setState({ sessions: ws.getState().sessions.map((x) => (x.id === 's-graph' ? { ...x, status: 'needs_you' } : x)) })
    })
  }

  await openTasks({ x: 24, y: 24, zoom: 1 })
  await setUp()
  await expect(note(root)).toBeVisible(WITHIN)
  await expect(note(remove)).toHaveAttribute('data-state', 'attention')
  await expect(note(root)).toContainText('1 个子任务等你处理')
  await expect(note(login)).toHaveAttribute('data-state', 'done')
  await expect(board().getByTestId('task-project-label')).toHaveCount(0)
  await expect(page.getByTestId('task-activity')).toBeVisible()
  await page.mouse.move(520, 470)
  await page.waitForTimeout(500)
  await shoot('board-100')

  await openTasks({ x: 24, y: 24, zoom: 0.5 })
  await setUp()
  await expect(board()).toHaveAttribute('data-drawing', 'chip')
  await expect(zoom()).toHaveText('50%')
  await page.mouse.move(760, 520)
  await page.waitForTimeout(500)
  await shoot('board-50')
})

test('Enter opens the card; 删除 asks first and removes it together with what is below', async () => {
  const parent = await make('p-acme', '父任务')
  const child = await make('p-acme', '子任务', { parent })
  const other = await make('p-acme', '别的任务')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(child)).toBeVisible(WITHIN)
  await note(parent).click()
  await page.keyboard.press('Enter')
  const detail = page.getByTestId('task-detail')
  await expect(detail).toBeVisible()
  await shoot('detail')
  await detail.getByRole('button', { name: '删除' }).click()
  await expect(note(parent)).toHaveCount(0, WITHIN)
  await expect(note(child)).toHaveCount(0)
  await expect(note(other)).toBeVisible()
})

test('the board has the keyboard when the tab opens: N works without a click on the canvas', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await page.keyboard.press('n')
  await expect(page.getByTestId('task-compose-input')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-compose')).toHaveCount(0)
})

test('Space-drag over a note selects it on a plain click; a window blur lets go of Space', async () => {
  const card = await make('p-acme', '梳理依赖版本')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(card)).toBeVisible(WITHIN)
  await board().click({ position: { x: 600, y: 700 } })
  await expect(note(card)).toHaveAttribute('data-selected', 'false')
  await page.keyboard.down(' ')
  await expect(board()).toHaveAttribute('data-space', 'true')
  await note(card).click()
  await expect(note(card)).toHaveAttribute('data-selected', 'true')
  await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
  await expect(board()).toHaveAttribute('data-space', 'false')
  await page.keyboard.up(' ')
})

test('the floating panes are not canvas: pressing and scrolling on them does not pan', async () => {
  const card = await make('p-acme', 'Cookie 会话迁移')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(card)).toBeVisible(WITHIN)
  const before = await note(card).boundingBox()
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
  expect(await note(card).boundingBox()).toEqual(before)
})

test('「动态」 starts collapsed on a narrow canvas and keeps the user’s own toggle', async () => {
  await setWindowSize(app, page, 1000, 900)
  await openTasks({ x: 24, y: 24, zoom: 1 })
  // The panel has something to show once a card appears while the board is open.
  const first = await make('p-acme', '第一张')
  await expect(note(first)).toBeVisible(WITHIN)
  await make('p-acme', '第二张')
  const panel = page.getByTestId('task-activity')
  await expect(panel).toBeVisible(WITHIN)
  await expect(panel).toHaveAttribute('data-open', 'false')
  await panel.getByRole('button').first().click()
  await expect(panel).toHaveAttribute('data-open', 'true')
  expect(await page.evaluate(() => globalThis.localStorage?.getItem('tr.tasks.activity.v1'))).toBe('open')
  await setWindowSize(app, page, 1440, 900)
})

test('a card pasted in the UI comes back after a reload, from tasks.json through main', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await board().click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('n')
  await page.getByTestId('task-compose-input').fill('重载后还在的任务')
  await page.keyboard.press('Enter')
  const shown = board().locator('[data-task-id]', { hasText: '重载后还在的任务' })
  await expect(shown).toBeVisible(WITHIN)
  const id = await shown.getAttribute('data-task-id')

  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(board().locator(`[data-task-id="${id}"]`)).toBeVisible(WITHIN)
  // And it is in the file main keeps (atomic write: give it a moment).
  const file = await app.evaluate(({ app: electron }) => `${electron.getPath('userData')}/tasks.json`)
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('重载后还在的任务')
})

test('removing a parent through main removes its children and their notes disappear', async () => {
  const parent = await make('p-acme', '会被删的父卡')
  const child = await make('p-acme', '跟着走的子卡', { parent })
  const grandchild = await make('p-acme', '跟着走的孙卡', { parent: child })
  const kept = await make('p-tr', '留下的卡')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  for (const card of [parent, child, grandchild, kept]) await expect(note(card)).toBeVisible(WITHIN)
  await page.evaluate((id) => (globalThis as unknown as { tr: { tasks: { remove(id: string): Promise<void> } } }).tr.tasks.remove(id), parent.id)
  for (const card of [parent, child, grandchild]) await expect(note(card)).toHaveCount(0, WITHIN)
  await expect(note(kept)).toBeVisible()
  expect(await listTasks()).toHaveLength(1)
})

test('dragging a card moves it and its children, a reload keeps the place, and a click without movement only selects', async () => {
  const root = await make('p-acme', '拖动的根卡')
  const child = await make('p-acme', '跟着走的子卡', { parent: root })
  const other = await make('p-acme', '没动的卡')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  for (const card of [root, child, other]) await expect(note(card)).toBeVisible(WITHIN)
  const box = async (card: Made) => (await note(card).boundingBox())!

  // A click that never moves selects and leaves the card where it is.
  const rootAt = await box(root)
  await note(root).click()
  await expect(note(root)).toHaveAttribute('data-selected', 'true')
  expect(await box(root)).toEqual(rootAt)

  const before = { root: await box(root), child: await box(child), other: await box(other) }
  const from = { x: before.root.x + before.root.width / 2, y: before.root.y + 60 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 })
  await page.mouse.move(from.x + 120, from.y + 90, { steps: 6 })
  await expect(board()).toHaveAttribute('data-dragging', 'true')
  await expect(note(root)).toHaveAttribute('data-dragging', 'true')
  await shoot('drag-mid')
  await page.mouse.up()
  await expect(board()).toHaveAttribute('data-dragging', 'false', WITHIN)

  const after = { root: await box(root), child: await box(child), other: await box(other) }
  expect(after.root.x - before.root.x).toBeCloseTo(120, 0)
  expect(after.root.y - before.root.y).toBeCloseTo(90, 0)
  expect(after.child.x - before.child.x).toBeCloseTo(120, 0)
  expect(after.child.y - before.child.y).toBeCloseTo(90, 0)
  expect(after.other).toEqual(before.other)
  const saved = (await listTasks()) as Array<{ id: string; pos?: { x: number; y: number } }>
  expect(saved.find((t) => t.id === root.id)?.pos).toBeDefined()
  expect(saved.find((t) => t.id === child.id)?.pos).toBeUndefined()

  // The place is in tasks.json: a reload shows the card where it was left.
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(root)).toBeVisible(WITHIN)
  const reloaded = await box(root)
  expect(reloaded.x).toBeCloseTo(after.root.x, 0)
  expect(reloaded.y).toBeCloseTo(after.root.y, 0)
  await shoot('board-moved')
})
