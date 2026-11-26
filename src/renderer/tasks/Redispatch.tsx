// 派给主理人… (PRD F9 v1.252 补派, Figma 117F): beside a card that waits, its leader · model · effort and 派发. Esc or a
// press elsewhere closes it.
import { useEffect, useRef, useState } from 'react'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import { LeaderPickers, useLeaderPickers, type LeaderSelection } from './LeaderPickers'
import styles from './Redispatch.module.css'

const M = defineMessages({
  zh: { title: (seq: number) => `把 #${seq} 派给主理人`, dispatch: '派发', noAgent: '没找到装了的 CLI', noDetect: '没能检测装了哪些 CLI' },
  en: { title: (seq: number) => `Dispatch #${seq} to a leader`, dispatch: 'Dispatch', noAgent: 'No installed CLI found', noDetect: 'Could not detect the installed CLIs' }
})

interface Props {
  seq: number
  /** Where it goes in the board, px: beside its card. */
  at: { x: number; y: number }
  onDispatch(selection: LeaderSelection): void
  onClose(refocus: boolean): void
}

export function Redispatch({ seq, at, onDispatch, onClose }: Props) {
  const m = useMessages(M)
  const leader = useLeaderPickers(false)
  const [busy, setBusy] = useState(false)
  const [undetected, setUndetected] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement
      // The pickers' menus are portalled to <body>.
      if (!box.current?.contains(target) && !target.closest('[data-new-session-menu]')) onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  const dispatch = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setUndetected(false)
    const selection = await leader.resolve()
    if (selection.agent !== null) {
      onDispatch(selection)
      return
    }
    setBusy(false)
    setUndetected(true)
  }
  const reason = leader.found !== null && leader.agent === 'none' ? m.noAgent : undetected ? m.noDetect : null

  return (
    <div
      ref={box}
      className={styles.popover}
      style={{ left: at.x, top: at.y }}
      role="dialog"
      aria-label={m.title(seq)}
      data-testid="task-redispatch"
      data-no-pan=""
      onKeyDown={(e) => {
        // The board's own keys stay out; Esc closes.
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose(true)
        }
      }}
    >
      <LeaderPickers state={leader} onClosed={() => button.current?.focus()} />
      <button ref={button} type="button" className={styles.submit} disabled={busy || leader.agent === 'none'} data-testid="task-redispatch-submit" onClick={() => void dispatch()}>
        {m.dispatch}
      </button>
      {reason !== null && (
        <p className={styles.error} role="alert">
          {reason}
        </p>
      )}
    </div>
  )
}
