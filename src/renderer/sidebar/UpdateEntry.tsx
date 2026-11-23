// The sidebar's 更新 (Figma 36G / 36I, PRD v1.93): above 定时任务, it opens a small panel with the running version and
// 检查更新. A newer GitHub release turns the button into 下载 <version>, which opens the release page — Wavi never
// downloads or installs anything itself (PRD §7). Replaces settings' 关于 pane.
import { useCallback, useRef, useState } from 'react'
import { CircleArrowUp } from '../ui/icons'
import { defineMessages } from '@shared/i18n'
import type { UpdateCheck, UpdateInfo } from '@shared/ipc'
import { useMessages } from '../ui/i18n'
import { Popover } from '../session-meta/Popover'
import { NavItem } from './NavItem'
import styles from './UpdateEntry.module.css'

const M = defineMessages({
  zh: {
    update: '更新',
    checking: '正在检查…',
    latest: '已是最新版本',
    failed: '无法检查更新',
    available: (version: string) => `有新版本 ${version}`,
    download: (version: string) => `下载 ${version}`,
    check: '检查更新'
  },
  en: {
    update: 'Update',
    checking: 'Checking…',
    latest: "You're up to date",
    failed: "Couldn't check for updates",
    available: (version: string) => `New version ${version}`,
    download: (version: string) => `Download ${version}`,
    check: 'Check for updates'
  }
})

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'latest' }
  | { phase: 'failed' }
  | { phase: 'available'; info: UpdateInfo }

export function UpdateEntry() {
  const m = useMessages(M)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  const check = (): void => {
    setState({ phase: 'checking' })
    const apply = (result: UpdateCheck): void => {
      if (result.status === 'available') setState({ phase: 'available', info: result.info })
      else setState({ phase: result.status })
    }
    void window.tr.app
      .checkForUpdates()
      .then(apply)
      .catch(() => setState({ phase: 'failed' }))
  }

  return (
    <>
      <NavItem
        ref={anchor}
        icon={<CircleArrowUp size={16} strokeWidth={1.75} />}
        label={m.update}
        selected={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Popover anchor={anchor} label={m.update} onClose={close} placement="above" className={styles.panel} testId="update-popover">
          <div className={styles.version}>
            <span className={styles.name}>Wavi</span>
            <span className={styles.number} data-testid="app-version">
              {window.tr.app.version}
            </span>
          </div>
          {state.phase !== 'idle' && (
            <p className={styles.status} role="status" aria-live="polite" data-new={state.phase === 'available'}>
              {state.phase === 'checking' && m.checking}
              {state.phase === 'latest' && m.latest}
              {state.phase === 'failed' && m.failed}
              {state.phase === 'available' && m.available(state.info.version)}
            </p>
          )}
          {state.phase === 'available' ? (
            <a className={`${styles.button} ${styles.primary}`} href={state.info.url} target="_blank" rel="noreferrer">
              {m.download(state.info.version)}
            </a>
          ) : (
            <button type="button" className={styles.button} onClick={check} disabled={state.phase === 'checking'}>
              {m.check}
            </button>
          )}
        </Popover>
      )}
    </>
  )
}
