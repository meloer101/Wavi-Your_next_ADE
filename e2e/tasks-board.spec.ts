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

test('Enter opens the card; 删除 there removes it with what is below, without asking, and the bar offers the undo', async () => {
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
  await expect(page.getByTestId('task-undo')).toContainText(`已删除 #${parent.seq} 和 1 张子任务`)
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
  // The card springs from 1.02 × back to 1 ×: measure it once it has settled.
  await page.waitForTimeout(700)

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

test('the new-card box: ⇧Enter is a new line, Enter pastes, the first line is the title and the rest the body; the leader menu lists the agents and 暂不派发', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await board().click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('n')
  const input = page.getByTestId('task-compose-input')
  await expect(page.getByTestId('task-compose')).toBeVisible()
  await expect(page.getByTestId('task-compose')).toHaveCSS('width', '460px')
  await input.fill('梳理 auth 中间件的依赖')
  await input.press('Shift+Enter')
  await input.pressSequentially('先列出所有调用点，再按风险排序。')
  await input.press('Shift+Enter')
  await input.pressSequentially('只读，不改代码。')
  await expect(page.getByTestId('task-compose')).toBeVisible()
  expect(await input.inputValue()).toBe('梳理 auth 中间件的依赖\n先列出所有调用点，再按风险排序。\n只读，不改代码。')

  // The leader menu: every CLI agent, the ones not installed greyed, then 暂不派发; the chosen one is ticked.
  await page.getByTestId('task-leader').click()
  const options = page.getByRole('option')
  await expect(options).toHaveCount(20)
  await expect(options.last()).toHaveText('暂不派发')
  await expect(page.getByRole('option', { name: /Claude Code/ })).toHaveAttribute('aria-selected', 'true')
  await shoot('compose-leader-menu')
  await page.getByRole('option', { name: '暂不派发' }).click()
  await expect(page.getByTestId('task-leader')).toContainText('暂不派发')
  await expect(page.getByTestId('task-model')).toHaveCount(0)
  await expect(page.getByTestId('task-effort')).toHaveCount(0)
  expect(await page.evaluate(() => globalThis.localStorage?.getItem('tr.tasks.leader.v1'))).toBe('none')

  await input.press('Enter')
  await expect(page.getByTestId('task-compose')).toHaveCount(0)
  await expect.poll(async () => ((await listTasks()) as Array<{ title: string; body: string }>)[0], WITHIN).toMatchObject({
    title: '梳理 auth 中间件的依赖',
    body: '先列出所有调用点，再按风险排序。\n只读，不改代码。'
  })
  // Esc drops the box; the leader choice is the last one made.
  await page.keyboard.press('n')
  await expect(page.getByTestId('task-leader')).toContainText('暂不派发')
  await page.getByTestId('task-compose-input').press('Escape')
  await expect(page.getByTestId('task-compose')).toHaveCount(0)
  await page.evaluate(() => globalThis.localStorage?.removeItem('tr.tasks.leader.v1'))
})

/** Records every `data-tilt` and `data-fx` value a note takes (they last 90 ms / 1.2 s: polling could miss them). */
const watchNotes = () =>
  page.evaluate(() => {
    const g = globalThis as unknown as { __seen?: { tilt: string[]; fx: string[]; observer: MutationObserver } }
    g.__seen?.observer.disconnect()
    const seen = { tilt: [] as string[], fx: [] as string[], observer: null as unknown as MutationObserver }
    seen.observer = new MutationObserver((records) => {
      for (const r of records) {
        // A ghost is inserted with its `data-fx` already set.
        for (const added of Array.from(r.addedNodes)) {
          if (added instanceof HTMLElement && added.dataset.fx) seen.fx.push(added.dataset.fx)
        }
        if (r.type !== 'attributes') continue
        const el = r.target as HTMLElement
        if (r.attributeName === 'data-tilt' && el.dataset.tilt) seen.tilt.push(el.dataset.tilt)
        if (r.attributeName === 'data-fx' && el.dataset.fx) seen.fx.push(el.dataset.fx)
      }
    })
    seen.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tilt', 'data-fx'] })
    g.__seen = seen
  })
const seenNotes = () => page.evaluate(() => (globalThis as unknown as { __seen: { tilt: string[]; fx: string[] } }).__seen)
const ripples = () => page.locator('canvas[data-ripples]').first().getAttribute('data-ripples')

async function dragFast(card: Made): Promise<void> {
  const box = (await note(card).boundingBox())!
  const from = { x: box.x + box.width / 2, y: box.y + 60 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y, { steps: 2 })
  await page.mouse.move(from.x + 260, from.y + 30, { steps: 3 })
  await page.waitForTimeout(40)
  await page.mouse.move(from.x + 300, from.y + 30)
  await page.waitForTimeout(160)
  await page.mouse.up()
}

test('motion: a pasted card lands with a ripple, a held card tilts, and what is on the board at open does not animate', async () => {
  const before = await make('p-acme', '开着就在的卡')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(before)).toBeVisible(WITHIN)
  await page.waitForTimeout(400)
  await watchNotes()
  // Nothing played for the card that was already there.
  await expect(note(before)).not.toHaveAttribute('data-fx', /./)
  expect(await ripples()).toBe('0')

  const fresh = await make('p-acme', '新贴的卡')
  await expect(note(fresh)).toHaveAttribute('data-fx', /land/, WITHIN)
  await expect.poll(ripples, { timeout: 2000 }).not.toBe('0')
  // The mark goes again after a moment (animations only on the event).
  await expect(note(fresh)).not.toHaveAttribute('data-fx', /./, WITHIN)
  await expect.poll(ripples, WITHIN).toBe('0')
  await shoot('motion-landed')

  await dragFast(before)
  const seen = await seenNotes()
  expect(seen.tilt.length).toBeGreaterThan(0)
  expect(seen.tilt.every((t) => Math.abs(Number(t)) <= 3)).toBe(true)
  await expect(note(before)).not.toHaveAttribute('data-tilt', /./, WITHIN)
})

test('motion: a child slides out along a line that draws in; a deleted card leaves as a ghost', async () => {
  const parent = await make('p-acme', '会拆分的卡')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(parent)).toBeVisible(WITHIN)
  await page.waitForTimeout(300)
  await watchNotes()
  const kid = await make('p-acme', '拆出来的子卡', { parent })
  await expect(note(kid)).toHaveAttribute('data-fx', /slide/, WITHIN)
  await expect(board().locator('g[data-fx="draw"]')).toHaveCount(1)
  await shoot('motion-split')
  await expect(board().locator('g[data-fx="draw"]')).toHaveCount(0, WITHIN)

  await page.evaluate((id) => (globalThis as unknown as { tr: { tasks: { remove(id: string): Promise<void> } } }).tr.tasks.remove(id), kid.id)
  await expect(note(kid)).toHaveCount(0, WITHIN)
  expect((await seenNotes()).fx.some((v) => v.includes('leave'))).toBe(true)
})

test('motion: with the system’s reduced motion there is no ripple, no tilt and no slide', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  try {
    const before = await make('p-acme', '安静的卡')
    await openTasks({ x: 24, y: 24, zoom: 1 })
    await expect(note(before)).toBeVisible(WITHIN)
    await page.waitForTimeout(300)
    await watchNotes()
    const fresh = await make('p-acme', '安静地贴上')
    await expect(note(fresh)).toBeVisible(WITHIN)
    await page.waitForTimeout(700)
    expect(await ripples()).toBe('0')
    await dragFast(before)
    const seen = await seenNotes()
    expect(seen.tilt).toEqual([])
    expect(await ripples()).toBe('0')
  } finally {
    await page.emulateMedia({ reducedMotion: null })
  }
})

// ── PRD F9 v1.252: menus, marquee, keys, the new-card box, undo, detail ──

type Listed = { id: string; seq: number; title: string; body: string; parentId?: string; manual: string; pos?: { x: number; y: number } }
const cardsNow = async (): Promise<Listed[]> => (await listTasks()) as Listed[]
const place = (card: Made, x: number, y: number) =>
  page.evaluate(([id, x, y]) => (globalThis as unknown as { tr: { tasks: { update(id: string, p: unknown): Promise<unknown> } } }).tr.tasks.update(id as string, { pos: { x, y } }), [card.id, x, y] as const)
const menu = () => page.getByTestId('task-menu')
const item = (name: string | RegExp) => menu().getByRole('menuitem', { name })
const selected = () => board().locator('[data-task-id][data-selected="true"]')

/** Drags a box on the canvas from one board point to another; `during` runs while the button is down. */
async function marquee(from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>): Promise<void> {
  const box = (await board().boundingBox())!
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
  await during?.()
  await page.mouse.up()
}

/** The models a probe would have found, so no CLI is asked. */
const seedModels = () =>
  page.evaluate(() => {
    const ws = (globalThis as unknown as { __trWorkspace: { getState(): { rememberGuiPicks(agent: string, picks: unknown): void } } }).__trWorkspace
    const models = [
      { value: 'fable', label: 'Fable 5.2' },
      { value: 'opus', label: 'Opus 5.5' },
      { value: 'sonnet', label: 'Sonnet 5.5' },
      { value: 'haiku', label: 'Haiku 5.5' }
    ]
    ws.getState().rememberGuiPicks('claude', { models, modelsFrom: 'live' })
    ws.getState().rememberGuiPicks('codex', { models: [{ value: 'gpt-6-sol', label: 'gpt-6-sol' }], modelsFrom: 'live' })
  })

const forgetPicks = () =>
  page.evaluate(() => {
    for (const key of ['tr.tasks.leader.v1', 'tr.tasks.picks.v1']) globalThis.localStorage?.removeItem(key)
  })

test('right-click a card → 删除 removes it and its children; 撤销 brings them back with the same #numbers', async () => {
  const parent = await make('p-acme', '要删的父卡')
  const child = await make('p-acme', '要删的子卡', { parent })
  const grandchild = await make('p-acme', '要删的孙卡', { parent: child })
  const other = await make('p-acme', '留下的卡')
  await place(parent, 40, 60)
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(grandchild)).toBeVisible(WITHIN)
  const before = await cardsNow()

  await note(parent).click({ button: 'right' })
  await expect(note(parent)).toHaveAttribute('data-selected', 'true')
  await expect(menu().getByRole('menuitem')).toHaveText([/打开/, /派给主理人…/, /编辑/, /加子任务/, /恢复自动排/, /取消任务/, /删除/])
  await item('删除').click()
  for (const card of [parent, child, grandchild]) await expect(note(card)).toHaveCount(0, WITHIN)
  await expect(note(other)).toBeVisible()
  const undo = page.getByTestId('task-undo')
  await expect(undo).toContainText(`已删除 #${parent.seq} 和 2 张子任务`)
  await undo.getByRole('button', { name: '撤销' }).click()
  for (const card of [parent, child, grandchild]) await expect(note(card)).toBeVisible(WITHIN)
  await expect(undo).toHaveCount(0)
  const key = (c: Listed) => c.seq
  expect((await cardsNow()).sort((a, b) => key(a) - key(b))).toEqual(before.sort((a, b) => key(a) - key(b)))

  // A grandchild has no 加子任务; Esc closes the menu first, then clears the selection.
  await note(grandchild).click({ button: 'right' })
  await expect(menu()).toBeVisible()
  await expect(item(/加子任务/)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(selected()).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(selected()).toHaveCount(0)
})

test('the marquee selects the cards it touches; ⇧-click adds and takes away; Delete removes them and ⌘Z undoes', async () => {
  const cards = [await make('p-acme', '框里一'), await make('p-acme', '框里二'), await make('p-acme', '框里三')]
  const outside = await make('p-acme', '框外')
  for (const [i, card] of cards.entries()) await place(card, 100, 40 + i * 140)
  await place(outside, 600, 40)
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(outside)).toBeVisible(WITHIN)
  await expect(selected()).toHaveCount(0)

  await marquee({ x: 60, y: 30 }, { x: 200, y: 400 }, async () => {
    await expect(page.getByTestId('task-marquee')).toBeVisible()
  })
  await expect(page.getByTestId('task-marquee')).toHaveCount(0)
  await expect(selected()).toHaveCount(3)
  await expect(note(outside)).toHaveAttribute('data-selected', 'false')

  await note(outside).click({ modifiers: ['Shift'] })
  await expect(selected()).toHaveCount(4)
  await note(outside).click({ modifiers: ['Shift'] })
  await expect(selected()).toHaveCount(3)

  // The selection drags together.
  const before = await Promise.all(cards.map(async (c) => (await note(c).boundingBox())!))
  await page.mouse.move(before[0]!.x + 100, before[0]!.y + 50)
  await page.mouse.down()
  await page.mouse.move(before[0]!.x + 160, before[0]!.y + 80, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  for (const [i, card] of cards.entries()) {
    const after = (await note(card).boundingBox())!
    expect(after.x - before[i]!.x).toBeCloseTo(60, 0)
    expect(after.y - before[i]!.y).toBeCloseTo(30, 0)
  }
  await expect(selected()).toHaveCount(3)

  await page.keyboard.press('Backspace')
  for (const card of cards) await expect(note(card)).toHaveCount(0, WITHIN)
  await expect(page.getByTestId('task-undo')).toContainText('已删除 3 张任务')
  await page.keyboard.press('Meta+z')
  for (const card of cards) await expect(note(card)).toBeVisible(WITHIN)
  expect((await cardsNow()).map((c) => c.seq).sort()).toEqual([...cards, outside].map((c) => c.seq).sort())

  await page.keyboard.press('Meta+a')
  await expect(selected()).toHaveCount(4)
  await page.keyboard.press('Delete')
  await expect(board().locator('[data-task-id]')).toHaveCount(0, WITHIN)
})

test('the canvas menu pastes where it was asked; ⇥ and 加子任务 add a sub-card without a leader', async () => {
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await board().click({ button: 'right', position: { x: 120, y: 140 } })
  await expect(menu().getByRole('menuitem')).toHaveText([/在这里贴一张/, /全选/, /适应窗口/])
  await item(/在这里贴一张/).click()
  const compose = page.getByTestId('task-compose')
  await expect(compose).toBeVisible()
  const boardBox = (await board().boundingBox())!
  const composeBox = (await compose.boundingBox())!
  expect(composeBox.x - boardBox.x).toBeCloseTo(120, 0)
  expect(composeBox.y - boardBox.y).toBeCloseTo(140, 0)
  await page.getByTestId('task-leader').click()
  await page.getByRole('option', { name: '暂不派发' }).click()
  await page.getByTestId('task-compose-input').fill('贴在这里')
  await page.keyboard.press('Enter')
  await expect(compose).toHaveCount(0)
  await expect.poll(async () => (await cardsNow())[0]?.pos, WITHIN).toEqual({ x: 96, y: 116 })

  const root = (await cardsNow())[0]!
  await expect(note(root)).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Tab')
  await expect(compose).toBeVisible()
  await expect(page.getByTestId('task-leader')).toHaveCount(0)
  // A key on one of the box's buttons is not about the selected card behind it.
  await page.getByTestId('task-compose-input').fill('x')
  await page.getByTestId('task-compose-submit').focus()
  await page.keyboard.press('Backspace')
  await expect(note(root as unknown as Made)).toBeVisible()
  expect(await cardsNow()).toHaveLength(1)
  await page.getByTestId('task-compose-input').fill('手动子卡')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await cardsNow()).find((c) => c.title === '手动子卡')?.parentId, WITHIN).toBe(root.id)
  await expect(compose).toHaveCount(0)
  await forgetPicks()
})

test('the new-card box shows full project and agent names: no picker label is cut off', async () => {
  await forgetPicks()
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await seedModels()
  await page.evaluate(() => {
    const ws = (globalThis as unknown as { __trWorkspace: { setState(p: unknown): void; getState(): { projects: Array<{ id: string; name: string }> } } }).__trWorkspace
    ws.setState({ projects: ws.getState().projects.map((p, i) => (i === 0 ? { ...p, name: 'personal-website-2026-redesign' } : p)) })
  })
  await page.keyboard.press('n')
  const input = page.getByTestId('task-compose-input')
  await input.fill('给 iOS 推送加静默通知\n锁屏不响铃，只更新灵动岛。')
  await page.getByTestId('task-compose-project').click()
  await page.getByRole('option', { name: 'personal-website-2026-redesign' }).click()
  await expect(page.getByTestId('task-leader')).toContainText('Claude Code', WITHIN)
  await page.getByTestId('task-model').click()
  await shoot('117D-compose-model-menu')
  await page.getByRole('option', { name: 'Opus 5.5' }).click()
  await page.getByTestId('task-effort').click()
  await expect(page.getByRole('option')).toHaveText(['默认', '低', '中', '高', '更高', '最高'])
  await page.getByRole('option', { name: '高', exact: true }).click()
  await expect(page.getByTestId('task-model')).toContainText('Opus 5.5')

  const labels = page.getByTestId('task-compose').locator('[aria-haspopup="listbox"] span:not([aria-hidden])')
  const sizes = await labels.evaluateAll((els) => els.map((el) => ({ text: el.textContent ?? '', scroll: el.scrollWidth, client: el.clientWidth })))
  expect(sizes.map((s) => s.text).filter(Boolean)).toEqual(['personal-website-2026-redesign', 'Claude Code', 'Opus 5.5', '高'])
  for (const s of sizes.filter((s) => s.text !== '')) expect(s.scroll, s.text).toBeLessThanOrEqual(s.client)
  await page.getByTestId('task-leader').click()
  const cut = await page.getByRole('option').evaluateAll((els) => els.flatMap((el) => Array.from(el.querySelectorAll('span'))).filter((el) => el.scrollWidth > el.clientWidth + 1 && el.textContent !== '').map((el) => el.textContent))
  expect(cut).toEqual([])
  await shoot('117E-compose-agent-menu')
  await page.keyboard.press('Escape')
  await shoot('117D2-compose')
  // The picks are remembered per agent.
  expect(JSON.parse((await page.evaluate(() => globalThis.localStorage?.getItem('tr.tasks.picks.v1'))) ?? 'null')).toEqual({ models: { claude: 'opus' }, efforts: { claude: 'high' } })
  await input.press('Escape')
  await forgetPicks()
})

test('the detail edits title and text in place, cancels and restores', async () => {
  const card = await make('p-acme', '梳理 auth 中间件的依赖')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(card)).toBeVisible(WITHIN)
  await note(card).click()
  await page.keyboard.press('Meta+e')
  const detail = page.getByTestId('task-detail')
  const title = detail.getByRole('textbox', { name: '任务标题' })
  await expect(title).toBeFocused()
  await title.fill('梳理依赖，先画图')
  await title.press('Enter')
  await expect.poll(async () => (await cardsNow())[0]?.title, WITHIN).toBe('梳理依赖，先画图')
  await detail.getByTestId('task-detail-body').click()
  const body = detail.getByRole('textbox', { name: '正文' })
  await body.fill('第一行')
  await body.press('Shift+Enter')
  await body.pressSequentially('第二行')
  await body.press('Enter')
  await expect.poll(async () => (await cardsNow())[0]?.body, WITHIN).toBe('第一行\n第二行')
  // Esc drops the edit and leaves the overlay open.
  await detail.getByTestId('task-detail-title').click()
  await detail.getByRole('textbox', { name: '任务标题' }).fill('不要这个')
  await page.keyboard.press('Escape')
  await expect(detail).toBeVisible()
  await expect(detail.getByTestId('task-detail-title')).toHaveText('梳理依赖，先画图')
  await detail.getByRole('button', { name: '取消任务' }).click()
  await expect.poll(async () => (await cardsNow())[0]?.manual, WITHIN).toBe('canceled')
  await detail.getByRole('button', { name: '恢复任务' }).click()
  await expect.poll(async () => (await cardsNow())[0]?.manual, WITHIN).toBe('todo')
  await expect(detail.getByRole('button', { name: '派给主理人…' })).toBeVisible()
  await detail.getByTestId('task-detail-title').click()
  await shoot('117G-detail')

  // The edit is in main's file: a reload shows it.
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(card)).toContainText('梳理依赖，先画图', WITHIN)
})

test('117A / B / C / F: the menus, the marquee, 派发 beside a card, the failure line and the undo bar, in both themes', async () => {
  await forgetPicks()
  const root = await make('p-acme', 'Cookie 会话迁移', { sessionId: 's-cookie' })
  const refresh = await make('p-acme', '会话过期自动刷新', { parent: root, sessionId: 's-perf' })
  await make('p-acme', '移除 localStorage 读写', { parent: root, sessionId: 's-graph' })
  const waiting = await make('p-acme', '梳理 auth 中间件的依赖')
  const failed = await make('p-acme', '修复 Safari 17 结算页白屏', { note: '主理人没启动：项目不是 git 仓库' })
  const gone = await make('p-acme', '会被删的卡')
  await make('p-acme', '它的子卡', { parent: gone })
  await place(root, 40, 120)
  await place(waiting, 40, 360)
  await place(failed, 40, 500)
  await place(gone, 620, 420)
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await seedModels()
  await expect(note(waiting)).toBeVisible(WITHIN)
  await expect(board().locator('[data-error="true"]', { hasText: '主理人没启动' })).toBeVisible()

  await note(waiting).click({ button: 'right' })
  await item('派给主理人…').hover()
  await shoot('117A-card-menu')
  await page.keyboard.press('Escape')

  const first = (await note(refresh).boundingBox())!
  const boardBox = (await board().boundingBox())!
  await marquee({ x: first.x - boardBox.x - 20, y: first.y - boardBox.y - 20 }, { x: first.x - boardBox.x + 60, y: first.y - boardBox.y + 200 }, () => shoot('117B-marquee'))
  await expect(selected()).toHaveCount(2)
  await note(refresh).click({ button: 'right' })
  await expect(menu().getByRole('menuitem')).toHaveText([/取消 2 个任务/, /删除 2 张/])
  await shoot('117B-multi-menu')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await board().click({ button: 'right', position: { x: 560, y: 80 } })
  await shoot('117C-canvas-menu')
  await page.keyboard.press('Escape')

  await note(gone).click()
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('task-undo')).toBeVisible()
  await note(waiting).click({ button: 'right' })
  await item('派给主理人…').click()
  const popover = page.getByTestId('task-redispatch')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('task-leader')).toContainText('Claude Code', WITHIN)
  await shoot('117F-redispatch-undo')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test('the middle button and Space-drag pan; a plain drag on empty canvas does not', async () => {
  const card = await make('p-acme', '平移用的卡')
  await openTasks({ x: 24, y: 24, zoom: 1 })
  await expect(note(card)).toBeVisible(WITHIN)
  const at = async () => (await note(card).boundingBox())!
  const board0 = (await board().boundingBox())!
  const drag = async (button: 'left' | 'middle') => {
    await page.mouse.move(board0.x + 500, board0.y + 500)
    await page.mouse.down({ button })
    await page.mouse.move(board0.x + 560, board0.y + 530, { steps: 5 })
    await page.mouse.up({ button })
  }
  const start = await at()
  await drag('left')
  expect(await at()).toEqual(start)
  await drag('middle')
  expect((await at()).x - start.x).toBeCloseTo(60, 0)
  await page.keyboard.down(' ')
  await expect(board()).toHaveAttribute('data-space', 'true')
  await drag('left')
  await page.keyboard.up(' ')
  expect((await at()).x - start.x).toBeCloseTo(120, 0)
  expect((await at()).y - start.y).toBeCloseTo(60, 0)
})
