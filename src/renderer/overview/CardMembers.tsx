// A board card's members (PRD v1.243, Figma 111E / 111F): under a hairline one summary line — chevron, `N 个成员`, a
// glyph and a count per status — and, once opened, a row per member. Open or folded is the sidebar's own `expandedGroups`.
import { createContext, memo, useContext, useMemo, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SubagentInfo } from '@shared/agent-events'
import type { TeamState } from '@shared/agent-team'
import { defineMessages } from '@shared/i18n'
import type { SessionGroup } from '@shared/session-group'
import type { Session, SessionId } from '@shared/types'
import type { WorkflowRun } from '@shared/workflow-run'
import { useSessionMeta } from '../session-meta/store'
import { groupsOf, sideItemsOf, type SideItem } from '../sidebar/model'
import { useWorkspace } from '../state/workspace'
import { ChevronDown, ChevronRight } from '../ui/icons'
import { useLang, useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import { memberRows } from './members'
import styles from './CardMembers.module.css'

const M = defineMessages({
  zh: { members: (n: number) => `${n} 个成员`, list: '成员' },
  en: { members: (n: number) => (n === 1 ? '1 member' : `${n} members`), list: 'Members' }
})

interface BoardMembers {
  groups: Readonly<Record<SessionId, SessionGroup>>
  items: Readonly<Record<SessionId, readonly SideItem[]>>
  byId: ReadonlyMap<SessionId, Session>
  expanded: readonly SessionId[]
  toggle(id: SessionId): void
  /** Sessions that have a card on the board now: only their rows can be clicked. */
  onBoard: ReadonlySet<SessionId>
  /** Clicks a member's row like its own card. */
  open(id: SessionId, e: MouseEvent): void
  /** Hands the keyboard back to the board, as a card click does: a focused button would swallow ↵ / Space. */
  focusBoard(): void
}

export const MembersContext = createContext<BoardMembers | null>(null)
/** The shared clock, read only by the lists that are open, so a tick re-renders no folded card. */
export const MembersNowContext = createContext(0)

/** The groups of `sessions` as the sidebar counts them, with the lines they are drawn from (subagents, runs, teams). */
export function useBoardMembers(sessions: readonly Session[]): Pick<BoardMembers, 'groups' | 'items' | 'byId' | 'expanded' | 'toggle'> {
  const lang = useLang()
  const { expanded, toggle } = useWorkspace(useShallow((s) => ({ expanded: s.expandedGroups, toggle: s.toggleGroupExpanded })))
  const subagents = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, SubagentInfo[]> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.subagents) out[id] = metrics.subagents
      return out
    })
  )
  const runs = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, WorkflowRun[]> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.workflows) out[id] = metrics.workflows
      return out
    })
  )
  const teams = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, TeamState> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.team) out[id] = metrics.team
      return out
    })
  )
  const items = useMemo(
    () => sideItemsOf({ sessions, subagents, runs, teams }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang: the lines' text follows the interface language
    [sessions, subagents, runs, teams, lang]
  )
  const groups = useMemo(() => groupsOf(sessions, items), [sessions, items])
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  return useMemo(() => ({ groups, items, byId, expanded, toggle }), [groups, items, byId, expanded, toggle])
}

/** Nothing for a session without members. A click here is the members' own: it opens no card and selects nothing. */
export const CardMembers = memo(function CardMembers({ sessionId }: { sessionId: SessionId }) {
  const ctx = useContext(MembersContext)
  const m = useMessages(M)
  const group = ctx?.groups[sessionId]
  const open = ctx?.expanded.includes(sessionId) ?? false
  if (!ctx || !group) return null
  return (
    <div className={styles.members} data-testid="card-members" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className={styles.summary} data-testid="card-members-toggle" aria-expanded={open} onClick={() => {
          ctx.toggle(sessionId)
          ctx.focusBoard()
        }}>
        <span className={styles.chevron}>{open ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}</span>
        <span className={styles.label}>{m.members(group.total)}</span>
        <span className={styles.counts}>
          {group.counts.map((c) => (
            <span key={c.status} className={styles.count} data-status={c.status}>
              <StatusGlyph status={c.status} />
              {c.count}
            </span>
          ))}
        </span>
      </button>
      {open && <MemberList ownerId={sessionId} ctx={ctx} />}
    </div>
  )
})

/** The rows of an open card; the only part that follows the clock. */
function MemberList({ ownerId, ctx }: { ownerId: SessionId; ctx: BoardMembers }) {
  const m = useMessages(M)
  const now = useContext(MembersNowContext)
  const rows = useMemo(() => memberRows({ ownerId, groups: ctx.groups, sessions: ctx.byId, items: ctx.items, now }), [ownerId, ctx.groups, ctx.byId, ctx.items, now])
  return (
    <ul className={styles.list} aria-label={m.list}>
      {rows.map((row) => {
        const body = (
          <>
            <StatusGlyph status={row.status} />
            <span className={styles.name}>{row.name}</span>
            {row.meta && <span className={styles.meta}>{row.meta}</span>}
          </>
        )
        const target = row.sessionId
        return (
          <li key={row.key} data-depth={row.depth} data-member-session={target}>
            {target && ctx.onBoard.has(target) ? (
              <button type="button" className={styles.row} onClick={(e) => ctx.open(target, e)}>
                {body}
              </button>
            ) : (
              <span className={styles.row}>{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
