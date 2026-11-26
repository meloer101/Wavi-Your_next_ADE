// The members listed inside a board card (PRD v1.243, F9「主对话卡片的成员」, Figma 111F). Who is a member and how many
// there are comes from `groupsOf` (the sidebar's count); this only turns a group into the rows drawn.
import type { Session, SessionId, SessionStatus } from '@shared/types'
import { GROUP_STATUS_ORDER, type SessionGroup } from '@shared/session-group'
import { glyphStatus } from '../lifecycle/present'
import { sessionTime } from '../sidebar/format-elapsed'
import type { SideItem } from '../sidebar/model'

export interface MemberRow {
  /** Unique in the list. */
  key: string
  status: SessionStatus
  name: string
  /** A session's wait / run time, a subagent's or teammate's model, a workflow run's phase progress; '' when none. */
  meta: string
  /** 1 for a member of the card's session, 2 for a member of that member. */
  depth: number
  /** Set for a dispatched session: its row can be clicked. Subagents, teammates and workflow runs are display only. */
  sessionId?: SessionId
}

const rank = (status: SessionStatus): number => GROUP_STATUS_ORDER.indexOf(status)

/**
 * The rows under `ownerId`'s card: its direct members, most urgent status first (ties keep the group's order), each
 * dispatched session followed by its own members one step in.
 */
export function memberRows(input: {
  ownerId: SessionId
  groups: Readonly<Record<SessionId, SessionGroup>>
  sessions: ReadonlyMap<SessionId, Session>
  items: Readonly<Record<SessionId, readonly SideItem[]>>
  now: number
}): MemberRow[] {
  const { groups, sessions, items, now } = input
  const seen = new Set<SessionId>([input.ownerId])
  const level = (id: SessionId, depth: number): MemberRow[] => {
    const group = groups[id]
    if (!group) return []
    const sideItems = new Map((items[id] ?? []).map((item) => [item.id, item]))
    const mine: Array<{ status: SessionStatus; rows: () => MemberRow[] }> = []
    for (const childId of group.children) {
      const child = sessions.get(childId)
      if (!child || seen.has(childId)) continue
      seen.add(childId)
      const status = glyphStatus(child)
      mine.push({
        status,
        rows: () => [{ key: `session:${childId}`, status, name: child.title, meta: sessionTime(child, status, now, true).text, depth, sessionId: childId }, ...level(childId, depth + 1)]
      })
    }
    for (const member of group.items) {
      const item = sideItems.get(member.id)
      if (!item) continue
      mine.push({ status: member.status, rows: () => [{ key: `${id}:${member.id}`, status: member.status, name: item.title, meta: item.right ?? '', depth }] })
    }
    return mine.map((m, i) => ({ ...m, i })).sort((a, b) => rank(a.status) - rank(b.status) || a.i - b.i).flatMap((m) => m.rows())
  }
  return level(input.ownerId, 1)
}
