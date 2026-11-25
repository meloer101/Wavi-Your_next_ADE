// 看板 · 进度 (PRD F9 v1.184 · Figma 11 v2 / 77A) over the fixture workspace: open it from the sidebar and with ⌘⇧A,
// columns by status, keyboard selection, a card's session in the overlay (one to four side by side), and back to a
// session. The list view and its in-place terminal were removed in v1.184. Screenshots of every state in both themes.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'overview')

let app: ElectronApplication
let page: Page

const overview = () => page.locator('[data-region="overview"]')
const group = (label: string) => overview().locator(`section[aria-label="${label}"]`)
const row = (id: string) => overview().locator(`[data-session-id="${id}"]`)
const overlay = () => page.locator('[data-region="overview-overlay"]')
/** The session's pane in the main area, where its terminal lives when the overview is not showing it. */
const homePane = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
const shoot = async (name: string) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  await setTheme('dark')
}
const navEntry = () => page.locator('[data-region="sidebar"]').getByRole('button', { name: /^看板/ })
const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
  }, theme)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    // Start from the default view every run.
    globalThis.localStorage?.removeItem('tr.overview.v1')
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
})

test.afterAll(async () => {
  await app?.close()
})

test('the sidebar entry shows how many sessions need you and opens 看板 on 进度', async () => {
  // Fixtures: s-nav done_unread and s-graph error need attention.
  await expect(navEntry()).toContainText('2')
  await navEntry().click()
  await expect(overview()).toBeVisible()
  await expect(navEntry()).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-region="terminal"]')).toBeHidden()
  await expect(overview().getByRole('heading', { name: '看板', level: 1 })).toBeVisible()
  await expect(overview().getByRole('tab', { name: '进度' })).toHaveAttribute('aria-selected', 'true')
  // The list view is gone: no 列表 / 看板 switch.
  await expect(overview().getByRole('radio', { name: '列表' })).toHaveCount(0)
})

test('columns by what sessions need, across projects', async () => {
  await expect(group('出错').locator('[data-session-id]')).toHaveCount(1)
  await expect(row('s-graph')).toHaveAttribute('data-card', 'error')
  await expect(row('s-graph')).toContainText('terminal-reborn › jacob/graph-layout')
  await expect(group('待审阅')).toContainText('修复移动端导航抖动')
  await expect(group('运行中').locator('[data-session-id]')).toHaveCount(3)
  // Column order is fixed: answer, fix, review, watch, ignore; the columns stay when empty (等你处理 here).
  const labels = await overview().locator('section h2').allTextContents()
  expect(labels).toEqual(['等你处理', '出错', '待审阅', '运行中', '空闲'])
  await shoot('board')
})

test('a waiting permission moves the card to 等你处理; a click opens its own terminal in the overlay', async () => {
  await page.evaluate(() =>
    (globalThis as unknown as { __trStatus: { emit(id: string, e: unknown): void } }).__trStatus.emit('s-perf', {
      type: 'notification',
      kind: 'permission',
      message: 'Codex needs permission'
    })
  )
  await expect(group('等你处理').locator('[data-session-id="s-perf"]')).toBeVisible()
  await expect(row('s-perf')).toHaveAttribute('data-card', 'attention')

  await row('s-perf').click()
  await expect(overlay().locator('[data-overview-terminal] .xterm')).toHaveCount(1)
  // The same xterm, moved out of its pane — not a second terminal.
  await expect(homePane('s-perf').locator('.xterm')).toHaveCount(0)
  // It is the live terminal: typing reaches the session's PTY, and Esc typed there stays with the terminal.
  await overlay().locator('[data-overview-terminal]').click()
  await page.keyboard.type('echo tr-overview-$((40+2))')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as unknown as { __trTerminals: { readScreen(id: string, n?: number): string } }).__trTerminals.readScreen('s-perf', 40)
      )
    )
    .toContain('tr-overview-42')
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeVisible()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await expect(overlay()).toBeHidden()
  await expect(overview()).toBeVisible()
})

test('keyboard: ↓ moves, Space opens the overlay, Esc closes it, the filter narrows', async () => {
  await overview().locator('[role="listbox"]').focus()
  const first = await overview().locator('[role="option"][aria-selected="true"]').getAttribute('data-session-id')
  await page.keyboard.press('ArrowDown')
  const second = await overview().locator('[role="option"][aria-selected="true"]').getAttribute('data-session-id')
  expect(second).not.toBe(first)
  await page.keyboard.press('Space')
  await expect(overlay()).toBeVisible()
  await overlay().getByRole('dialog').focus()
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeHidden()
  await expect(overview()).toBeVisible()

  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('p:terminal')
  await expect(overview().locator('[role="option"]')).toHaveCount(2)
  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('')
  await overview().locator('[role="listbox"]').focus()
})

test('a card opens the session in an overlay that Esc, the scrim and × close', async () => {
  await row('s-graph').click()
  await expect(overlay().getByRole('dialog', { name: 'Git 图谱布局算法' })).toBeVisible()
  await expect(overlay()).toContainText('terminal-reborn › jacob/graph-layout')
  await expect(overlay().locator('[data-overview-terminal] .xterm')).toHaveCount(1)
  await expect(homePane('s-graph').locator('.xterm')).toHaveCount(0)
  // Translucent by default (85%): the padding round the grid carries the cells' own color, as in the main area (issue #7).
  const ring = await overlay()
    .locator('[data-overview-terminal] .xterm-scrollable-element')
    .evaluate((el) => {
      const probe = document.createElement('div')
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--tr-term-ring')
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return { shadow: getComputedStyle(el).boxShadow, color }
    })
  expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
  expect(ring.shadow).toContain(ring.color)
  // Under the translucent terminal the window is glass, not the board: blurred, on the base layer's tint (PRD v1.185).
  const tile = await overlay()
    .locator('section[data-pane-id]')
    .evaluate((el) => ({
      filter: getComputedStyle(el).backdropFilter,
      background: getComputedStyle(el).backgroundColor,
      reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches
    }))
  // A Mac with 减弱透明度 on (the CI runner) gets the opaque tile and no blur.
  expect(tile.filter).toContain(tile.reduced ? 'none' : 'blur(')
  expect(tile.background).not.toBe('rgba(0, 0, 0, 0)')
  await shoot('board-overlay')
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeHidden()
  await expect(overview()).toBeVisible()

  await row('s-graph').click()
  await expect(overlay()).toBeVisible()
  await overlay().click({ position: { x: 4, y: 4 } })
  await expect(overlay()).toBeHidden()

  await row('s-graph').click()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await expect(overlay()).toBeHidden()
})

test('board overlay tiles up to four sessions side by side', async () => {
  const terminals = () => overlay().locator('[data-overview-terminal] .xterm')
  const add = () => overlay().getByRole('button', { name: '并排添加会话' })
  const pick = (n: number) => overlay().locator('[data-pick-id]').nth(n)

  await row('s-graph').click()
  await add().click()
  await expect(overlay().getByRole('region', { name: '添加会话' })).toBeVisible()
  await shoot('board-overlay-picker')
  await pick(0).click()
  await expect(terminals()).toHaveCount(2)
  await add().click()
  await pick(0).click()
  await expect(terminals()).toHaveCount(3)
  // Three windows and the picker make a 2×2 grid whose middle gap still resizes; the picked session keeps the
  // picker's tile as it was left.
  await add().click()
  const picker = overlay().getByRole('region', { name: '添加会话' })
  const pickerBefore = await picker.boundingBox()
  const gap = await overlay().getByRole('separator', { name: '调整宽度' }).boundingBox()
  if (!pickerBefore || !gap) throw new Error('no picker or split')
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2)
  await page.mouse.down()
  await page.mouse.move(gap.x + gap.width / 2 + 100, gap.y + gap.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeCloseTo(pickerBefore.width + 100, 0)
  const pickerAfter = await picker.boundingBox()
  await pick(0).click()
  await expect(terminals()).toHaveCount(4)
  await expect.poll(async () => (await overlay().locator('[data-pane-id]').nth(1).boundingBox())?.width).toBeCloseTo(pickerAfter?.width ?? 0, 0)
  // Four is the most: no more add button.
  await expect(add()).toHaveCount(0)
  await shoot('board-overlay-four')

  await overlay().locator('[data-pane-id]').last().getByRole('button', { name: '关闭' }).click()
  await expect(terminals()).toHaveCount(3)
  await expect(add()).toHaveCount(1)

  // Three windows: two stacked on the left (the fourth closed), one tall on the right. Drag the top-left one onto the
  // right one's middle: they swap, so it takes the right column.
  const pane = (n: number) => overlay().locator('[data-pane-id]').nth(n)
  const boxOf = async (n: number) => {
    const b = await pane(n).boundingBox()
    if (!b) throw new Error('no box')
    return b
  }
  const left = await boxOf(0)
  const right = await boxOf(2)
  const leftId = await pane(0).getAttribute('data-pane-id')
  await page.mouse.move(left.x + 40, left.y + 24)
  await page.mouse.down()
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 8 })
  await shoot('board-overlay-drag')
  await page.mouse.up()
  const moved = overlay().locator(`[data-pane-id="${leftId}"]`)
  await expect.poll(async () => (await moved.boundingBox())?.x).toBeCloseTo(right.x, 0)
  await expect.poll(async () => (await moved.boundingBox())?.y).toBeCloseTo(right.y, 0)

  // The gap between the columns resizes them.
  const split = overlay().getByRole('separator', { name: '调整宽度' })
  const s = await split.boundingBox()
  if (!s) throw new Error('no split')
  const before = (await boxOf(0)).width
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2 + 120, s.y + s.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(0)).width).toBeCloseTo(before + 120, 0)
  await shoot('board-overlay-resized')

  // The gap between the two stacked windows on the left changes their heights.
  const rowSplit = overlay().getByRole('separator', { name: '调整高度' })
  const r = await rowSplit.boundingBox()
  if (!r) throw new Error('no row split')
  const topBefore = (await boxOf(0)).height
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2 - 80, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(0)).height).toBeCloseTo(topBefore - 80, 0)

  // Each edge of the overlay moves on its own: the right edge 100 to the left narrows it by 100, the left edge stays.
  const panel = overlay().getByRole('dialog')
  const p = await panel.boundingBox()
  if (!p) throw new Error('no panel')
  await page.mouse.move(p.x + p.width, p.y + p.height / 2)
  await page.mouse.down()
  await page.mouse.move(p.x + p.width - 100, p.y + p.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeCloseTo(p.width - 100, 0)
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeCloseTo(p.x, 0)
  await shoot('board-overlay-smaller')
  // Double-clicking an edge restores the default.
  await overlay().locator('[data-edge="e"]').dblclick()
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeCloseTo(p.width, 0)
  await overlay().getByRole('dialog').focus()
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeHidden()
  // Every borrowed terminal went back home.
  await expect(page.locator('[data-region="terminal"] .xterm')).not.toHaveCount(0)
})

test('↵ enters the selected session; ⌘⇧A toggles 看板', async () => {
  await row('s-graph').click()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await overview().locator('[role="listbox"]').focus()
  await page.keyboard.press('Enter')
  await expect(overview()).toBeHidden()
  await expect(page.locator('[data-region="terminal"]')).toBeVisible()
  // The terminal went back to its own pane.
  await expect(homePane('s-graph').locator('.xterm')).toHaveCount(1)
  await expect(page.locator('[data-region="sidebar"] [data-session-id="s-graph"]')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeVisible()
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeHidden()
})

// PRD v1.243 (F9 主对话卡片的成员, Figma 111E / 111F): a session with members shows one summary line at the bottom of
// its card, folded; the fold state is the sidebar's own.
test('a card with a dispatched child folds its members into one line that shares the sidebar’s state', async () => {
  const GROUP_SHOTS = join(process.cwd(), 'test-results', 'group-fold-board')
  mkdirSync(GROUP_SHOTS, { recursive: true })
  const groupShot = async (name: string) => {
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await row('s-cookie').screenshot({ path: join(GROUP_SHOTS, `card-${name}-${theme}.png`) })
      await page.screenshot({ path: join(GROUP_SHOTS, `board-${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  // s-nav (待审阅) becomes a child of s-cookie (运行中), both in acme-web.
  await page.evaluate(() => {
    const ws = (globalThis as unknown as { __trWorkspace: { setState(f: (s: { sessions: Array<{ id: string }> }) => unknown): void } }).__trWorkspace
    ws.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === 's-nav' ? { ...x, dispatchedBy: 's-cookie' } : x)) }))
  })
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeVisible()
  const toggle = row('s-cookie').locator('[data-testid="card-members-toggle"]')
  const sideFold = page.locator('[data-region="sidebar"] [data-testid="fold-row"][data-group-owner="s-cookie"]')
  // Folded, with the count; the child keeps its own card in its own column.
  await expect(toggle).toContainText('1 个成员')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(row('s-cookie').locator('li')).toHaveCount(0)
  await expect(group('待审阅').locator('[data-session-id="s-nav"]')).toBeVisible()
  await expect(sideFold).toHaveAttribute('aria-expanded', 'false')
  await groupShot('folded')

  // Opening lists the member; the click opens neither the card's overlay nor changes the selection.
  const selected = await overview().locator('[role="option"][aria-selected="true"]').getAttribute('data-session-id')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(row('s-cookie').locator('li')).toHaveCount(1)
  await expect(row('s-cookie').locator('li')).toContainText('修复移动端导航抖动')
  await expect(overlay()).toBeHidden()
  await expect(overview().locator('[role="option"][aria-selected="true"]')).toHaveAttribute('data-session-id', selected!)
  await expect(sideFold).toHaveAttribute('aria-expanded', 'true')
  await groupShot('expanded')

  // A child's row goes where a click on its own card goes.
  await row('s-cookie').locator('li[data-member-session="s-nav"] button').click()
  await expect(overlay().getByRole('dialog', { name: '修复移动端导航抖动' })).toBeVisible()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await expect(overlay()).toBeHidden()

  // Folding on the card folds the sidebar's group too.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(sideFold).toHaveAttribute('aria-expanded', 'false')

  // The toggle hands the keyboard back to the board: Space opens the selected card's overlay, ↵ enters its session.
  await expect(overview().locator('[role="listbox"]')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(overlay()).toBeVisible()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await toggle.click()
  await page.keyboard.press('Enter')
  await expect(overview()).toBeHidden()
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeVisible()
})
