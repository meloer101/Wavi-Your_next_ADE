// GUI sessions (PRD F23, Figma 49″) in the built app, against the fake headless Claude of src/main/gui/fixtures
// (stream-json in and out, no model, no tokens) put first on the login shell's PATH: the chat instead of a terminal,
// the label and flags it is launched with, streaming text, a permission card answered from the GUI, a message queued
// while a turn runs, the stop button, the 界面 row of the new-session sheet, and the session surviving a reload of
// the window (last: a reload shows the boot screen's dots for up to 8 s). Screenshots in both themes go to test-results/gui-session/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'gui-session')
const WITHIN = { timeout: 20_000 }
const FAKE = join(process.cwd(), 'src', 'main', 'gui', 'fixtures', 'fake-claude.mjs')
// Claude's model list as it comes in versions (Figma 103C): Opus has three, Haiku two.
const FAKE_MODELS = 'default|Default (recommended), opus|Opus 5.5, haiku|Haiku 5.5, claude-haiku-4-5|Haiku 4.5, claude-opus-4-8|Opus 4.8, claude-opus-4-7|Opus 4.7'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F23 GUI session (Claude)', () => {
  // Resolved (/private/var/…): the agent names files under its real working folder, shown relative to the session's.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-gui-')))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, project, profile]) mkdirSync(dir)
  const argsFile = join(root, 'claude-args.json')
  const controlLog = join(root, 'claude-control.jsonl')
  // `claude` runs the fake with this Node; anything else (a TUI launch) would fail loudly.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_ARGS_FILE="${argsFile}"\nexport FAKE_CONTROL_LOG="${controlLog}"\nexport FAKE_MODELS="${FAKE_MODELS}"\n`)
  writeFileSync(join(project, 'README.md'), '# demo\n')

  let app: ElectronApplication
  let page: Page
  const chat = () => page.getByTestId('gui-chat')
  const feed = () => page.locator('[data-region="gui-feed"]')
  const composer = () => page.getByTestId('gui-composer')
  const input = () => composer().getByRole('textbox', { name: '回复' })
  const send = async (text: string) => {
    await input().fill(text)
    await input().press('Enter')
  }
  // The turn over: its run row gone, so the feed no longer moves under a resting pointer.
  const settled = async () => {
    await expect(composer().getByRole('button', { name: '停止' })).toHaveCount(0, WITHIN)
    await expect(feed().getByTestId('gui-run-row')).toHaveCount(0, WITHIN)
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: 'GUI 会话', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    // The fake writes its transcript under CLAUDE_CONFIG_DIR (an edit reads it), never the real ~/.claude.
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('shows the chat, not a terminal, and launches claude -p with the wavi label', async () => {
    await expect(chat()).toBeVisible(WITHIN)
    await expect(composer()).toBeVisible()
    await expect(page.locator('[data-region="terminal"] .xterm')).toHaveCount(0)
    // Nothing said yet (Figma 59G): the agent's mark and name over the composer, the two in the middle of the card.
    const welcome = page.getByTestId('gui-welcome')
    // Figma 65H: 「让我们在 <project> 中开工吧」, the project on its grey block.
    await expect(welcome).toHaveText('让我们在demo中开工吧')
    await expect(welcome.getByTestId('gui-project')).toHaveText('demo')
    const [hello, box, card] = await Promise.all([welcome.boundingBox(), page.getByTestId('gui-composer-box').boundingBox(), chat().boundingBox()])
    expect(Math.abs(hello!.x + hello!.width / 2 - (box!.x + box!.width / 2))).toBeLessThan(1)
    expect(box!.y).toBeGreaterThan(card!.y + card!.height / 3)
    await page.screenshot({ path: join(SHOTS, 'empty-dark.png') })
    // PRD v1.179 / v1.183: beside a GUI session the base layer (the sidebar, the gaps and margins round the cards) is the
    // chat card's opacity + 10%; the overview (which keeps this session active) takes the terminal's.
    const setLook = (p: unknown) => page.evaluate((x) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(x), p)
    const baseAlpha = () =>
      page.locator('[data-glass-base]').first().evaluate((el) => {
        const m = /\/\s*([\d.]+)\)$/.exec(getComputedStyle(el).backgroundColor)
        return m ? Number(m[1]) : 1
      })
    // Figma 84A: the base layer is cut out where each shown card is, so the card sits on the bare glass. Returns the
    // number of holes (data-holes) and how far the first one's start (the end of its top-left arc: left + radius, top)
    // is from the chat card's, in the base layer's coordinates.
    const baseHoles = () =>
      page.evaluate((selector) => {
        const base = document.querySelector<HTMLElement>('[data-glass-base]')!
        const cardEl = document.querySelector<HTMLElement>(selector)!
        const card = cardEl.getBoundingClientRect()
        const origin = base.getBoundingClientRect()
        // The first subpath after the outer box's close.
        const start = /Z\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/i.exec(getComputedStyle(base).clipPath)
        const radius = parseFloat(getComputedStyle(cardEl).borderTopLeftRadius)
        return {
          holes: Number(base.dataset.holes),
          dx: start ? Number(start[1]) - radius - (card.left - origin.left) : NaN,
          dy: start ? Number(start[2]) - (card.top - origin.top) : NaN
        }
      }, '[data-glass-card][data-session-id="s1"]')
    await setLook({ appearance: { terminalOpacity: 0.5, chat: { opacity: 0.3 } } })
    await expect.poll(baseAlpha).toBeCloseTo(0.4)
    await expect.poll(async () => (await baseHoles()).holes).toBe(1)
    const hole = await baseHoles()
    expect(Math.abs(hole.dx)).toBeLessThan(1)
    expect(Math.abs(hole.dy)).toBeLessThan(1)
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^看板/ }).click()
    await expect.poll(baseAlpha).toBeCloseTo(0.6)
    await page.locator('[data-region="sidebar"] [data-session-id="s1"]').click()
    await expect(chat()).toBeVisible(WITHIN)
    await expect.poll(baseAlpha).toBeCloseTo(0.4)
    await page.screenshot({ path: join(SHOTS, 'base-layer-dark.png') })
    await setLook({ appearance: { terminalOpacity: 0.85, chat: { opacity: 0.85 } } })
    // Figma 65B: nothing said yet — the model button lists the agents first, the current one's models beside them.
    await composer().locator('[data-picker="model"]').click()
    await expect(page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Claude Code' })).toBeVisible(WITHIN)
    await expect(page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Codex' })).toBeVisible()
    // No 「Default (recommended)」: Claude's default is listed as the model it is (Opus here).
    await expect(page.getByTestId('gui-agent-models').getByRole('menuitemradio')).toHaveText(['Opus 5.5', 'Haiku 5.5'])
    await expect(page.getByTestId('gui-agent-models').getByRole('menuitemradio', { name: 'Opus 5.5' })).toHaveAttribute('aria-checked', 'true')
    // Rows are 32 high (the author, 2026-11-08: a little roomier).
    // Rounded: a display that is not at an integer scale lays the row out a fraction of a pixel short (31.98 on the CI runner).
    // Polled: the menu pops in from scale(0.97) over --duration-pop, and a box measured mid-animation is 31.
    await expect.poll(async () => Math.round((await page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Codex' }).boundingBox())!.height)).toBe(32)
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.screenshot({ path: join(SHOTS, `empty-agents-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('gui-agent-menu')).toHaveCount(0)
    await expect.poll(() => existsSync(argsFile), WITHIN).toBe(true)
    const launched = JSON.parse(readFileSync(argsFile, 'utf8')) as { args: string[]; entrypoint: string | null }
    expect(launched.entrypoint).toBe('wavi')
    expect(launched.args).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', 'stdio']))
    // The right panel is a second card on the same base layer: a second hole, where its card is once it has opened.
    const panelCard = page.locator('[data-region="panel"]').getByTestId('right-panel')
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(panelCard).toBeVisible(WITHIN)
    await expect.poll(async () => (await baseHoles()).holes).toBe(2)
    // Read once the panel has finished opening: mid-motion its card is cut out only as far as the drawer shows it.
    const panelHole = () => page.evaluate(() => {
      const base = document.querySelector<HTMLElement>('[data-glass-base]')!
      const cardEl = document.querySelector<HTMLElement>('[data-region="panel"] [data-testid="right-panel"]')!
      const card = cardEl.getBoundingClientRect()
      const radius = parseFloat(getComputedStyle(cardEl).borderTopLeftRadius)
      const origin = base.getBoundingClientRect()
      // Each hole's start (left + radius, top), in DOM order: the chat card, then the panel's.
      const starts = [...getComputedStyle(base).clipPath.matchAll(/Z\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/gi)].map((m) => [Number(m[1]), Number(m[2])])
      return { x: starts[1]![0]! - radius - (card.left - origin.left), y: starts[1]![1]! - (card.top - origin.top) }
    })
    await expect.poll(async () => Math.abs((await panelHole()).x), WITHIN).toBeLessThan(1)
    expect(Math.abs((await panelHole()).y)).toBeLessThan(1)
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(panelCard).toHaveCount(0, WITHIN)
    await expect.poll(async () => (await baseHoles()).holes).toBe(1)
  })

  /** How far below the top of the feed a sent message's bubble sits. */
  const offsetFromTop = async (text: string): Promise<number> => {
    const [bubble, region] = await Promise.all([feed().locator('[data-item]').filter({ hasText: text }).last().boundingBox(), feed().boundingBox()])
    return Math.round((bubble?.y ?? NaN) - (region?.y ?? NaN))
  }

  test('the chat card sits 6px in from the window\'s top, right and bottom, with every corner 10px (Figma 75)', async () => {
    const card = page.locator('[data-region="terminal"] > [data-session-id="s1"]')
    const placed = () =>
      card.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return {
          top: Math.round(r.top),
          right: Math.round(window.innerWidth - r.right),
          bottom: Math.round(window.innerHeight - r.bottom),
          left: Math.round(r.left),
          corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]
        }
      })
    const round = ['10px', '10px', '10px', '10px']
    // Sidebar open: the card's left edge faces the sidebar column.
    await expect.poll(placed).toMatchObject({ top: 6, right: 6, bottom: 6, corners: round })
    const fullScreen = (on: boolean) => app.evaluate(({ BrowserWindow }, on) => BrowserWindow.getAllWindows()[0]!.webContents.send('ui:full-screen', on), on)
    await fullScreen(true)
    await expect.poll(placed).toMatchObject({ top: 6, right: 6, bottom: 6, corners: round })
    await page.screenshot({ path: join(SHOTS, 'full-screen-corners.png') })
    // Sidebar hidden: the left edge is in from the window's too.
    await page.getByRole('button', { name: '隐藏侧栏' }).click()
    await expect.poll(placed).toMatchObject({ top: 6, right: 6, bottom: 6, left: 6, corners: round })
    await page.screenshot({ path: join(SHOTS, 'full-screen-corners-no-sidebar.png') })
    await fullScreen(false)
    await expect.poll(placed).toMatchObject({ top: 6, right: 6, bottom: 6, left: 6, corners: round })
    await page.getByRole('button', { name: '显示侧栏' }).click()
    await expect.poll(placed).toMatchObject({ top: 6, right: 6, bottom: 6, corners: round })
  })

  test('sends a message and shows the reply, top down (Figma 50A)', async () => {
    await send('你好')
    await expect(feed().getByText('你好', { exact: true })).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: 你好')).toBeVisible(WITHIN)
    expect(await offsetFromTop('你好')).toBe(24)
    await expect(page.getByTestId('gui-welcome')).toHaveCount(0)
  })

  test('the model menu lists a row for each family; hovering one opens its versions, newest first (Figma 103C)', async () => {
    await composer().locator('[data-picker="model"]').click()
    const menu = page.getByRole('dialog', { name: '模型' })
    const families = page.getByRole('menu', { name: '模型', exact: true })
    // One row for each family, showing its newest version; › marks a family with versions to choose from.
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Opus 5.5', 'Haiku 5.5'], WITHIN)
    await expect(families.getByRole('menuitemradio', { name: 'Opus 5.5' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menu', { name: 'Opus', exact: true })).toHaveCount(0)
    await families.getByRole('menuitemradio', { name: 'Opus 5.5' }).hover()
    const versions = page.getByRole('menu', { name: 'Opus', exact: true })
    await expect(versions.getByRole('menuitemradio')).toHaveText(['Opus 5.5', 'Opus 4.8', 'Opus 4.7'])
    // The versions' column is headed by the family's name, as the families' column is by the agent's.
    await expect(versions.getByText('Opus', { exact: true })).toBeVisible()
    await expect(versions.getByRole('menuitemradio', { name: 'Opus 5.5' })).toHaveAttribute('aria-checked', 'true')
    // → opens the versions from the keyboard, ← goes back to the row.
    await families.getByRole('menuitemradio', { name: 'Haiku 5.5' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menu', { name: 'Haiku', exact: true }).getByRole('menuitemradio', { name: 'Haiku 5.5' })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(families.getByRole('menuitemradio', { name: 'Haiku 5.5' })).toBeFocused()
    // ↑ to Opus: the versions column that is open follows the focused row.
    await page.keyboard.press('ArrowUp')
    await expect(families.getByRole('menuitemradio', { name: 'Opus 5.5' })).toBeFocused()
    await expect(page.getByRole('menu', { name: 'Opus', exact: true })).toBeVisible()
    await expect(page.getByRole('menu', { name: 'Haiku', exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(SHOTS, 'model-families-dark.png') })
    // The pointer is still over Opus: move it off the row and back, as a hand would.
    await families.getByRole('menuitemradio', { name: 'Haiku 5.5' }).hover()
    await families.getByRole('menuitemradio', { name: 'Opus 5.5' }).hover()
    await versions.getByRole('menuitemradio', { name: 'Opus 4.7' }).click()
    await expect(menu).toHaveCount(0)
    await expect
      .poll(() =>
        existsSync(controlLog)
          ? readFileSync(controlLog, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line) as { subtype: string; model?: string })
              .filter((r) => r.subtype === 'set_model')
              .map((r) => r.model)
          : [],
      )
      .toEqual(['claude-opus-4-7'])
    // The family's row keeps the version that is in use, with its ✓.
    await composer().locator('[data-picker="model"]').click()
    await expect(families.getByRole('menuitemradio', { name: 'Opus 4.7' })).toHaveAttribute('aria-checked', 'true')
    // Back to Opus 5.5, which the later tests (快速, effort) need.
    await families.getByRole('menuitemradio', { name: 'Haiku 5.5' }).hover()
    await families.getByRole('menuitemradio', { name: 'Opus 4.7' }).hover()
    await versions.getByRole('menuitemradio', { name: 'Opus 5.5' }).click()
    await expect(menu).toHaveCount(0)
    // A pane too narrow for the versions beside the first column: they stay inside the pane (on the left, or over the
    // column when neither side has room). The window goes to its smallest and the pane is cut to 440 wide.
    await setWindowSize(app, page, 960, 900)
    const clipOf = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[role="menu"][aria-label="Opus"]')
        let up = el?.parentElement ?? null
        while (up && getComputedStyle(up).overflowX === 'visible') up = up.parentElement
        const clip = up?.getBoundingClientRect()
        const box = el?.getBoundingClientRect()
        return clip && box ? { clip: { left: clip.left, right: clip.right }, box: { left: box.left, right: box.right } } : null
      })
    await composer().locator('[data-picker="model"]').click()
    await families.getByRole('menuitemradio', { name: 'Opus 5.5' }).hover()
    await expect(versions).toBeVisible()
    const roomy = (await clipOf())!
    expect(roomy.box.left).toBeGreaterThanOrEqual(roomy.clip.left)
    expect(roomy.box.right).toBeLessThanOrEqual(roomy.clip.right)
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const chat = document.querySelector<HTMLElement>('[data-testid="gui-chat"]')!
      let up: HTMLElement | null = chat
      while (up && getComputedStyle(up).overflowX === 'visible') up = up.parentElement
      const pane = up!
      pane.dataset.shrunk = pane.style.right
      pane.style.right = `${pane.getBoundingClientRect().width - 440}px`
    })
    await composer().locator('[data-picker="model"]').click()
    await families.getByRole('menuitemradio', { name: 'Haiku 5.5' }).hover()
    await families.getByRole('menuitemradio', { name: 'Opus 5.5' }).hover()
    await expect(versions).toBeVisible()
    await expect.poll(async () => {
      const at = (await clipOf())!
      return at.box.left >= at.clip.left - 0.5 && at.box.right <= at.clip.right + 0.5
    }).toBe(true)
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const chat = document.querySelector<HTMLElement>('[data-testid="gui-chat"]')!
      let up: HTMLElement | null = chat
      while (up && getComputedStyle(up).overflowX === 'visible') up = up.parentElement
      up!.style.right = up!.dataset.shrunk ?? ''
    })
    await setWindowSize(app, page, 1440, 900)
  })

  test('a sent message shows at once, before the agent echoes it, and only once after', async () => {
    const sentAt = Date.now()
    await send('late echo please')
    await expect(feed().locator('[data-item]').filter({ hasText: 'late echo please' })).toBeVisible({ timeout: 1000 })
    expect(Date.now() - sentAt).toBeLessThan(1000)
    await expect(feed().getByText('Hello: late echo please')).toBeVisible(WITHIN)
    await expect(feed().locator('[data-item]').filter({ hasText: 'late echo please' })).toHaveCount(1)
  })

  test('later messages go below the earlier ones, with no room left under them', async () => {
    await send('top of the feed')
    await expect(feed().getByText('Hello: top of the feed')).toBeVisible(WITHIN)
    const { fits, gapBelow } = await feed().evaluate((el) => ({
      fits: el.scrollHeight <= el.clientHeight,
      gapBelow: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)
    }))
    // No blank space added after the reply: the feed is exactly as tall as what it holds, or it rests at its end.
    expect(gapBelow).toBeLessThanOrEqual(0)
    // Short enough to fit: nothing scrolled, the first message where it was. The CI runner's screen (768 high)
    // keeps the window too short for three exchanges to fit, so there the feed has scrolled to its end instead.
    if (fits) expect(await offsetFromTop('你好')).toBe(24)
  })

  test('a sent message flies in from the composer: a copy of its bubble springs to where it lands, which waits hidden (Figma 98)', async () => {
    // The flight's animations (made by script, in the chat) held at a time (ms), to look at it as Figma 98A / 98B / 98C
    // draw it; CSS transitions elsewhere (the window settling) go on.
    const at = (ms: number) =>
      page.evaluate(async (t) => {
        const held = document.getAnimations().filter((a) => a.constructor === Animation && (a.effect as KeyframeEffect | null)?.target?.closest('[data-gui-chat]'))
        for (const a of held) a.pause()
        // A pause asked for before an animation's first frame lands a frame later: the time is set once it has.
        await Promise.all(held.map((a) => a.ready))
        for (const a of held) a.currentTime = t
      }, ms)
    const flight = page.getByTestId('gui-message-flight')
    await send('fly me to the feed')
    await flight.waitFor({ state: 'attached' })
    await at(0)
    const landed = feed().locator('[data-item]').filter({ hasText: 'fly me to the feed' }).last()
    await expect(flight).toHaveText('fly me to the feed')
    const bubble = landed.locator('[class*="bubble"]').first()
    await expect(bubble).toHaveCSS('visibility', 'hidden')
    // 98A: its words start where the composer's first line is, below and left of where it lands.
    const lines = await page.evaluate(() => {
      const box = (el: Element | null | undefined) => el!.getBoundingClientRect()
      const words = box(document.querySelector('[data-testid="gui-message-flight"] p'))
      const composer = box(document.querySelector('[data-testid="gui-composer-box"] [contenteditable] > *'))
      return { words: [words.left, words.top], composer: [composer.left, composer.top] }
    })
    expect(Math.abs(lines.words[0]! - lines.composer[0]!), JSON.stringify(lines)).toBeLessThan(1)
    expect(Math.abs(lines.words[1]! - lines.composer[1]!), JSON.stringify(lines)).toBeLessThan(1)
    const [start, end] = await Promise.all([flight.boundingBox(), bubble.boundingBox()])
    expect(start!.y).toBeGreaterThan(end!.y + 40)
    expect(start!.x).toBeLessThan(end!.x)
    await page.screenshot({ path: join(SHOTS, 'flight-0ms-dark.png') })
    await at(120)
    await page.screenshot({ path: join(SHOTS, 'flight-120ms-dark.png') })
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'light' } }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: join(SHOTS, 'flight-120ms-light.png') })
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await at(379)
    // The feed above rides the same spring and may scroll again (the run row): both read in one frame, once the
    // feed's scroll events are in.
    const gap = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const copy = document.querySelector('[data-testid="gui-message-flight"]')!.getBoundingClientRect()
      const rows = document.querySelectorAll('[data-region="gui-feed"] [data-landing] [class*="bubble"]')
      const place = rows[0]!.getBoundingClientRect()
      return [Math.abs(copy.left - place.left), Math.abs(copy.top - place.top)]
    })
    expect(gap[0]).toBeLessThan(1)
    expect(gap[1]).toBeLessThan(1)
    await page.screenshot({ path: join(SHOTS, 'flight-380ms-dark.png') })
    // 98C: landed, the copy gone and the bubble itself there, once.
    await page.evaluate(() => document.getAnimations().forEach((a) => a.playState === 'paused' && a.play()))
    await expect(flight).toHaveCount(0, WITHIN)
    await expect(bubble).toHaveCSS('visibility', 'visible')
    await expect(feed().getByText('Hello: fly me to the feed')).toBeVisible(WITHIN)
    await expect(feed().locator('[data-item]').filter({ hasText: /^fly me to the feed/ })).toHaveCount(1)
  })

  test('the run row comes with the message: the agent’s mark, 「思考中」 and a running clock, gone when the turn ends; thinking with no text leaves no 「思考了」 row (Figma 91)', async () => {
    // The fake answers `--version` as 2.1.318, so Claude is asked for summaries.
    await expect.poll(() => existsSync(argsFile), WITHIN).toBe(true)
    const launched = JSON.parse(readFileSync(argsFile, 'utf8')) as { args: string[] }
    expect(launched.args[launched.args.indexOf('--thinking-display') + 1]).toBe('summarized')
    await send('think first')
    const run = feed().getByTestId('gui-run-row')
    await expect(run).toBeVisible(WITHIN)
    await expect(run.getByRole('status')).toHaveText('思考中')
    // The turn's first row: the agent's mark is beside it.
    await expect(run.locator('..').locator('> [data-agent-mark]')).toHaveCount(1)
    await expect(run.getByTestId('gui-run-clock')).toHaveText(/^\d+\.\ds$/)
    await page.screenshot({ path: join(SHOTS, 'run-row.png') })
    await expect(feed().getByText('Hello: think first')).toBeVisible(WITHIN)
    await expect(run).toHaveCount(0)
    await expect(feed().getByText(/^思考了/)).toHaveCount(0)
  })

  test('answers a permission card from the GUI and the turn goes on', async () => {
    await send('please write a file')
    const card = page.getByTestId('gui-permission')
    await expect(card).toBeVisible(WITHIN)
    await page.screenshot({ path: join(SHOTS, 'permission-dark.png') })
    await card.getByRole('button', { name: /^允许/ }).click()
    await expect(card).toHaveCount(0, WITHIN)
  })

  test('a permission to edit a file shows the change (Figma 59I)', async () => {
    await send('patch file')
    const card = page.getByTestId('gui-permission')
    await expect(card).toBeVisible(WITHIN)
    const diff = card.getByTestId('gui-diff')
    await expect(diff.locator('[class*="fileHeader"]')).toHaveText('src/auth/refresh.ts+2−1')
    await expect(diff.locator('[data-kind="del"]')).toHaveText("-  const token = localStorage.getItem('token')\n")
    await expect(diff.locator('[data-kind="add"]')).toHaveCount(2)
    // The path is on the block's header, not repeated as the detail line.
    await expect(card.locator('pre').filter({ hasText: /^src\/auth\/refresh\.ts$/ })).toHaveCount(0)
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `permission-diff-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await card.getByRole('button', { name: /^允许/ }).click()
    await expect(card).toHaveCount(0, WITHIN)
  })

  test('tool rows read as icon · verb · target; a command’s output keeps its colors (Figma 59J)', async () => {
    await send('show colors')
    // Figma 70′B: the read and the command fold into one row (the command failed); it opens to them.
    const group = feed().getByRole('button', { name: /^读取了 1 个文件，运行了 1 条命令\s*1 个失败$/ })
    await expect(group).toBeVisible(WITHIN)
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(feed().getByRole('button', { name: /运行\s*pnpm vitest run server\/auth/ })).toHaveCount(0)
    await page.screenshot({ path: join(SHOTS, 'tool-group.png') })
    await group.click()
    const bash = feed().getByRole('button', { name: /运行\s*pnpm vitest run server\/auth/ })
    await expect(bash).toBeVisible(WITHIN)
    await expect(feed().getByRole('button', { name: /读取\s*src\/auth\/session\.ts/ })).toBeVisible()
    await expect(feed().getByRole('heading', { name: '测试结果' })).toBeVisible()
    // PRD v1.155: no line under a heading, none for `---`, and a table keeps only the line under its header.
    const lines = await feed().evaluate((el) => {
      const width = (sel: string, side: 'Top' | 'Bottom'): string => getComputedStyle(el.querySelector(sel)!)[`border${side}Width`]
      return { h2: width('h2', 'Bottom'), hr: width('hr', 'Top'), th: width('th', 'Bottom'), td: width('td', 'Bottom') }
    })
    expect(lines).toEqual({ h2: '0px', hr: '0px', th: '1px', td: '0px' })
    await bash.click()
    const output = feed().locator('pre').filter({ hasText: 'rotates the token' })
    const failed = output.locator('[data-fg="red"]').first()
    await expect(failed).toHaveText('✗ server/auth/refresh.test.ts > rotates the token')
    expect(await output.textContent()).not.toContain('\x1b')
    // Figma 59J: the output starts with the command it came from.
    await expect(output.getByTestId('gui-output-command')).toHaveText('$ pnpm vitest run server/auth\n')
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const red = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--term-red').trim())
      expect(await failed.evaluate((el) => getComputedStyle(el).color)).toBe(await page.evaluate((hex) => {
        const probe = document.createElement('span')
        probe.style.color = hex
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      }, red))
      await page.screenshot({ path: join(SHOTS, `tools-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await bash.click()
  })

  test('file references, web results, colored code, test results and folded frames (Figma 90A–90E)', async () => {
    await send('show visuals')
    const theme = (t: 'dark' | 'light') =>
      page.evaluate((x) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: x } }), t)
    // 90A: an existing file named in the reply is a link; resting on it shows its first lines.
    const link = feed().getByTestId('gui-file-ref').filter({ hasText: 'README.md:1' }).first()
    await expect(link).toBeVisible(WITHIN)
    await expect(feed().getByTestId('gui-file-ref')).toHaveCount(3)
    await settled()
    await link.hover()
    const card = page.getByTestId('gui-file-card')
    await expect(card).toContainText('# demo', WITHIN)
    await page.screenshot({ path: join(SHOTS, 'file-card-dark.png') })
    await page.mouse.move(5, 5)
    await expect(card).toHaveCount(0, WITHIN)
    // 90C: the code block is colored by its language.
    await expect(feed().locator('pre [data-hl="keyword"]').first()).toHaveText('export')
    // 90B: the search lists what it found; the fetched page is named by the title the search found.
    const group = feed().getByTestId('gui-tool-group').last()
    await group.getByRole('button').first().click()
    const search = feed().getByRole('button', { name: /搜索网页\s*safari samesite lax.*2 个结果/ })
    await search.click()
    await expect(feed().getByTestId('gui-search-results').getByRole('link')).toHaveCount(2)
    await expect(feed().getByRole('button', { name: /读取\s*Tracking Prevention in WebKit\s*webkit\.org/ })).toBeVisible()
    // 90D: the test run says what failed and passed, and opens to the failure.
    const tests = feed().getByRole('button', { name: /运行\s*pnpm vitest run server\/auth.*1 失败\s*11 通过\s*1\.80s/ })
    await expect(tests).toBeVisible()
    await tests.click()
    const results = feed().getByTestId('gui-test-results')
    await expect(results).toContainText('refresh › renews from the cookie when expired')
    await expect(results.getByTestId('gui-file-ref')).toHaveText('README.md:1:3')
    // 90E: a frame in the project is a link, the frames in dependencies fold into one row.
    await feed().getByRole('button', { name: /运行\s*pnpm dev/ }).click()
    await expect(feed().getByTestId('gui-folded-frames')).toHaveText('依赖里的 2 帧')
    await expect(feed().locator('pre').filter({ hasText: 'readToken' }).getByTestId('gui-file-ref')).toHaveText('README.md:1:3')
    for (const t of ['dark', 'light'] as const) {
      await theme(t)
      await expect(page.locator('html')).toHaveAttribute('data-theme', t)
      await page.screenshot({ path: join(SHOTS, `visuals-${t}.png`) })
    }
    await theme('dark')
    // 90A′: a click opens the file in the 文件 view.
    await link.click()
    await expect(page.getByTestId('file-preview')).toBeVisible(WITHIN)
    await page.screenshot({ path: join(SHOTS, 'file-ref-opened.png') })
  })

  test('the current task list sits above the composer and its row opens to it (Figma 59J)', async () => {
    await send('make tasks')
    const card = page.getByTestId('gui-todos')
    await expect(card).toBeVisible(WITHIN)
    await expect(card.locator('header')).toHaveText('任务1 / 3')
    await expect(card.locator('li')).toHaveText(['登录接口改成 Set-Cookie', '跑 auth 测试并修失败', '确认 Safari 的 SameSite 行为'])
    await expect(card.locator('li[data-status="in_progress"]')).toHaveText('跑 auth 测试并修失败')
    // Directly above the composer.
    const [cardBox, box] = await Promise.all([card.boundingBox(), page.getByTestId('gui-composer-box').boundingBox()])
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(box!.y)
    const row = feed().getByRole('button', { name: /任务\s*3 项/ }).last()
    await row.click()
    await expect(feed().locator('li').filter({ hasText: '确认 Safari 的 SameSite 行为' })).toBeVisible()
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `tasks-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await row.click()
    // Every task done: the card goes.
    await send('tasks done')
    await expect(card).toHaveCount(0, WITHIN)
  })

  test('a subagent’s work shows under its row, open while it runs, closed once done (Figma 59J)', async () => {
    await send('run a subagent')
    const agent = feed().locator('[data-subagent]').last()
    const row = agent.locator('button').first()
    const steps = agent.getByTestId('gui-subagent-steps')
    await expect(row).toContainText('子 agent查 SameSite 在 Safari 的行为', WITHIN)
    // Running: open, counting up from its start.
    await expect(steps).toBeVisible()
    await expect(agent.getByTestId('gui-subagent-time')).toHaveText(/^0:0\d$/)
    const grep = steps.getByRole('button', { name: /搜索\s*SameSite=Lax/ })
    await expect(grep).toBeVisible()
    await expect(steps.getByText('Safari 17 起跨站 POST 不带 Lax cookie，和 Chrome 一致。')).toBeVisible()
    // Under the row, not at the top level; the subagent's prompt and stream are not the conversation's.
    await expect(feed().getByText('SameSite=Lax', { exact: true })).toHaveCount(1)
    await expect(feed().getByText('Check how Safari treats SameSite=Lax')).toHaveCount(0)
    await expect(feed().getByText('inner stream')).toHaveCount(0)
    // Done: its own duration, closed.
    await expect(feed().getByText('子 agent 查完了。')).toBeVisible(WITHIN)
    await expect(agent.getByTestId('gui-subagent-time')).toHaveText('0:42')
    await expect(steps).toHaveCount(0)
    await row.click()
    await expect(steps).toBeVisible()
    // The line runs down from the row icon's centre (8), the nested rows 16 right of it.
    // Measured in one frame: opening the row grows the feed, which follows its end, so separate reads can straddle a scroll.
    const box = await agent.evaluate((el) => {
      const rect = (node: Element | null | undefined) => node!.getBoundingClientRect()
      const stepsEl = el.querySelector('[data-testid="gui-subagent-steps"]')
      const grepEl = [...(stepsEl?.querySelectorAll('button') ?? [])].find((b) => /搜索\s*SameSite=Lax/.test(b.textContent ?? ''))
      const [r, s, g] = [rect(el.querySelector('button')), rect(stepsEl), rect(grepEl)]
      return { rowX: r.x, rowBottom: r.bottom, stepsX: s.x, grepX: g.x, grepY: g.y }
    })
    expect(box.stepsX - box.rowX).toBeCloseTo(7, 0)
    expect(box.grepX - box.rowX).toBeCloseTo(24, 0)
    expect(box.grepY).toBeGreaterThan(box.rowBottom)
    expect(await steps.evaluate((el) => [getComputedStyle(el).borderLeftWidth, getComputedStyle(el).borderLeftStyle])).toEqual(['1px', 'solid'])
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `subagent-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await row.click()
    await expect(steps).toHaveCount(0)
    await expect(grep).toHaveCount(0)
  })

  test('queues a message sent while a turn runs, then stops the turn', async () => {
    await send('slow answer')
    await expect(composer().getByRole('button', { name: '停止' })).toBeVisible(WITHIN)
    await send('queued one')
    await expect(page.getByTestId('gui-queued')).toContainText('queued one', WITHIN)
    await composer().getByRole('button', { name: '停止' }).click()
    // The stopped turn ends; the queued message goes next and gets its reply.
    await expect(feed().getByText('Hello: queued one')).toBeVisible(WITHIN)
    await expect(page.getByTestId('gui-queued')).toHaveCount(0)
  })

  test('a pasted picture is a thumbnail in the composer (Figma 50C)', async () => {
    const shot = join(root, 'shot.png')
    writeFileSync(shot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${shot}") as «class PNGf»)`])
      await input().click()
      await page.keyboard.press('Meta+V')
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
    const thumb = composer().getByRole('img', { name: /^paste-.*\.png$/ })
    await expect(thumb).toBeVisible(WITHIN)
    expect(await thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expect(await thumb.boundingBox()).toMatchObject({ width: 64, height: 64 })
    await thumb.hover()
    await page.screenshot({ path: join(SHOTS, 'thumbnail-dark.png') })
    await composer().getByRole('button', { name: /^移除 / }).click()
    await expect(thumb).toHaveCount(0)
  })

  test('a sent picture stays on the message as a thumbnail over the bubble (Figma 71A)', async () => {
    const shot = join(root, 'sent.png')
    writeFileSync(shot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${shot}") as «class PNGf»)`])
      await input().click()
      await page.keyboard.press('Meta+V')
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
    await expect(composer().getByRole('img', { name: /^paste-.*\.png$/ })).toBeVisible(WITHIN)
    await send('看这张图')
    await expect(feed().getByText('Hello: 看这张图 [1 image]')).toBeVisible(WITHIN)
    // Claude's own copy carries only the bytes: main keeps them as a file, and the bubble draws that.
    const message = feed().locator('[data-item]').filter({ hasText: '看这张图' }).first()
    const sent = message.getByTestId('gui-message-pictures').getByRole('img', { name: /^sent-[0-9a-f]+\.png$/ })
    await expect(sent).toBeVisible(WITHIN)
    expect(await sent.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expect(await sent.boundingBox()).toMatchObject({ width: 64, height: 64 })
    const [picture, bubble] = await Promise.all([sent.boundingBox(), message.getByText('看这张图', { exact: true }).boundingBox()])
    expect(picture!.y + picture!.height).toBeLessThanOrEqual(bubble!.y)
    await expect(composer().getByRole('img')).toHaveCount(0)
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `sent-picture-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
  })

  /**
   * ProseMirror takes a selection made with the keyboard from the next `selectionchange`: a shortcut pressed in the
   * same instant would apply to the old one. Two frames are enough.
   */
  const selectionSettles = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))

  /** The text of the last user bubble: what the agent got. */
  const lastSent = () => feed().locator('[data-item]').last()

  test('lists start from "- " and ⇧⏎ adds an item; the agent gets Markdown (Figma 50C)', async () => {
    await input().click()
    await page.keyboard.type('步骤：')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('1. 后端下发 cookie')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('前端删掉 my_token')
    await expect(input().locator('ol > li')).toHaveCount(2)
    await page.keyboard.press('Enter')
    // The bubble shows what the agent got as Markdown (Figma 51A): a paragraph and an ordered list, `my_token` as typed.
    await expect(lastSent().locator('ol > li')).toHaveText(['后端下发 cookie', '前端删掉 my_token'], WITHIN)
    await expect(lastSent().locator('p').first()).toHaveText('步骤：')
    await expect(input().locator('ol')).toHaveCount(0)
  })

  test('**x** typed inline stays text; ⌘I and ⌘⇧S format a selection, with no 格式 button (Figma 50D / 65)', async () => {
    // Formats are always on (Figma 65): a selection gets the format buttons over it.
    await expect(composer().getByRole('button', { name: '格式' })).toHaveCount(0)
    await input().click()
    await page.keyboard.type('**不是粗体** 和 斜体')
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft')
    await selectionSettles()
    await page.keyboard.press('Meta+i')
    await expect(input().locator('em')).toHaveText('斜体')
    await page.keyboard.press('End')
    await selectionSettles()
    await page.keyboard.press('Shift+Home')
    await selectionSettles()
    await page.keyboard.press('Meta+Shift+s')
    await page.keyboard.press('Enter')
    // Sent as `~~**不是粗体** 和 *斜体*~~`: the typed asterisks are Markdown to the agent, so the bubble shows them bold.
    await expect(lastSent().locator('del em')).toHaveText('斜体', WITHIN)
    await expect(lastSent().locator('del strong')).toHaveText('不是粗体')
  })

  test('a selection shows the format buttons over it (Figma 50E); ⏎ in a code block is a newline', async () => {
    await input().click()
    await page.keyboard.type('run npm test')
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowLeft')
    await selectionSettles()
    const floating = composer().getByRole('toolbar', { name: '选中文字的格式' })
    await expect(floating).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'selection-toolbar.png') })
    await floating.getByRole('button', { name: /^行内代码/ }).click()
    await page.keyboard.press('End')
    await selectionSettles()
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('```')
    await page.keyboard.type(' ')
    await page.keyboard.type('a()')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  b()')
    await expect(input().locator('pre')).toHaveCount(1)
    await page.keyboard.press('Meta+Enter')
    await expect(lastSent().locator('p code')).toHaveText('npm test', WITHIN)
    await expect(lastSent().locator('pre')).toHaveText('a()\n  b()')
  })

  test('the box is a line of text over the controls (Figma 65): + adds a file as an attachment, sent with the message', async () => {
    const readme = join(project, 'README.md')
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
    }, [readme])
    // One line of text over + · pickers · … · send (28 each), 8 inside: 78 high (Figma 65D).
    const box = page.getByTestId('gui-composer-box')
    expect((await box.boundingBox())!.height).toBe(78)
    const [addBox, sendBox, textBox] = await Promise.all([
      composer().getByRole('button', { name: '添加附件' }).boundingBox(),
      composer().getByRole('button', { name: '发送' }).boundingBox(),
      input().boundingBox()
    ])
    expect(Math.round(addBox!.y)).toBe(Math.round(sendBox!.y))
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(addBox!.y)
    await composer().getByRole('button', { name: '添加附件' }).click()
    await expect(composer().getByRole('list', { name: '附件' }).getByText('README.md')).toBeVisible(WITHIN)
    await send('看说明')
    await expect(lastSent()).toContainText('看说明', WITHIN)
    await expect(composer().getByRole('list', { name: '附件' })).toHaveCount(0)
  })

  test('context and usage sit under the composer, not in the header (Figma 52F / 52G)', async () => {
    const fromMain = (channel: string, payload: unknown) =>
      app.evaluate(({ BrowserWindow }, [c, p]) => BrowserWindow.getAllWindows()[0]?.webContents.send(c as string, p), [channel, payload] as const)
    await fromMain('agent:event', { sessionId: 's1', agent: 'claude', at: Date.now(), event: { type: 'context', context: { percent: 48, usedTokens: 96000, windowTokens: 200000 } } })
    await fromMain('agent:usage-account', { vendor: 'claude', state: 'ok', plan: 'max', at: Date.now() })
    await fromMain('agent:usage', {
      vendor: 'claude',
      at: Date.now(),
      windows: [
        { minutes: 300, percent: 28, resetsAt: Date.now() + 2 * 3600_000 },
        { minutes: 10080, percent: 41, resetsAt: Date.now() + 3 * 86400_000 }
      ]
    })
    const ring = composer().getByTestId('gui-context-ring')
    await expect(ring).toHaveAttribute('aria-label', 'context 已用 48%', WITHIN)
    const header = page.locator('[data-region="session-header"]')
    await expect(header.getByTestId('context-chip')).toHaveCount(0)
    await expect(header.getByTestId('usage-chip-claude')).toHaveCount(0)
    // Figma 65: the ring sits just before send, on the controls' line.
    const [sendBox, ringBox] = await Promise.all([composer().getByRole('button', { name: '发送' }).boundingBox(), ring.boundingBox()])
    expect(Math.round(ringBox!.y + ringBox!.height / 2)).toBe(Math.round(sendBox!.y + sendBox!.height / 2))
    expect(ringBox!.x + ringBox!.width).toBeLessThanOrEqual(sendBox!.x)
    await ring.click()
    const popover = page.getByTestId('gui-context-popover')
    await expect(popover.getByTestId('usage-context-row')).toHaveText('context48%96k / 200k')
    await expect(popover.getByRole('region', { name: 'Claude' })).toHaveText(/^ClaudeMax5 小时28%.*7 天41%/)
    // Above the ring, right edges aligned.
    const popBox = (await popover.boundingBox())!
    expect(Math.round(popBox.x + popBox.width)).toBe(Math.round(ringBox!.x + ringBox!.width))
    expect(popBox.y + popBox.height).toBeLessThanOrEqual(ringBox!.y)
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect.poll(() => popover.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
      await page.screenshot({ path: join(SHOTS, `context-popover-${theme}.png`) })
    }
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('模式 lists 询问 / 接受编辑 / 自动 / 完全访问 / 计划 in one menu; 快速 is a switch under it (Figma 65E / 78A)', async () => {
    const mode = composer().locator('[data-picker="permission+plan"]')
    await expect(mode).toHaveText('询问', WITHIN)
    await mode.click()
    const menu = page.getByRole('dialog', { name: '模式' })
    await expect(menu.getByRole('menuitemradio')).toHaveText(['询问', '接受编辑', '自动', '完全访问', '计划'])
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.screenshot({ path: join(SHOTS, `mode-menu-${theme}.png`) })
    }
    await menu.getByRole('menuitemradio', { name: '计划' }).click()
    await expect(mode).toHaveText('计划')
    // Out of 计划 straight into a level.
    await mode.click()
    await page.getByRole('dialog', { name: '模式' }).getByRole('menuitemradio', { name: '接受编辑' }).click()
    await expect(mode).toHaveText('接受编辑')
    // 快速 (Figma 78A): Opus says it can answer faster — a switch under the 模式 list; it leaves the menu open.
    await expect(composer().getByRole('button', { name: '快速' })).toHaveCount(0)
    const onMark = mode.locator('[data-switch="fast"]')
    await expect(onMark).toHaveCount(0)
    await mode.click()
    const switches = page.getByRole('dialog', { name: '模式' })
    await expect(switches.getByRole('separator')).toHaveCount(1)
    const fast = switches.getByRole('switch', { name: '快速' })
    await expect(fast).toHaveAttribute('aria-checked', 'false')
    await fast.click()
    await expect(fast).toHaveAttribute('aria-checked', 'true')
    await expect(switches).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'fast-on-menu-light.png') })
    await page.keyboard.press('Escape')
    // 78B: on, a solid ⚡ after the 模式's name (the author, 2026-11-08: from outline to solid).
    await expect(mode).toHaveText('接受编辑')
    await expect(onMark.locator('svg')).toHaveAttribute('fill', 'currentColor')
    await page.screenshot({ path: join(SHOTS, 'fast-on-light.png') })
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    // Saved with the session, and on the agent for its next session.
    type Saved = { sessions: { id: string; guiPermission?: string; guiPlan?: boolean }[]; guiPicks?: Record<string, { permission?: string; fast?: boolean }> }
    const saved = () => JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8')) as Saved
    await expect.poll(() => saved().sessions.find((x) => x.id === 's1')?.guiPermission, WITHIN).toBe('accept-edits')
    expect(saved().sessions.find((x) => x.id === 's1')?.guiPlan).toBeFalsy()
    await expect.poll(() => saved().guiPicks?.claude, WITHIN).toMatchObject({ permission: 'accept-edits', fast: true })
    await mode.click()
    await fast.click()
    await expect(fast).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(onMark).toHaveCount(0)
  })

  test('hovering a message shows its actions; copy puts the reply on the clipboard (Figma 54A / 54B)', async () => {
    await send('copy this one')
    const reply = feed().getByText('Hello: copy this one')
    await expect(reply).toBeVisible(WITHIN)
    await settled()
    await reply.hover()
    const actions = feed().getByTestId('gui-turn-actions').last()
    await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      await actions.getByRole('button', { name: '复制' }).click()
      await expect(actions.getByRole('button', { name: '已复制' })).toBeVisible()
      expect(execFileSync('pbpaste', { encoding: 'utf8' })).toBe('Hello: copy this one')
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
    // Your message: time · copy · edit, right-aligned under the bubble.
    const mine = lastSent()
    await mine.hover()
    const own = mine.getByTestId('gui-message-actions')
    await expect(own.getByRole('button', { name: '编辑' })).toBeVisible()
    await expect(own).toContainText(/^\d\d:\d\d/)
    await page.screenshot({ path: join(SHOTS, 'message-actions.png') })
  })

  test('编辑 asks again from an earlier message: the rest is dropped and Claude resumes before it (Figma 54C)', async () => {
    await send('edit me please')
    await expect(feed().getByText('Hello: edit me please')).toBeVisible(WITHIN)
    await send('second one')
    await expect(feed().getByText('Hello: second one')).toBeVisible(WITHIN)
    const target = feed()
      .locator('[data-item]')
      .filter({ has: page.getByText('edit me please', { exact: true }) })
    const openEdit = async () => {
      await target.hover()
      await target.getByRole('button', { name: '编辑' }).click()
      // Found on its own: once typed in, the row no longer reads 「edit me please」.
      const box = feed().getByTestId('gui-edit')
      const text = box.getByRole('textbox', { name: '编辑消息' })
      await expect(text).toHaveText('edit me please')
      // It takes the keyboard, the caret at the end; the text is there, so it can be sent as it is.
      await expect(text).toBeFocused()
      await expect(box.getByRole('button', { name: '发送' })).toBeEnabled()
      return box
    }
    // ⎋ leaves it as it was.
    await openEdit()
    await expect(feed().locator('[data-faded]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(target.getByTestId('gui-edit')).toHaveCount(0)
    await expect(feed().locator('[data-faded]')).toHaveCount(0)

    const box = await openEdit()
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.screenshot({ path: join(SHOTS, `edit-message-${theme}.png`) })
    }
    await box.getByRole('textbox', { name: '编辑消息' }).focus()
    await page.keyboard.press('End')
    await page.keyboard.type(', edited')
    await box.getByRole('button', { name: '发送' }).click()
    await expect(feed().getByText('Hello: edit me please, edited')).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: second one')).toHaveCount(0)
    await expect(feed().getByText('second one', { exact: true })).toHaveCount(0)
    // Claude came back on the conversation up to the reply before the edited message.
    const launched = JSON.parse(readFileSync(argsFile, 'utf8')) as { args: string[] }
    const at = launched.args.indexOf('--resume-session-at')
    expect(at).toBeGreaterThan(0)
    expect(launched.args[at + 1]).toMatch(/^assistant-/)
  })

  test('an edited message shows ‹ 2 / 2 ›; the earlier version is drawn in its place (Figma 90G′)', async () => {
    const versions = feed().getByTestId('gui-version-switch')
    await expect(versions).toHaveText(/2 \/ 2/, WITHIN)
    await versions.getByRole('button', { name: '上一个版本' }).click()
    await expect(feed().getByText('Hello: second one')).toBeVisible()
    await expect(feed().getByTestId('gui-version-switch')).toHaveText(/1 \/ 2/)
    await page.screenshot({ path: join(SHOTS, 'versions.png') })
    await feed().getByTestId('gui-version-switch').getByRole('button', { name: '下一个版本' }).click()
    await expect(feed().getByText('Hello: second one')).toHaveCount(0)
  })

  test('回退 takes the conversation back and puts the message in the composer (Figma 90G)', async () => {
    await send('rewind me')
    await expect(feed().getByText('Hello: rewind me')).toBeVisible(WITHIN)
    const target = feed()
      .locator('[data-item]')
      .filter({ has: page.getByText('rewind me', { exact: true }) })
    await target.hover()
    await target.getByTestId('gui-rewind').click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([/回退对话和代码\s*1 个文件/, '只回退对话', /只回退代码\s*1 个文件/], WITHIN)
    await page.screenshot({ path: join(SHOTS, 'rewind-menu.png') })
    await menu.getByRole('menuitem', { name: '只回退对话' }).click()
    await expect(feed().getByText('Hello: rewind me')).toHaveCount(0, WITHIN)
    await expect(input()).toHaveText('rewind me')
    await input().fill('')
  })

  test('scrolled up, the view stays; sending a message brings it back to the end', async () => {
    await feed().evaluate((el) => el.scrollTo(0, 0))
    await feed().evaluate((el) => new Promise((done) => requestAnimationFrame(() => done(el.scrollTop))))
    expect(await feed().evaluate((el) => el.scrollTop)).toBe(0)
    await send('back to the end')
    await expect(feed().getByText('Hello: back to the end')).toBeVisible(WITHIN)
    await expect.poll(() => feed().evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)), WITHIN).toBe(0)
    // Longer than the view, at the end the last block sits 120 above the scroller's edge, clear of the composer
    // (Claude's desktop app); a short scroller stands in for a long conversation.
    const room = await feed().evaluate((el) => {
      el.style.maxHeight = '100px'
      el.scrollTop = el.scrollHeight
      const last = el.firstElementChild?.lastElementChild
      const gap = last ? el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom : -1
      el.style.maxHeight = ''
      return Math.round(gap)
    })
    expect(room).toBe(120)
  })

  test('scrolled up while the reply streams, 「↓ 回到最新」 brings the view back (Figma 90F′)', async () => {
    await send('slow answer')
    await expect.poll(() => feed().evaluate((el) => el.textContent?.includes('Hello...') ?? false), WITHIN).toBe(true)
    await feed().evaluate((el) => el.scrollTo(0, 0))
    const jump = page.getByTestId('gui-jump-to-latest')
    await expect(jump).toBeVisible(WITHIN)
    await page.screenshot({ path: join(SHOTS, 'jump-to-latest.png') })
    await jump.click()
    await expect(jump).toHaveCount(0, WITHIN)
    await expect.poll(() => feed().evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 48), WITHIN).toBe(true)
    await composer().getByRole('button', { name: '停止' }).click()
    // Settled before the next test counts the turns: the stopped reply is gone.
    await settled()
    await expect.poll(() => feed().evaluate((el) => el.textContent?.includes('Hello...') ?? false), WITHIN).toBe(false)
  })

  test('reads like a chat: the agent’s mark on each turn, the user’s picture and 对话 settings (Figma 51A)', async () => {
    // One mark per turn: each run of agent blocks after a user message (a turn stopped before any reply has none).
    // The last test's reply may still be on its way: compare until both settle.
    const counts = () =>
      feed()
        .locator('> div')
        .first()
        .evaluate((column) => {
          const turns = [...column.children].filter((el, i, all) => !el.hasAttribute('data-item') && (i === 0 || all[i - 1]!.hasAttribute('data-item'))).length
          return { turns, marks: column.querySelectorAll('[data-agent-mark]').length }
        })
    await expect.poll(async () => { const c = await counts(); return c.turns === c.marks && c.turns > 3 }, WITHIN).toBe(true)
    // The mark is a solid circle that is never cut by its block (blocks paint only inside themselves).
    for (const mark of await feed().locator('[data-agent-mark]').all()) {
      const [box, turn] = await Promise.all([mark.boundingBox(), mark.locator('..').boundingBox()])
      expect(box!.y).toBeGreaterThanOrEqual(turn!.y)
      expect(box!.y + box!.height).toBeLessThanOrEqual(turn!.y + turn!.height + 0.5)
    }
    const userAvatar = feed().locator('[data-item]').last().locator('[aria-hidden]').last()
    await expect(userAvatar).toBeHidden()
    const avatar = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}`
    await page.evaluate(
      (chat) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { chat } }),
      { width: 'medium', fontWeight: 500, fontSize: 16, opacity: 0.85, avatar }
    )
    await expect(userAvatar).toBeVisible()
    const bubble = feed().locator('[data-item]').last()
    await expect.poll(() => bubble.evaluate((el) => getComputedStyle(el.querySelector('p, li')!).fontSize)).toBe('16px')
    expect(await bubble.evaluate((el) => getComputedStyle(el.querySelector('p, li')!).fontWeight)).toBe('500')
    // The column is the composer's (960 for 中) with room each side for a picture and its gap: at 16 / 25 the picture is
    // a one-line bubble's height, 8 + 25 + 8 = 41, and 41 + 12 = 53 each side.
    expect(await feed().locator('> div').first().evaluate((el) => getComputedStyle(el).maxWidth)).toBe('1066px')
    // The agent's words start at the composer's left edge, its mark 12 outside; the bubble ends at its right edge, the
    // picture 8 outside.
    await feed().evaluate((el) => el.scrollTo(0, 0))
    const [boxEdge, words, mark, sent, picture] = await Promise.all([
      page.getByTestId('gui-composer-box').boundingBox(),
      feed().getByText('Hello: 你好').boundingBox(),
      feed().locator('[data-agent-mark]').first().boundingBox(),
      bubble.locator('> div > div').first().boundingBox(),
      userAvatar.boundingBox()
    ])
    expect(Math.round(words!.x)).toBe(Math.round(boxEdge!.x))
    expect(Math.round(mark!.x + mark!.width + 12)).toBe(Math.round(boxEdge!.x))
    expect(Math.round(sent!.x + sent!.width)).toBe(Math.round(boxEdge!.x + boxEdge!.width))
    expect(Math.round(picture!.x - 8)).toBe(Math.round(boxEdge!.x + boxEdge!.width))
    // Both pictures are as tall as a one-line bubble; the user's shares its bubble's top, the agent's middle is its
    // first line's.
    expect(Math.round(picture!.height)).toBe(41)
    expect(Math.round(mark!.height)).toBe(41)
    expect(Math.round(picture!.y)).toBe(Math.round(sent!.y))
    expect(Math.round(mark!.y + mark!.height / 2)).toBe(Math.round(words!.y + words!.height / 2))
    expect(await chat().evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toMatch(/0\.85\)$|color\(srgb .* \/ 0\.85\)$/)
    await feed().evaluate((el) => el.scrollTo(0, 0))
    await page.screenshot({ path: join(SHOTS, 'chat-avatars.png') })
    await page.evaluate(() =>
      (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({
        appearance: { chat: { width: 'narrow', fontWeight: 400, fontSize: 14, opacity: 1, avatar: '' } }
      })
    )
    await expect(userAvatar).toBeHidden()
  })

  test('lists the agent’s commands under /: 命令, then Skills (Figma 59H)', async () => {
    await input().fill('/re')
    const menu = page.getByTestId('gui-slash-menu')
    await expect(menu).toContainText('review', WITHIN)
    // Turns have run, so system/init has said which entries are skills.
    const groups = menu.getByTestId('gui-slash-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(0).getByRole('option')).toHaveText(['/review[path]Review the diff'])
    await expect(groups.nth(1).getByRole('option')).toHaveText(['/research<topic>Research a topic and write a report'])
    await expect(groups.locator('[class*="popoverTitle"]')).toHaveText(['命令', 'Skills'])
    // The keys go down in the order shown.
    await input().press('ArrowDown')
    await expect(menu.locator('[aria-selected="true"]')).toContainText('research')
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `slash-menu-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await input().fill('')
  })

  test('looks right in both themes', async () => {
    // The empty composer shows its placeholder (Tiptap's class, not a module class).
    // The previous test just emptied it: the placeholder comes with the editor's next render.
    await expect.poll(() => input().locator('p').first().evaluate((p) => getComputedStyle(p, '::before').content)).toBe('"回复"')
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `chat-${theme}.png`) })
    }
  })

  test('a long message of yours opens folded to 10 lines over 「展开」; 「收起」 folds it again, the button staying put (Figma 96A)', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：把登录态从 localStorage 挪到 httpOnly cookie，改完跑一遍测试。`).join(' ')
    await send(long)
    await expect(feed().getByText(/^Hello: 第 1 段/)).toBeVisible(WITHIN)
    await settled()
    const mine = feed().locator('[data-item]').filter({ hasText: '第 40 段' }).first()
    const fold = mine.getByTestId('gui-message-fold')
    await expect(fold).toHaveText('展开')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    // A short message has no button.
    await expect(feed().locator('[data-item]').filter({ hasText: '你好' }).first().getByTestId('gui-message-fold')).toHaveCount(0)
    const lines = () => mine.evaluate((row) => {
      const body = row.querySelector<HTMLElement>('[data-folded], [class*="bubbleBody"]')!
      return Math.round(body.getBoundingClientRect().height / parseFloat(getComputedStyle(body.firstElementChild!).lineHeight))
    })
    expect(await lines()).toBe(10)
    const top = async () => Math.round((await fold.boundingBox())?.y ?? NaN)
    // In view first: a click scrolls a button that is not, and that is not the button moving.
    await fold.scrollIntoViewIfNeeded()
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `long-message-folded-${theme}.png`) })
    }
    const before = await top()
    await fold.click()
    await expect(fold).toHaveText('收起')
    expect(await lines()).toBeGreaterThan(13)
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(SHOTS, 'long-message-expanded.png') })
    await fold.click()
    await expect(fold).toHaveText('展开')
    expect(await lines()).toBe(10)
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1)
  })

  test('看板 shows a GUI session’s chat in its overlay, not an empty terminal (PRD F9 / F23)', async () => {
    const overview = page.locator('[data-region="overview"]')
    const overlay = page.locator('[data-region="overview-overlay"]')
    await page.keyboard.press('Meta+Shift+A')
    await expect(overview).toBeVisible()
    await overview.locator('[data-session-id="s1"]').click()
    const shown = overlay.getByTestId('gui-chat')
    await expect(shown).toBeVisible(WITHIN)
    await expect(shown.locator('[data-region="gui-feed"]').getByText('Hello: 你好')).toBeVisible()
    // ⏎ in the overlay's composer sends the message; it does not enter the session.
    const box = overlay.getByTestId('gui-composer').getByRole('textbox', { name: '回复' })
    await box.fill('看板里发的')
    await box.press('Enter')
    await expect(shown.locator('[data-region="gui-feed"]').getByText('Hello: 看板里发的')).toBeVisible(WITHIN)
    await expect(overlay).toBeVisible()
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `board-overlay-${theme}.png`) })
    }
    await page.evaluate(() => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: 'dark' } }))
    await overlay.getByRole('button', { name: '关闭' }).click()
    await expect(overlay).toBeHidden()
    await page.keyboard.press('Meta+Shift+A')
    await expect(overview).toBeHidden()
    await expect(chat()).toBeVisible()
  })

  test('keeps the conversation across a window reload (same process)', async () => {
    await page.reload()
    await expect(chat()).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: 你好')).toBeVisible(WITHIN)
  })

})
