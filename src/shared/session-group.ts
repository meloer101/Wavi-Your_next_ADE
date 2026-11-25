// Collaboration groups (PRD v1.243): a session's members — the sessions it dispatched (`dispatchedBy`), its agent's own
// subagents, an agent team's teammates and workflow runs — are folded into one row under it. This is the one place that
// decides who is a member and how the row counts them; the sidebar, the board and the phone draw what it returns.
import type { SessionId, SessionStatus } from './types'

/** The part of a session a group needs. `status` is the glyph's status (a starting agent counts as running). */
export interface GroupSession {
  id: SessionId
  status: SessionStatus
  dispatchedBy?: SessionId | undefined
}

/** A member that is not a session: a subagent, a teammate or a workflow run. Phases, team headings and pending confirms are not members. */
export interface GroupItem {
  id: string
  status: SessionStatus
}

export interface StatusCount {
  status: SessionStatus
  count: number
}

export interface SessionGroup {
  /** Direct member sessions, in the order the sessions were given. */
  children: SessionId[]
  /** Direct members that are not sessions, in the order given. */
  items: GroupItem[]
  /** Members at any depth. The count on the fold row; equals the sum of `counts`. */
  total: number
  /** Members at any depth by status, most urgent first (see GROUP_STATUS_ORDER); statuses with none are left out. */
  counts: StatusCount[]
}

/** The fold row's order: needs you → error → working → done → idle → exited. */
export const GROUP_STATUS_ORDER: readonly SessionStatus[] = ['needs_you', 'error', 'running', 'done_unread', 'idle', 'exited']

/**
 * The group of every session that has members. A session whose dispatcher is not in `sessions` has no parent here, so
 * it is no member (it stays top level). A dispatch cycle is cut where it closes.
 */
export function buildGroups(sessions: readonly GroupSession[], itemsOf: Readonly<Record<SessionId, readonly GroupItem[] | undefined>> = {}): Record<SessionId, SessionGroup> {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const childrenOf = new Map<SessionId, GroupSession[]>()
  for (const s of sessions) {
    if (s.dispatchedBy === undefined || s.dispatchedBy === s.id || !byId.has(s.dispatchedBy)) continue
    const list = childrenOf.get(s.dispatchedBy) ?? []
    list.push(s)
    childrenOf.set(s.dispatchedBy, list)
  }
  const out: Record<SessionId, SessionGroup> = {}
  for (const session of sessions) {
    const children = childrenOf.get(session.id) ?? []
    const items = itemsOf[session.id] ?? []
    if (children.length + items.length === 0) continue
    const tally = new Map<SessionStatus, number>()
    const seen = new Set<SessionId>([session.id])
    const visit = (id: SessionId): void => {
      for (const item of itemsOf[id] ?? []) tally.set(item.status, (tally.get(item.status) ?? 0) + 1)
      for (const child of childrenOf.get(id) ?? []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        tally.set(child.status, (tally.get(child.status) ?? 0) + 1)
        visit(child.id)
      }
    }
    visit(session.id)
    const counts = GROUP_STATUS_ORDER.flatMap((status): StatusCount[] => (tally.has(status) ? [{ status, count: tally.get(status)! }] : []))
    out[session.id] = { children: children.filter((c) => seen.has(c.id)).map((c) => c.id), items: [...items], total: counts.reduce((n, c) => n + c.count, 0), counts }
  }
  return out
}

/** The sessions above `id`, nearest first: who dispatched it, who dispatched that, … Only sessions in `sessions` count. */
export function dispatchAncestors(sessions: readonly Pick<GroupSession, 'id' | 'dispatchedBy'>[], id: SessionId): SessionId[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const out: SessionId[] = []
  for (let at = byId.get(id)?.dispatchedBy; at !== undefined && byId.has(at) && at !== id && !out.includes(at); at = byId.get(at)?.dispatchedBy) out.push(at)
  return out
}
