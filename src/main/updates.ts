// "A newer release exists" (PRD §7, unsigned builds): asks GitHub for the latest release, answers the
// renderer's checkForUpdates(), and shows one notification per new version. It never downloads or
// installs anything; clicking the notification opens the release page.
import { app, ipcMain, Notification, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IPC, type UpdateCheck, type UpdateInfo } from '@shared/ipc'
import { isDeveloperBuild, sourceRoot } from './source-checkout'
import { defineMessages, pick } from '@shared/i18n'

const M = defineMessages({
  zh: { released: (name: string, version: string) => `${name} ${version} 已发布`, body: '点击查看更新内容并下载。' },
  en: { released: (name: string, version: string) => `${name} ${version} is out`, body: "Click to see what's new and download it." }
})
import { checkLatestRelease, parseRepository, type FetchLike } from './update-check'

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

// The package.json of the code that runs. The linked app's shell has one of its own, written once by
// `npm run app:install` with neither later version bumps nor `repository`, so it reads the checkout's.
function runningPackage(): { version?: unknown; repository?: unknown } | null {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(sourceRoot() ?? app.getAppPath(), 'package.json'), 'utf8'))
    return typeof pkg === 'object' && pkg !== null ? pkg : null
  } catch {
    return null
  }
}

/** The running version: the checkout's for the linked app, else `app.getVersion()`. */
export function appVersion(): string {
  const version = runningPackage()?.version
  return typeof version === 'string' ? version : app.getVersion()
}

/** Latest GitHub release if newer than the running app: `latest`, `available` or `failed`. Never throws. */
export function checkForUpdates(): Promise<UpdateCheck> {
  return checkLatestRelease(parseRepository(runningPackage()?.repository), appVersion(), fetch as FetchLike)
}

// The last version we notified about survives restarts, so a user who ignores it is not nagged on every launch.
const notifiedFile = (): string => join(app.getPath('userData'), 'update-notified.json')

function lastNotifiedVersion(): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(notifiedFile(), 'utf8'))
    const version = typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

async function rememberNotified(version: string): Promise<void> {
  try {
    await mkdir(dirname(notifiedFile()), { recursive: true })
    await writeFile(notifiedFile(), JSON.stringify({ version }))
  } catch {
    // Worst case the next launch notifies again.
  }
}

let notified: string | null = null
// Held so the notification is not garbage-collected before the user clicks it.
const live = new Set<Notification>()

function notify(update: UpdateInfo): void {
  notified ??= lastNotifiedVersion()
  if (notified === update.version || !Notification.isSupported()) return
  notified = update.version
  void rememberNotified(update.version)
  const notification = new Notification({
    title: pick(M).released(app.name, update.version),
    body: pick(M).body,
    silent: true
  })
  live.add(notification)
  notification.on('click', () => void shell.openExternal(update.url))
  notification.on('close', () => live.delete(notification))
  notification.show()
}

async function checkAndNotify(): Promise<void> {
  const result = await checkForUpdates()
  if (result.status === 'available') notify(result.info)
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.appCheckForUpdates, () => checkForUpdates())

  // Only release builds poll in the background; dev runs, the linked app and e2e never touch the network.
  if (isDeveloperBuild() || process.env.TR_DISABLE_UPDATE_CHECK) return
  setTimeout(() => {
    void checkAndNotify()
    setInterval(() => void checkAndNotify(), CHECK_INTERVAL_MS).unref()
  }, FIRST_CHECK_DELAY_MS).unref()
}
