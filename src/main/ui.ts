// Native pickers and system services the renderer cannot reach itself.
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, Notification, shell, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import { IPC } from '@shared/ipc'
import { hostWindowFor } from './app-windows'
import { secondaryWindowsOf } from './secondary-windows'
import { defineMessages, pick } from '@shared/i18n'

const M = defineMessages({ zh: { openProject: '打开项目', add: '添加' }, en: { openProject: 'Open project', add: 'Add' } })

const COPYABLE_IMAGE: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

// Pages whose image preview is open: the View menu's font size items zoom the picture there (windows.ts).
const previewOpen = new Set<number>()

/** A font size step picked in the menu while `page` shows the image preview goes to the preview; false when it does not. */
export function routeToImagePreview(page: WebContents | undefined, step: 'bigger' | 'smaller' | 'reset'): boolean {
  if (!page || page.isDestroyed() || !previewOpen.has(page.id)) return false
  page.send(IPC.uiImageZoom, step === 'bigger' ? 'in' : step === 'smaller' ? 'out' : 'fit')
  return true
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

// Notifications are garbage-collected (and their click handlers lost) unless something holds them.
const liveNotifications = new Set<Notification>()

export function registerUiHandlers(): void {

  ipcMain.on(IPC.uiRevealInFinder, (_event, path: unknown) => {
    if (typeof path === 'string' && path.length <= 4096 && isAbsolute(path)) shell.showItemInFolder(path)
  })

  // The image preview's 复制图片 (Figma 112G): a picture file the chat shows, as an image on the clipboard.
  // Electron 44's clipboard has no `writeImage`: the picture goes as a PNG item (`clipboard.write`, the W3C shape).
  ipcMain.handle(IPC.uiCopyImage, async (_event, path: unknown) => {
    if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || path.includes('\0')) return false
    if (!COPYABLE_IMAGE.has(extname(path).toLowerCase()) || !existsSync(path)) return false
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    return true
  })

  ipcMain.on(IPC.uiSetImagePreviewOpen, (event, open: unknown) => {
    if (typeof open !== 'boolean') return
    const page = event.sender
    if (!open) return void previewOpen.delete(page.id)
    previewOpen.add(page.id)
    page.once('destroyed', () => previewOpen.delete(page.id))
  })

  ipcMain.on(IPC.uiSetBadge, (_event, count: unknown) => {
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    app.dock?.setBadge(n > 0 ? String(n) : '')
  })

  ipcMain.on(IPC.uiNotify, (event, raw: unknown) => {
    if (!Notification.isSupported() || typeof raw !== 'object' || raw === null) return
    const { title, body, tag } = raw as Record<string, unknown>
    const notification = new Notification({ title: text(title, 200), body: text(body, 500) })
    const sender = event.sender
    const release = () => liveNotifications.delete(notification)
    notification.on('click', () => {
      release()
      // With secondary windows the page brings forward the window that shows the session (F20 · 多窗口).
      if (secondaryWindowsOf(sender).length === 0) {
        const win = BrowserWindow.fromWebContents(sender)
        win?.show()
        win?.focus()
      }
      if (!sender.isDestroyed()) sender.send(IPC.uiNotificationClick, text(tag, 200))
    })
    notification.on('close', release)
    liveNotifications.add(notification)
    notification.show()
  })

  ipcMain.handle(IPC.uiPickFolder, async (event) => {
    const win = hostWindowFor(event.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, buttonLabel: pick(M).openProject }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // The session header's paperclip: files whose paths go into the terminal (renderer/terminal/attachments.ts).
  ipcMain.handle(IPC.uiPickFiles, async (event, defaultPath: unknown) => {
    const win = hostWindowFor(event.sender)
    const start = typeof defaultPath === 'string' && defaultPath.length <= 4096 && isAbsolute(defaultPath) && !defaultPath.includes('\0') ? defaultPath : undefined
    const options = {
      // Files and folders alike (macOS lets one panel pick both).
      properties: ['openFile', 'openDirectory', 'multiSelections', 'treatPackageAsDirectory'] as Array<
        'openFile' | 'openDirectory' | 'multiSelections' | 'treatPackageAsDirectory'
      >,
      buttonLabel: pick(M).add,
      ...(start ? { defaultPath: start } : {})
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
}
