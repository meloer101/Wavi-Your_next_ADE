// The sheet's dropdown (Figma 15C Popover · 分支): glass like the sheet, an optional search field, grouped items with an
// icon and right-aligned meta, and a hint line. At least as wide as its control and as wide as its longest line, up to
// the window (PRD F9 v1.252: names are not cut off). Rendered into <body> under its anchor: a backdrop-filter inside the
// sheet would only see the sheet, not the window behind it. `align="selected"` (Figma 24A 智能体) puts the chosen item
// over the control like a macOS pop-up menu and keeps the whole menu on screen, so a long list need not scroll.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search } from '../ui/icons'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import styles from './NewSessionSheet.module.css'

export interface SheetMenuItem {
  value: string
  label: string
  icon: ReactNode
  meta?: string
  /** Listed but not choosable (Figma 81C: an agent that cannot lead here); its label is dimmed, its meta says why. */
  disabled?: boolean
}

export interface SheetMenuSection {
  title?: string
  items: SheetMenuItem[]
}

const M = defineMessages({ zh: { noBranches: '没有匹配的分支' }, en: { noBranches: 'No matching branches' } })

const GAP = 4
/** The menu is a little wider than its control (Figma: 446 under a 440 select). */
const OUTSET = 4
const MAX_HEIGHT = 360
const EDGE = 16

export function SheetMenu({
  anchor,
  label,
  sections,
  selected,
  search,
  hint,
  empty,
  align = 'below',
  onPick,
  onClose
}: {
  anchor: HTMLElement
  label: string
  /** Called with the current query; returns what to list. */
  sections: (query: string) => SheetMenuSection[]
  selected: string | null
  /** Placeholder of the search field; no field when absent. */
  search?: string
  hint?: string | null
  empty?: string
  align?: 'below' | 'selected'
  onPick: (value: string) => void
  onClose: (refocus: boolean) => void
}) {
  const m = useMessages(M)
  const [query, setQuery] = useState('')
  const listed = useMemo(() => sections(query), [sections, query])
  const flat = useMemo(() => listed.flatMap((section) => section.items), [listed])
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((item) => item.value === selected)))
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const top = rect.bottom + GAP
      setBox({ left: rect.left - OUTSET, top, width: rect.width + OUTSET * 2, maxHeight: Math.min(MAX_HEIGHT, window.innerHeight - top - EDGE) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  // Over the control: move the menu up by the chosen item's offset, then clamp it into the window.
  const placedOnce = box !== null
  useLayoutEffect(() => {
    if (align !== 'selected' || !placedOnce || !menu.current) return
    const rect = anchor.getBoundingClientRect()
    const option = menu.current.querySelector<HTMLElement>('[aria-selected="true"]')
    const height = menu.current.scrollHeight
    const offset = option ? option.getBoundingClientRect().top - menu.current.getBoundingClientRect().top + (option.offsetHeight - rect.height) / 2 : 0
    const room = window.innerHeight - EDGE * 2
    const top = Math.max(EDGE, Math.min(rect.top - offset, window.innerHeight - EDGE - Math.min(height, room)))
    setBox((now) => (now && now.top === top && now.maxHeight === room ? now : { left: rect.left - OUTSET, top, width: rect.width + OUTSET * 2, maxHeight: room }))
  }, [align, anchor, placedOnce])

  // The width follows the content: a menu wider than the room to the right of its control moves left to stay on screen.
  useLayoutEffect(() => {
    const el = menu.current
    if (!el || !box) return
    const left = Math.max(EDGE, Math.min(anchor.getBoundingClientRect().left - OUTSET, window.innerWidth - EDGE - el.offsetWidth))
    if (Math.abs(left - box.left) > 0.5) setBox({ ...box, left })
  }, [anchor, box, listed])

  // The menu renders once it is placed; then the keyboard goes to its search field (or list).
  const placed = box !== null
  useEffect(() => {
    if (placed) (field.current ?? list.current)?.focus({ preventScroll: true })
  }, [placed])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchor, onClose])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: KeyboardEvent): void => {
    // Keys of an input method composing in the search field are its own (Enter confirms, Esc cancels).
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(flat.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      const item = flat[active]
      if (item && !item.disabled) onPick(item.value)
    } else if (event.key === 'Tab') {
      onClose(false)
    }
  }

  if (!box) return null
  let index = -1
  return createPortal(
    <div
      ref={menu}
      className={styles.menu}
      style={{ left: box.left, top: box.top, width: 'max-content', minWidth: box.width, maxWidth: `calc(100vw - ${2 * EDGE}px)`, maxHeight: box.maxHeight }}
      onKeyDown={onKeyDown}
      data-new-session-menu
    >
      {search !== undefined && (
        <label className={styles.menuSearch}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={field}
            type="text"
            value={query}
            placeholder={search}
            spellCheck={false}
            autoComplete="off"
            aria-label={search}
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
          />
        </label>
      )}
      <div ref={list} id={listId} className={styles.menuList} role="listbox" aria-label={label} tabIndex={-1}>
        {listed.map((section, s) => (
          <Fragment key={section.title ?? s}>
            {s > 0 && !section.title && section.items.length > 0 && <div className={styles.menuSeparator} role="separator" />}
            {section.title && section.items.length > 0 && (
              <div className={styles.menuGroup} role="presentation">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              index++
              const at = index
              return (
                <div
                  key={item.value}
                  id={`${listId}-${at}`}
                  role="option"
                  aria-selected={item.value === selected}
                  data-index={at}
                  data-active={at === active}
                  aria-disabled={item.disabled === true ? true : undefined}
                  data-disabled={item.disabled === true}
                  className={styles.menuItem}
                  onPointerMove={() => setActive(at)}
                  onClick={() => !item.disabled && onPick(item.value)}
                >
                  <span className={styles.menuIcon}>{item.icon}</span>
                  <span className={styles.menuLabel}>{item.label}</span>
                  {item.meta && <span className={styles.menuMeta}>{item.meta}</span>}
                </div>
              )
            })}
          </Fragment>
        ))}
        {flat.length === 0 && <div className={styles.menuEmpty}>{empty ?? m.noBranches}</div>}
      </div>
      {/* A long hint wraps to the menu's width instead of widening it. */}
      {hint && (
        <p className={styles.menuHint} style={{ width: 0, minWidth: '100%' }}>
          {hint}
        </p>
      )}
    </div>,
    document.body
  )
}
