// Keep the Mac from idle-sleeping while Wavi runs (PRD v1.238, 设置 · 自动化 · 电源). 'prevent-app-suspension' is
// IOKit PreventUserIdleSystemSleep: the display may still sleep, and it does not stop lid-close sleep on battery.
import { app, powerSaveBlocker } from 'electron'
import { getSettings, onSettingsChange } from './settings'

export interface BlockerApi {
  start(): number
  stop(id: number): void
}

/** Holds at most one blocker; `set(true)` twice starts once, `set(false)` without a blocker does nothing. */
export function createKeepAwake(api: BlockerApi): { set(on: boolean): void } {
  let id: number | null = null
  return {
    set(on) {
      if (on && id === null) id = api.start()
      else if (!on && id !== null) {
        api.stop(id)
        id = null
      }
    }
  }
}

export function installKeepAwake(): void {
  const keepAwake = createKeepAwake({
    start: () => powerSaveBlocker.start('prevent-app-suspension'),
    stop: (id) => powerSaveBlocker.stop(id)
  })
  keepAwake.set(getSettings().power.keepAwake)
  onSettingsChange((settings) => keepAwake.set(settings.power.keepAwake))
  app.on('will-quit', () => keepAwake.set(false))
}
