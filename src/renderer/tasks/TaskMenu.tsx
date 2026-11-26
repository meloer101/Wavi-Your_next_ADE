// The board's right-click menu (PRD F9 v1.252 右键和键盘, Figma 117A / 117A′ / 117B / 117C): for a card, for several
// selected cards, and for empty canvas. Built like the new-session sheet's menu: rendered into <body>, kept on screen,
// ↑ ↓ ↵ and Esc, closed by a press outside it.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import styles from './TaskMenu.module.css'

export interface TaskMenuItem {
  key: string
  label: string
  /** The key that does the same on the board, shown on the right. */
  shortcut?: string
  danger?: boolean
  run(): void
}

const EDGE = 8

interface Props {
  /** Where the pointer was, in window coordinates. */
  at: { x: number; y: number }
  label: string
  /** Groups of items, a hairline between them; empty groups are left out. */
  groups: readonly (readonly TaskMenuItem[])[]
  /** `refocus`: the keyboard goes back to the board. */
  onClose(refocus: boolean): void
}

export function TaskMenu({ at, label, groups, onClose }: Props) {
  const shown = groups.filter((group) => group.length > 0)
  const items = shown.flat()
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState(at)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = menu.current
    if (!el) return
    setPlace({ x: Math.max(EDGE, Math.min(at.x, window.innerWidth - EDGE - el.offsetWidth)), y: Math.max(EDGE, Math.min(at.y, window.innerHeight - EDGE - el.offsetHeight)) })
    el.focus({ preventScroll: true })
  }, [at])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose(false)
    }
    const away = (): void => onClose(false)
    const onWheel = (event: WheelEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('wheel', onWheel, true)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
    }
  }, [onClose])

  const pick = (item: TaskMenuItem): void => {
    // The keyboard goes back first: what the item opens may take it.
    onClose(true)
    item.run()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (index + step + items.length) % items.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const item = items[active]
      if (item) pick(item)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
    }
  }

  let index = -1
  return createPortal(
    <div
      ref={menu}
      className={styles.menu}
      style={{ left: place.x, top: place.y }}
      role="menu"
      aria-label={label}
      aria-activedescendant={items[active] ? `task-menu-${items[active].key}` : undefined}
      tabIndex={-1}
      data-testid="task-menu"
      data-no-pan=""
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {shown.map((group, g) => (
        <Fragment key={group[0]!.key}>
          {g > 0 && <div className={styles.separator} role="separator" />}
          {group.map((item) => {
            index++
            const at = index
            return (
              <div
                key={item.key}
                id={`task-menu-${item.key}`}
                role="menuitem"
                className={styles.item}
                data-active={at === active}
                data-danger={item.danger === true}
                onPointerMove={() => setActive(at)}
                onClick={() => pick(item)}
              >
                <span className={styles.label}>{item.label}</span>
                {item.shortcut && (
                  <span className={styles.shortcut} aria-hidden>
                    {item.shortcut}
                  </span>
                )}
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>,
    document.body
  )
}
