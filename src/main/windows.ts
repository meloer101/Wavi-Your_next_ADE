// Window factory and the app menu.
import { app, BaseWindow, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { defineMessages, pick } from '@shared/i18n'
import { IPC } from '@shared/ipc'
import { viewMenuItems } from '@shared/lifecycle'
import { SHORTCUTS, stepFontSize, type FontSizeStep, type MenuCommand } from '@shared/shortcuts'
import { nativeGlass } from './appearance'
import { clearActivity } from './activity'
import { appWindows, isAppWindow, isSecondaryWindow, rendererOf } from './app-windows'
import { releaseSessionsOf } from './pty'
import { isQuitting, quitEndingSessions } from './quit'
import { adoptSecondaryWindow, closeSecondaryWindowsOf, secondaryKeyOf, secondaryWindowOptions } from './secondary-windows'
import { getSettings, updateSettings } from './settings'
import { routeToImagePreview } from './ui'
import { isDeveloperBuild } from './source-checkout'
import { restoreBounds, saveBounds } from './window-state'

let mainWindow: BrowserWindow | null = null

function baseOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    titleBarStyle: 'hiddenInset',
    // Centred on the 36px title strip (--titlebar-height), which starts 6px (--card-gap) below the window's top.
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: '#0a0a0a',
    // Liquid Glass (macOS 26) needs a transparent window (appearance.ts).
    transparent: nativeGlass,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  }
}

/**
 * PRD F24: opened by the pty daemon for a scheduled task (`--wavi-scheduled`) or as a login item — the first window
 * stays hidden (no focus taken); the Dock icon or a second launch shows it.
 */
let firstWindowLoaded = false
const launchedInBackground = (): boolean =>
  process.argv.includes('--wavi-scheduled') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)

function load(win: BrowserWindow): void {
  const hidden = !firstWindowLoaded && launchedInBackground()
  firstWindowLoaded = true
  win.once('ready-to-show', () => {
    if (!hidden) win.show()
  })
  // Links open in the default browser; app windows never navigate away.
  // …except the page's own secondary windows (F20 · 多窗口), which it draws itself.
  win.webContents.setWindowOpenHandler((details) => {
    const secondary = secondaryWindowOptions(details, baseOptions())
    if (secondary) return { action: 'allow', overrideBrowserWindowOptions: secondary }
    if (/^https?:/.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', (child, details) => adoptSecondaryWindow(child, win.webContents, details.frameName))
  // A reload (or a crash) takes the page that draws the secondary windows: they close, and the new page reopens them.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) closeSecondaryWindowsOf(win.webContents)
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMainWindow(): BrowserWindow {
  const min = { minWidth: 960, minHeight: 600 }
  const restored = restoreBounds({ width: 1440, height: 900 }, min)
  const win = new BrowserWindow({ ...baseOptions(), ...restored.options, ...min, title: app.name })
  saveBounds(win, restored)
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // The red close button only hides the window: agents keep running, and the Dock icon brings it back.
  win.on('close', (event) => {
    if (isQuitting() || process.platform !== 'darwin') return
    event.preventDefault()
    // A full-screen window must leave full screen first or macOS leaves an empty Space behind.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide())
      win.setFullScreen(false)
    } else {
      win.hide()
    }
  })
  // A crashed renderer is reloaded; the workspace restores. With the pty daemon its terminals keep running and the
  // reloaded window reattaches them; with the fallback host they are killed.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details.reason, details.exitCode)
    clearActivity(win.webContents)
    releaseSessionsOf(win.webContents)
    closeSecondaryWindowsOf(win.webContents)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  // 全屏背景 (PRD v1.97): the page draws its own field behind the glass while the window is full screen.
  const sendFullScreen = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.uiFullScreen, win.isFullScreen())
  }
  win.on('enter-full-screen', sendFullScreen)
  win.on('leave-full-screen', sendFullScreen)
  win.webContents.on('did-finish-load', sendFullScreen)
  load(win)
  return win
}

/** Asks a window's renderer to show the settings dialog (Figma 07). */
export function showSettings(win: BrowserWindow | null | undefined): void {
  const target = win && !win.isDestroyed() ? win : (appWindows().find((w) => w.isFocused()) ?? appWindows()[0])
  if (!target) return
  target.show()
  // A secondary window is drawn by the main window's page, which shows the dialog in the window the user is in.
  rendererOf(target).send(IPC.uiShowSettings)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Shows (or recreates) the main window and focuses it: Dock click, second launch. */
export function showMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}


/** The app menu's labels. reload / devTools: dev runs and the linked app only (release builds have neither). */
const MENU = defineMessages({
  zh: {
    about: (name: string) => `关于 ${name}`,
    hide: (name: string) => `隐藏 ${name}`,
    quit: (name: string) => `退出 ${name}`,
    reload: '重新载入',
    devTools: '开发者工具',
    settings: '设置…',
    usage: '额度…',
    schedules: '定时任务…',
    services: '服务',
    hideOthers: '隐藏其他',
    unhide: '全部显示',
    quitEndingSessions: '退出并结束所有会话…',
    file: '文件',
    newSession: '新建会话',
    openProject: '打开项目…',
    openProjectInWindow: '在新窗口中打开项目…',
    closeSession: '关闭会话',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '拷贝',
    paste: '粘贴',
    selectAll: '全选',
    find: '在终端中查找…',
    session: '会话',
    jumpTo: '跳转到…',
    board: '看板',
    nextAttention: '下一个需要你的会话',
    rename: '重命名会话',
    sameTask: '同任务多解…',
    gitNext: 'Git 下一步',
    view: '显示',
    toggleSidebar: '显示 / 隐藏侧栏',
    toggleRightPanel: '显示 / 隐藏右侧栏',
    splitRight: '向右拆分',
    splitDown: '向下拆分',
    closePane: '关掉这一格',
    paneLeft: '移到左边的格',
    paneRight: '移到右边的格',
    paneUp: '移到上面的格',
    paneDown: '移到下面的格',
    paneToWindow: '把这一格移到新窗口',
    bigger: '放大',
    smaller: '缩小',
    actualSize: '实际大小',
    fullscreen: '进入全屏',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    mainWindow: '主窗口',
    front: '前置全部窗口',
  },
  en: {
    about: (name: string) => `About ${name}`,
    hide: (name: string) => `Hide ${name}`,
    quit: (name: string) => `Quit ${name}`,
    reload: 'Reload',
    devTools: 'Developer Tools',
    settings: 'Settings…',
    usage: 'Usage…',
    schedules: 'Scheduled Tasks…',
    services: 'Services',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quitEndingSessions: 'Quit and End All Sessions…',
    file: 'File',
    newSession: 'New Session',
    openProject: 'Open Project…',
    openProjectInWindow: 'Open Project in New Window…',
    closeSession: 'Close Session',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    find: 'Find in Terminal…',
    session: 'Session',
    jumpTo: 'Jump to…',
    board: 'Board',
    nextAttention: 'Next Session That Needs You',
    rename: 'Rename Session',
    sameTask: 'Same Task, Several Tries…',
    gitNext: 'Git Next Step',
    view: 'View',
    toggleSidebar: 'Show / Hide Sidebar',
    toggleRightPanel: 'Show / Hide Right Panel',
    splitRight: 'Split Right',
    splitDown: 'Split Down',
    closePane: 'Close Pane',
    paneLeft: 'Move to Left Pane',
    paneRight: 'Move to Right Pane',
    paneUp: 'Move to Pane Above',
    paneDown: 'Move to Pane Below',
    paneToWindow: 'Move Pane to New Window',
    bigger: 'Zoom In',
    smaller: 'Zoom Out',
    actualSize: 'Actual Size',
    fullscreen: 'Enter Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    mainWindow: 'Main Window',
    front: 'Bring All to Front',
  }
})

/** Sends a menu command to the window it was picked in (or the main window); the renderer runs it. */
function command(name: MenuCommand): Pick<MenuItemConstructorOptions, 'click'> {
  return {
    click: (_item, window) => {
      // In a page's sign-in pop-up only ⌘W means something: it closes the pop-up, never the session behind it.
      if (window instanceof BrowserWindow && !isAppWindow(window)) {
        if (name === 'close-session' && !window.isDestroyed()) window.close()
        return
      }
      const target = window instanceof BrowserWindow ? window : getMainWindow()
      if (!target || target.isDestroyed()) return
      // A secondary window's commands go to the page that draws it, with the window they were picked in.
      if (isSecondaryWindow(target)) rendererOf(target).send(IPC.uiMenuCommand, name, secondaryKeyOf(target))
      else target.webContents.send(IPC.uiMenuCommand, name)
    }
  }
}

/** The View menu's font size items: the chat's image preview, while it is open in the page, takes them as its zoom keys. */
function stepFont(step: FontSizeStep, window: BaseWindow | undefined): void {
  const page = window instanceof BrowserWindow && isAppWindow(window) ? rendererOf(window) : getMainWindow()?.webContents
  if (routeToImagePreview(page, step)) return
  void updateSettings({ appearance: { fontSize: stepFontSize(getSettings().appearance.fontSize, step) } })
}

/**
 * The app menu, in the interface language (B8; rebuilt when it changes, main/language.ts). Shortcuts come from @shared/shortcuts so the menu, ⌘K and the sidebar agree.
 * Commands the renderer owns are sent to it (`ui:menu-command`); editing keeps the native roles (copy/paste need
 * the Edit menu); font size is a setting, changed here.
 */
export function installAppMenu(): void {
  const m = pick(MENU)
  const devItems: MenuItemConstructorOptions[] = viewMenuItems(!isDeveloperBuild())
    .filter((item) => item !== 'togglefullscreen')
    .map((item) => (item === 'separator' ? { type: 'separator' } : { role: item, label: item === 'reload' ? m.reload : m.devTools }))
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: m.about(app.name) },
        { type: 'separator' },
        { label: m.settings, accelerator: SHORTCUTS.settings, click: (_item, window) => showSettings(window instanceof BrowserWindow ? window : null) },
        { label: m.usage, accelerator: SHORTCUTS['open-usage'], ...command('open-usage') },
        { label: m.schedules, accelerator: SHORTCUTS['open-schedules'], ...command('open-schedules') },
        { type: 'separator' },
        { role: 'services', label: m.services },
        { type: 'separator' },
        { role: 'hide', label: m.hide(app.name) },
        { role: 'hideOthers', label: m.hideOthers },
        { role: 'unhide', label: m.unhide },
        { type: 'separator' },
        // Sessions keep running in the pty daemon after ⌘Q; this one ends them too.
        { role: 'quit', label: m.quit(app.name) },
        { label: m.quitEndingSessions, accelerator: SHORTCUTS['quit-ending-sessions'], click: () => quitEndingSessions(getMainWindow) }
      ]
    },
    {
      label: m.file,
      submenu: [
        { label: m.newSession, accelerator: SHORTCUTS['new-session'], ...command('new-session') },
        { label: m.openProject, accelerator: SHORTCUTS['open-project'], ...command('open-project') },
        { label: m.openProjectInWindow, accelerator: SHORTCUTS['open-project-in-window'], ...command('open-project-in-window') },
        { type: 'separator' },
        // Not the window's Close: ⌘W closes the active session (with its confirmation).
        { label: m.closeSession, accelerator: SHORTCUTS['close-session'], ...command('close-session') }
      ]
    },
    {
      label: m.edit,
      submenu: [
        { role: 'undo', label: m.undo },
        { role: 'redo', label: m.redo },
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        { role: 'selectAll', label: m.selectAll },
        { type: 'separator' },
        { label: m.find, accelerator: SHORTCUTS.find, ...command('find') }
      ]
    },
    {
      label: m.session,
      submenu: [
        { label: m.jumpTo, accelerator: SHORTCUTS['command-palette'], ...command('command-palette') },
        { label: m.board, accelerator: SHORTCUTS['toggle-overview'], ...command('toggle-overview') },
        { label: m.nextAttention, accelerator: SHORTCUTS['next-attention'], ...command('next-attention') },
        { type: 'separator' },
        { label: m.rename, ...command('rename-session') },
        { label: m.sameTask, accelerator: SHORTCUTS['same-task'], ...command('same-task') },
        { label: m.gitNext, accelerator: SHORTCUTS['merge-worktree'], ...command('merge-worktree') }
      ]
    },
    {
      label: m.view,
      submenu: [
        { label: m.toggleSidebar, accelerator: SHORTCUTS['toggle-sidebar'], ...command('toggle-sidebar') },
        { label: m.toggleRightPanel, accelerator: SHORTCUTS['toggle-right-panel'], ...command('toggle-right-panel') },
        { type: 'separator' },
        // The main area's split (PRD F20).
        { label: m.splitRight, accelerator: SHORTCUTS['split-right'], ...command('split-right') },
        { label: m.splitDown, accelerator: SHORTCUTS['split-down'], ...command('split-down') },
        { label: m.closePane, accelerator: SHORTCUTS['close-pane'], ...command('close-pane') },
        { label: m.paneLeft, accelerator: SHORTCUTS['focus-pane-left'], ...command('focus-pane-left') },
        { label: m.paneRight, accelerator: SHORTCUTS['focus-pane-right'], ...command('focus-pane-right') },
        { label: m.paneUp, accelerator: SHORTCUTS['focus-pane-up'], ...command('focus-pane-up') },
        { label: m.paneDown, accelerator: SHORTCUTS['focus-pane-down'], ...command('focus-pane-down') },
        { label: m.paneToWindow, ...command('pane-to-window') },
        { type: 'separator' },
        { label: m.bigger, accelerator: SHORTCUTS['font-bigger'], click: (_item, window) => stepFont('bigger', window) },
        // ⌘= is the unshifted key under ⌘+; it does the same, without a second visible item.
        { label: m.bigger, accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: (_item, window) => stepFont('bigger', window) },
        { label: m.smaller, accelerator: SHORTCUTS['font-smaller'], click: (_item, window) => stepFont('smaller', window) },
        { label: m.actualSize, accelerator: SHORTCUTS['font-reset'], click: (_item, window) => stepFont('reset', window) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen },
        ...(devItems.length > 0 ? [{ type: 'separator' } as const, ...devItems] : [])
      ]
    },
    {
      role: 'window',
      label: m.window,
      // Not `windowMenu`: its Close item owns ⌘W, which closes the active session instead (renderer).
      submenu: [
        { role: 'minimize', label: m.minimize },
        { role: 'zoom', label: m.zoom },
        { type: 'separator' },
        // The red button only hides the main window; with secondary windows open the Dock icon no longer brings it back.
        { label: m.mainWindow, click: () => showMainWindow() },
        { type: 'separator' },
        { role: 'front', label: m.front }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
