import { memo } from 'react'
import { defineMessages } from '@shared/i18n'
import type { SessionId } from '@shared/types'
import { ChevronDown, ChevronRight } from '../ui/icons'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import { sameFold, type FoldRowModel } from './model'
import styles from './FoldRow.module.css'

const M = defineMessages({
  zh: { members: (n: number) => `${n} 个成员` },
  en: { members: (n: number) => (n === 1 ? '1 member' : `${n} members`) }
})

interface Props {
  row: FoldRowModel
  /** Opens or folds the group of the session that owns it; selects nothing. */
  onToggle(id: SessionId): void
}

/**
 * Figma 111G / 111H: the one row that stands for a session's members — chevron in the child glyph column, `N 个成员`,
 * then a small status glyph and count per status, most urgent first. A button, not a session: no keyboard target of the
 * ↑ / ↓ walk, and a click selects nothing.
 */
export const FoldRow = memo(
  function FoldRow({ row, onToggle }: Props) {
    const m = useMessages(M)
    return (
      <button
        type="button"
        className={styles.row}
        data-testid="fold-row"
        data-group-owner={row.ownerId}
        data-depth={row.depth}
        data-line={row.line}
        data-pass={row.pass}
        aria-expanded={row.expanded}
        onClick={() => onToggle(row.ownerId)}
      >
        <span className={styles.chevron}>{row.expanded ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}</span>
        <span className={styles.label}>{m.members(row.total)}</span>
        <span className={styles.counts}>
          {row.counts.map((c) => (
            <span key={c.status} className={styles.count} data-status={c.status}>
              <StatusGlyph status={c.status} />
              {c.count}
            </span>
          ))}
        </span>
      </button>
    )
  },
  (a, b) => sameFold(a.row, b.row) && a.onToggle === b.onToggle
)
