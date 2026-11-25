// Pure sidebar view-model: grouping, ordering and keyboard targets. No React, no store access.
import type { SubagentInfo } from '@shared/agent-events'
import type { Project, ProjectId, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { compareByUrgency, needsAttention, STATUS_LABEL, STATUS_ORDER } from '@shared/session-status'
import { rangeBetween, togglePicked } from '@shared/batch-actions'
import type { SidebarGroupBy } from '@shared/workspace-file'
import { defineMessages, pick } from '@shared/i18n'
import type { PendingRun } from '@shared/dispatch'
import { memberLine, TEAM_GLYPH, type TeamState } from '@shared/agent-team'
import { buildGroups, type GroupItem, type SessionGroup, type StatusCount } from '@shared/session-group'
import { glyphStatus, phaseLine } from '../lifecycle/present'
import { currentPhase, isLiveRun, phaseViews, runOutcome, type WorkflowPhaseView, type WorkflowRun } from '@shared/workflow-run'

const M = defineMessages({
  zh: {
    doneReply: (reply: string) => `已完成 · ${reply}`,
    doneUnread: '已完成 · 未读',
    snapshot: '快照',
    scheduled: (branch: string) => `定时 · ${branch}`,
    team: (n: number) => `队伍 · ${n} 人`,
    pending: '待开始'
  },
  en: {
    doneReply: (reply: string) => `Done · ${reply}`,
    doneUnread: 'Done · unread',
    snapshot: 'Snapshot',
    scheduled: (branch: string) => `Scheduled · ${branch}`,
    team: (n: number) => (n === 1 ? 'Team · 1 member' : `Team · ${n} members`),
    pending: 'Waiting to start'
  }
})

/**
 * A line hung under a session: a subagent (Figma 44B), a Claude workflow run and its phases (Figma 74D, PRD F25), or a
 * session it asked to start that waits for 开始 (Figma 83B). `glyph` and `right` are the run's and phases' own; a
 * subagent's glyph comes from its asks; a waiting one has a dashed ring instead.
 */
export interface SideItem extends SubagentInfo {
  kind?: 'workflow' | 'phase' | 'pending' | 'team' | 'teammate'
  glyph?: SessionStatus
  /** A teammate's second line (Figma 82′F): what it is doing or waits on you for. */
  detail?: string
  /** A teammate waiting on the user's answer (its ask is answered in the lead's terminal). */
  attention?: boolean
  /** Right-hand figure: a run's or phase's done / all. */
  right?: string
}

export interface SessionRowModel {
  session: Session
  /** The title drawn: a nested session named `<its parent's title> · Codex` (同任务多解) shows only `Codex`. */
  title: string
  /**
   * Second line: the agent's lifecycle or current action; once a turn is over, its last reply
   * (prefixed "已完成" while unread, so the state is never color-only). Empty before the first turn.
   */
  secondary: string
  /** Only `needs_you` recolors the secondary line (Figma SessionRow `attention`). */
  attention: boolean
  /** The worktree's branch: the row's third line, which ends in the agent's mark (Figma 34P). Empty outside git. */
  branch: string
  /** 1: started by a session above it through Wavi's `wavi run` (PRD F21), drawn one step in; 2: by one of those. */
  depth: 0 | 1 | 2
  /** The model `wavi run --model` asked for, before the agent mark on the branch line (Figma 44B); '' when none. */
  model: string
  /** Depth 2 under a child that is not its dispatcher's last: the top line runs on past this row (Figma 44B). */
  pass?: boolean
  /**
   * The line in the glyph column that ties a dispatcher to its children (Figma 40C): `parent` starts it under the
   * glyph, `child` carries it on with a tick to its glyph, `last` turns into its glyph and ends it.
   */
  tree?: 'parent' | 'child' | 'last'
  /** A dispatched session with subagents of its own: a second line starts under its glyph, one column in (Figma 44B). */
  opens?: boolean
  /** Subagent rows drawn right after this row (its own, then its dispatcher's when it is the last child). */
  after?: SubagentRowModel[]
  /** The fold row drawn right after this row, before its members (PRD v1.243); absent when the session has no members. */
  fold?: FoldRowModel
}

/**
 * The one row that stands for a session's members (PRD v1.243, Figma 111G / 111H): a chevron in the child glyph column,
 * `N 个成员`, then a glyph and a count per status over every member below, most urgent first. Not a session and no
 * keyboard target; a click opens or folds this session's group.
 */
export interface FoldRowModel {
  /** The session whose members it folds. */
  ownerId: SessionId
  expanded: boolean
  total: number
  counts: StatusCount[]
  /** 1 under a top-level session, 2 under a dispatched one: the glyph column it sits in. */
  depth: 1 | 2
  /** The owner's tree line runs down through this row, because rows with a tick follow. */
  line: boolean
  /** Depth 2: the dispatcher's line runs on past this row. */
  pass: boolean
}

export const sameFold = (a: FoldRowModel | undefined, b: FoldRowModel | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.ownerId === b.ownerId &&
    a.expanded === b.expanded &&
    a.total === b.total &&
    a.depth === b.depth &&
    a.line === b.line &&
    a.pass === b.pass &&
    a.counts.length === b.counts.length &&
    a.counts.every((c, i) => c.status === b.counts[i]!.status && c.count === b.counts[i]!.count))

/**
 * A subagent the session's agent started itself (Claude's Agent tool; PRD F21 v1.109, Figma 44B): one line, under its
 * session and after the sessions it dispatched. Display only — it is not a session and no keyboard target.
 */
export interface SubagentRowModel {
  /** The session it runs in; a click selects that session. */
  sessionId: SessionId
  /** Claude's `agent_id`. */
  id: string
  title: string
  /** Display name of its model; '' until known. */
  model: string
  /** Its ask is pending (PermissionRequest / AskUserQuestion with its `agent_id`). */
  attention: boolean
  /** 1 under a top-level session, 2 under a dispatched one. */
  depth: 1 | 2
  tree: 'child' | 'last'
  /** Depth 2: its session is not the last of its dispatcher's line, so that line runs on past this row. */
  pass: boolean
  /**
   * A workflow run's row, one of its phases (Figma 74D), a session waiting for 开始 (Figma 83B), or the session's agent
   * team — its 队伍 · N 人 line and a row per teammate (Figma 82′F); absent for a subagent.
   */
  kind?: 'workflow' | 'phase' | 'pending' | 'team' | 'teammate'
  glyph?: SessionStatus
  detail?: string
  right?: string
}

export interface SidebarGroup {
  /** A project's id, or `status:<status>` in the 按状态 view. */
  id: string
  /** `project`: a project and its sessions (default). `status`: every listed session with one status (PRD §3.3, Figma 53C). */
  kind: 'project' | 'status'
  /** The status a `status` group holds. */
  status?: SessionStatus
  title: string
  /** Rows drawn under the header; empty while the project is collapsed. */
  rows: SessionRowModel[]
  /** All of the project's sessions, drawn or not. */
  sessionCount: number
  collapsed: boolean
  /** Most urgent status among sessions that need attention (null when none) — the hint on a collapsed header. */
  attention: SessionStatus | null
}

export interface SidebarInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  collapsedProjectIds?: readonly ProjectId[]
  /** Running subagents per session (session-meta); none when absent. */
  subagents?: Readonly<Record<SessionId, readonly SideItem[] | undefined>>
  /** Absent = by project. */
  groupBy?: SidebarGroupBy
  collapsedStatusGroups?: readonly SessionStatus[]
  /** Each project's leader session (PRD F21 v1.198): its branch line reads `leader · <branch>` (Figma 81A). */
  leaderSessions?: Readonly<Record<ProjectId, SessionId | undefined>>
  /** Sessions whose members are drawn under them (PRD v1.243); every other session's members are folded into one row. */
  expandedGroups?: readonly SessionId[]
}

/** What a finished turn left: "已完成 · <reply>" while unread, the reply once seen. */
function afterTurn(session: Session): string | undefined {
  if (session.status === 'done_unread') return session.lastReply ? pick(M).doneReply(session.lastReply) : pick(M).doneUnread
  if (session.status === 'idle') return session.lastReply
  return undefined
}

/** `Cookie 会话迁移 · Codex` under `Cookie 会话迁移` reads `Codex`: the indent already says whose it is. */
export function nestedTitle(title: string, parentTitle: string | undefined): string {
  const prefix = parentTitle ? `${parentTitle} · ` : ''
  return prefix && title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : title
}

function toRow(session: Session, worktree: Worktree | undefined, { depth, parentTitle, tree, opens, after, pass, fold }: NestedRow, leader = false): SessionRowModel {
  // The project header already says which folder this is; the branch has its own line (Figma 34P).
  const branch = session.dispatchBase === 'snapshot' ? pick(M).snapshot : session.scheduledBy ? pick(M).scheduled(worktree?.branch ?? '') : (worktree?.branch ?? '')
  return {
    session,
    title: depth > 0 ? nestedTitle(session.title, parentTitle) : session.title,
    secondary: phaseLine(session) ?? session.currentAction ?? afterTurn(session) ?? '',
    attention: session.status === 'needs_you',
    // A snapshot has no branch (detached): its line says so instead; a leader's says it leads.
    branch: leader ? (branch ? `leader · ${branch}` : 'leader') : branch,
    depth,
    model: session.dispatchModel ?? '',
    tree,
    ...(pass ? { pass } : {}),
    ...(opens ? { opens } : {}),
    ...(after ? { after } : {}),
    ...(fold ? { fold } : {})
  }
}

export const sameSubagent = (a: SubagentRowModel, b: SubagentRowModel): boolean =>
  a.id === b.id &&
  a.title === b.title &&
  a.model === b.model &&
  a.attention === b.attention &&
  a.depth === b.depth &&
  a.tree === b.tree &&
  a.pass === b.pass &&
  a.kind === b.kind &&
  a.glyph === b.glyph &&
  a.right === b.right &&
  a.detail === b.detail

/**
 * Whether two models draw the same row (its `after` rows are drawn by SubagentRow, which compares them itself). buildSidebarGroups makes new ones on every store change (an agent's hook event
 * touches one session), so SessionRow compares these instead of the object to redraw only the row that changed.
 */
export function sameRow(a: SessionRowModel, b: SessionRowModel): boolean {
  return (
    a.session === b.session &&
    a.title === b.title &&
    a.secondary === b.secondary &&
    a.attention === b.attention &&
    a.branch === b.branch &&
    a.depth === b.depth &&
    a.tree === b.tree &&
    a.opens === b.opens &&
    a.pass === b.pass &&
    sameFold(a.fold, b.fold)
  )
}

export interface NestedRow {
  session: Session
  depth: 0 | 1 | 2
  pass?: boolean
  parentTitle?: string
  tree?: SessionRowModel['tree']
  opens?: boolean
  after?: SubagentRowModel[]
  fold?: FoldRowModel
}

type SubagentsOf = (id: SessionId) => readonly SideItem[]
const NO_SUBAGENTS: SubagentsOf = () => []
const NO_EXPANDED: ReadonlySet<SessionId> = new Set()

function subagentRows(session: Session, items: readonly SideItem[], depth: 1 | 2, pass: boolean): SubagentRowModel[] {
  return items.map((item, i) => ({
    sessionId: session.id,
    id: item.id,
    title: item.title,
    model: item.model ?? '',
    attention: item.attention ?? (!item.kind && (session.askingAgents?.includes(item.id) ?? false)),
    depth,
    tree: i === items.length - 1 ? 'last' : 'child',
    pass: depth === 2 && pass,
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.glyph ? { glyph: item.glyph } : {}),
    ...(item.right !== undefined ? { right: item.right } : {}),
    ...(item.detail !== undefined ? { detail: item.detail } : {})
  }))
}

/** A run's or phase's state as a session glyph (status is never colour only: each has its own shape). */
const RUN_GLYPH: Readonly<Record<ReturnType<typeof runOutcome>, SessionStatus>> = {
  running: 'running',
  paused: 'idle',
  completed: 'done_unread',
  'partly-failed': 'error',
  failed: 'error',
  stopped: 'exited'
}
const PHASE_GLYPH: Readonly<Record<WorkflowPhaseView['state'], SessionStatus>> = {
  pending: 'idle',
  running: 'running',
  paused: 'idle',
  done: 'done_unread',
  error: 'error',
  stopped: 'exited'
}

/**
 * Figma 74D: a session's workflow runs under it — a row per run (state · name · the current phase's done / all) and,
 * unless folded, a row per phase. A run that ended stays while the session's turn is unread (the user has not looked
 * yet), then goes. Its agents are not listed one by one.
 */
export function workflowItems(runs: readonly WorkflowRun[], { unread, folded }: { unread: boolean; folded: ReadonlySet<string> }): SideItem[] {
  const items: SideItem[] = []
  for (const run of runs) {
    if (!isLiveRun(run) && !unread) continue
    const views = phaseViews(run, 0)
    const at = isLiveRun(run) ? currentPhase(views) : undefined
    const done = run.agents.filter((a) => a.state === 'done').length
    items.push({ id: `workflow:${run.key}`, title: run.name, kind: 'workflow', glyph: RUN_GLYPH[runOutcome(run)], right: at ? `${at.done} / ${at.total}` : `${done} / ${run.agents.length}` })
    if (folded.has(run.key)) continue
    views.forEach((phase, i) =>
      items.push({ id: `phase:${run.key}:${i}`, title: phase.title, kind: 'phase', glyph: PHASE_GLYPH[phase.state], right: phase.total > 0 ? `${phase.done} / ${phase.total}` : '—' })
    )
  }
  return items
}

/**
 * Figma 82′F: Claude's agent team under its lead — a 队伍 · N 人 line, then a row per teammate (name · model / what it
 * is doing). Peers, so no tree line ties them; the lead's own lane is the session row itself.
 */
export function teamItems(team: TeamState | undefined): SideItem[] {
  const mates = team?.members.filter((m) => m.agentId) ?? []
  if (mates.length === 0) return []
  return [
    { id: 'team', title: pick(M).team(mates.length), kind: 'team' },
    ...mates.map((m): SideItem => ({
      id: `teammate:${m.agentId}`,
      title: m.name,
      kind: 'teammate',
      glyph: TEAM_GLYPH[m.state],
      ...(m.model ? { right: m.model } : {}),
      detail: memberLine(m),
      attention: m.state === 'asking'
    }))
  ]
}

/**
 * Figma 83B: each `wavi run` waiting for 开始, as a line under the session that asked (after the sessions it already
 * started), in the order they were asked. They go when the user answers: 开始 makes them real child rows, 拒绝 drops them.
 * A leader's `wavi adopt` is not one: the session it would take over already has its own row.
 */
export function pendingItems(confirms: ReadonlyArray<Pick<PendingRun, 'childId' | 'parentId' | 'plan'>>): Record<SessionId, SideItem[]> {
  const out: Record<SessionId, SideItem[]> = {}
  for (const c of confirms) (out[c.parentId] ??= []).push({ id: `pending:${c.childId}`, title: c.plan.item.title, kind: 'pending', right: pick(M).pending })
  return out
}

/**
 * The members of a session that are not sessions (PRD v1.243): a subagent, a teammate, a workflow run. Phases, the team's
 * heading line and `wavi run` confirms waiting for 开始 are not members: the first two belong to a member, the last
 * stays visible under the session that asked.
 */
export function memberItems(session: Pick<Session, 'askingAgents'>, items: readonly SideItem[]): GroupItem[] {
  return items.flatMap((item): GroupItem[] => {
    if (item.kind === 'phase' || item.kind === 'team' || item.kind === 'pending') return []
    const asking = item.attention ?? (!item.kind && (session.askingAgents?.includes(item.id) ?? false))
    return [{ id: item.id, status: item.glyph ?? (asking ? 'needs_you' : 'running') }]
  })
}

/** What stays drawn under a session whose group is folded: the confirms waiting for 开始. */
const shownItems = (items: readonly SideItem[], open: boolean): SideItem[] => (open ? [...items] : items.filter((item) => item.kind === 'pending'))

/**
 * Every session's lines that are not sessions (PRD v1.243 members, plus a team's heading and a run's phases): its team,
 * then its workflow runs, then its subagents — the order the sidebar draws them. The board and the phone build their
 * groups from the same lines, so all three count the same members. `folded`: workflow runs whose phases are folded.
 */
export function sideItemsOf(input: {
  sessions: readonly Pick<Session, 'id' | 'status'>[]
  subagents: Readonly<Record<SessionId, readonly SubagentInfo[]>>
  runs: Readonly<Record<SessionId, readonly WorkflowRun[]>>
  teams: Readonly<Record<SessionId, TeamState>>
  folded?: ReadonlySet<string>
}): Record<SessionId, SideItem[]> {
  const { sessions, subagents, runs, teams, folded = new Set<string>() } = input
  const out: Record<SessionId, SideItem[]> = {}
  for (const [id, list] of Object.entries(subagents)) out[id] = [...list]
  for (const [id, list] of Object.entries(runs)) {
    const unread = sessions.find((s) => s.id === id)?.status === 'done_unread'
    const lines = workflowItems(list, { unread, folded })
    if (lines.length > 0) out[id] = [...lines, ...(subagents[id] ?? [])]
  }
  for (const [id, team] of Object.entries(teams)) {
    const lines = teamItems(team)
    if (lines.length > 0) out[id] = [...lines, ...(out[id] ?? [])]
  }
  return out
}

/** The collaboration group of every session that has members (PRD v1.243), as the sidebar counts it. */
export function groupsOf(sessions: readonly Session[], items: Readonly<Record<SessionId, readonly SideItem[]>>): Record<SessionId, SessionGroup> {
  return buildGroups(
    sessions.map((s) => ({ id: s.id, status: glyphStatus(s), ...(s.dispatchedBy ? { dispatchedBy: s.dispatchedBy } : {}) })),
    Object.fromEntries(sessions.map((s) => [s.id, memberItems(s, items[s.id] ?? [])]))
  )
}

/**
 * Store order, except that a dispatched session follows the session that started it (PRD F21), after that session's
 * earlier children, and a grandchild follows its own dispatcher the same way, one more step in. A child whose
 * dispatcher is not listed here stays where it is, at the top level. Subagents (Figma 44B) hang under their session
 * after the sessions it dispatched: a child's after its grandchildren, a top-level session's after everything below it.
 * Members are folded into the session's fold row (PRD v1.243) unless its id is in `expanded`; a member's own members
 * are folded the same way, one level in. Confirms waiting for 开始 are drawn either way.
 */
export function withChildrenNested(sessions: readonly Session[], allOf: SubagentsOf = NO_SUBAGENTS, expanded: ReadonlySet<SessionId> = NO_EXPANDED): NestedRow[] {
  // A team's rows (Figma 82′F) hang under their lead without a tree line: they go after its tree, outside of it.
  const subagentsOf = (items: readonly SideItem[]): SideItem[] => items.filter((item) => !isPeer(item))
  const peersOf = (items: readonly SideItem[]): SideItem[] => items.filter(isPeer)
  const listed = new Set(sessions.map((s) => s.id))
  const nested = (s: Session): boolean => s.dispatchedBy !== undefined && listed.has(s.dispatchedBy)
  const childrenOf = (id: SessionId): Session[] => sessions.filter((child) => child.dispatchedBy === id && nested(child))
  const groups = groupsOf(sessions, Object.fromEntries(sessions.map((s) => [s.id, allOf(s.id)])))
  const foldOf = (id: SessionId, depth: 1 | 2, open: boolean, line: boolean, pass: boolean): FoldRowModel | undefined => {
    const g = groups[id]
    return g ? { ownerId: id, expanded: open, total: g.total, counts: g.counts, depth, line, pass } : undefined
  }
  const out: NestedRow[] = []
  for (const session of sessions) {
    if (nested(session)) continue
    const open = !groups[session.id] || expanded.has(session.id)
    const children = open ? childrenOf(session.id) : []
    const items = shownItems(allOf(session.id), open)
    const own = subagentsOf(items)
    const peers = peersOf(items)
    const below = children.length + own.length > 0
    const top: NestedRow = { session, depth: 0, ...(below ? { tree: 'parent' as const } : {}) }
    const fold = foldOf(session.id, 1, open, below, false)
    if (fold) top.fold = fold
    out.push(top)
    let last = top
    children.forEach((child, i) => {
      // The dispatcher's line runs on below this child while another child or one of its own subagents follows.
      const more = i < children.length - 1 || own.length > 0
      const childOpen = !groups[child.id] || expanded.has(child.id)
      const grandchildren = childOpen ? childrenOf(child.id) : []
      const childItems = shownItems(allOf(child.id), childOpen)
      const subs = subagentRows(child, subagentsOf(childItems), 2, more)
      const opens = grandchildren.length + subs.length > 0
      const host: NestedRow = { session: child, depth: 1, parentTitle: session.title, tree: more ? 'child' : 'last', ...(opens ? { opens: true } : {}) }
      const childFold = foldOf(child.id, 2, childOpen, opens, more)
      if (childFold) host.fold = childFold
      out.push(host)
      last = host
      grandchildren.forEach((grandchild, j) => {
        const row: NestedRow = { session: grandchild, depth: 2, parentTitle: child.title, tree: j < grandchildren.length - 1 || subs.length > 0 ? 'child' : 'last', ...(more ? { pass: true } : {}) }
        out.push(row)
        last = row
      })
      const childPeers = subagentRows(child, peersOf(childItems), 2, more)
      if (subs.length + childPeers.length > 0) last.after = [...subs, ...childPeers]
    })
    if (own.length > 0) last.after = [...(last.after ?? []), ...subagentRows(session, own, 1, false)]
    if (peers.length > 0) last.after = [...(last.after ?? []), ...subagentRows(session, peers, 1, false)]
  }
  return out
}

const isPeer = (item: SideItem): boolean => item.kind === 'team' || item.kind === 'teammate'

/** The listed sessions of a project, in store order. Archived worktrees (PRD F15) are folded away until ⌘K 历史 brings them back. */
function sessionsOf(project: Project, sessions: readonly Session[], worktreeById: ReadonlyMap<string, Worktree>): Session[] {
  return sessions.filter((s) => {
    const worktree = worktreeById.get(s.worktreeId)
    return worktree?.projectId === project.id && !worktree.archived
  })
}

/**
 * Groups sessions for the sidebar. By default strictly by place (PRD §3.3): a session always stays under its
 * project, whatever its status. Projects keep store order and sessions keep store order within a project. Every
 * project is listed, even with no sessions, so it always offers "新建会话". A collapsed project draws no rows; its
 * header carries the most urgent attention status instead. With `groupBy: 'status'` see buildStatusGroups.
 */
export function buildSidebarGroups(input: SidebarInput): SidebarGroup[] {
  if (input.groupBy === 'status') return buildStatusGroups(input)
  const { projects, worktrees, sessions, collapsedProjectIds = [], subagents, leaderSessions = {}, expandedGroups = [] } = input
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const subagentsOf: SubagentsOf = subagents ? (id) => subagents[id] ?? [] : NO_SUBAGENTS
  const collapsed = new Set(collapsedProjectIds)
  const expanded = new Set(expandedGroups)
  return projects.map((project) => {
    const own = sessionsOf(project, sessions, worktreeById)
    const urgent = own.filter((s) => needsAttention(s.status)).sort(compareByUrgency)[0]
    const isCollapsed = collapsed.has(project.id)
    return {
      id: project.id,
      kind: 'project',
      title: project.name,
      rows: isCollapsed
        ? []
        : withChildrenNested(own, subagentsOf, expanded).map((nested) =>
            toRow(nested.session, worktreeById.get(nested.session.worktreeId), nested, leaderSessions[project.id] === nested.session.id)
          ),
      sessionCount: own.length,
      collapsed: isCollapsed,
      attention: urgent?.status ?? null
    }
  })
}

/**
 * The sidebar's 按状态 view (PRD §3.3, Figma 53C): one group per status, most urgent first (等你处理 → 出错 → 已完成 →
 * 运行中 → 空闲 → 已退出); a status no listed session has is not drawn. Within a group, sessions keep the 按项目 order
 * (projects, then store order), so a row only moves when its status does. Rows are flat — a dispatched session goes to
 * its own status's group — and their last line reads `<project> › <branch>`. A session's own subagents, team and workflow runs fold under it.
 */
export function buildStatusGroups({ projects, worktrees, sessions, collapsedStatusGroups = [], subagents, leaderSessions = {}, expandedGroups = [] }: SidebarInput): SidebarGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const listed = projects.flatMap((project) => sessionsOf(project, sessions, worktreeById).map((session) => ({ session, project })))
  const collapsed = new Set(collapsedStatusGroups)
  const expanded = new Set(expandedGroups)
  // Child sessions are rows of their own here, so only a session's own subagents, team and runs fold under it.
  const groupOf = buildGroups(
    listed.map(({ session }) => ({ id: session.id, status: glyphStatus(session) })),
    Object.fromEntries(listed.map(({ session }) => [session.id, memberItems(session, subagents?.[session.id] ?? [])]))
  )
  return STATUS_ORDER.flatMap((status): SidebarGroup[] => {
    const own = listed.filter(({ session }) => session.status === status)
    if (own.length === 0) return []
    const isCollapsed = collapsed.has(status)
    return [
      {
        id: `status:${status}`,
        kind: 'status',
        status,
        title: STATUS_LABEL[status],
        rows: isCollapsed
          ? []
          : own.map(({ session, project }) => {
              const worktree = worktreeById.get(session.worktreeId)
              const all = subagents?.[session.id] ?? []
              const g = groupOf[session.id]
              const open = !g || expanded.has(session.id)
              const subs = shownItems(all, open)
              const fold: FoldRowModel | undefined = g && { ownerId: session.id, expanded: open, total: g.total, counts: g.counts, depth: 1, line: subs.length > 0, pass: false }
              const row = toRow(
                session,
                worktree,
                {
                  session,
                  depth: 0,
                  ...(subs.length > 0 ? { tree: 'parent' as const, after: subagentRows(session, subs, 1, false) } : {}),
                  ...(fold ? { fold } : {})
                },
                leaderSessions[project.id] === session.id
              )
              return { ...row, branch: row.branch ? `${project.name} › ${row.branch}` : project.name }
            }),
        sessionCount: own.length,
        collapsed: isCollapsed,
        // The header already names the status (Figma 53C): no hint glyph when folded.
        attention: null
      }
    ]
  })
}

/** The rows split at each top-level session: it and everything drawn under it (its fold row, members, subagents). */
export function topLevelChunks(rows: readonly SessionRowModel[]): SessionRowModel[][] {
  const out: SessionRowModel[][] = []
  for (const row of rows) {
    if (row.depth === 0 || out.length === 0) out.push([row])
    else out[out.length - 1]!.push(row)
  }
  return out
}

/** Session ids in the order they appear on screen. */
export function visibleSessionIds(groups: SidebarGroup[]): SessionId[] {
  return groups.flatMap((g) => g.rows.map((r) => r.session.id))
}

/**
 * ⇧ / ⌘ click on a session row (the overview's F9 picking, in the sidebar): ⇧ adds every row between the anchor and
 * the clicked one in drawn order, across groups; ⌘ toggles one. The row the user is in counts as picked when picking
 * starts, as a selection does in Finder. Returned in drawn order; ids no longer drawn drop out.
 */
export function pickSessions(input: {
  ordered: readonly SessionId[]
  picked: readonly SessionId[]
  /** Where a ⇧ range starts: the last row clicked; the active session until one was. */
  anchor: SessionId | null
  active: SessionId | null
  id: SessionId
  how: 'range' | 'toggle'
}): SessionId[] {
  const { ordered, anchor, active, id, how } = input
  const drawn = (x: SessionId | null): x is SessionId => x !== null && ordered.includes(x)
  const start = input.picked.filter(drawn)
  if (start.length === 0 && drawn(active) && active !== id) start.push(active)
  const next =
    how === 'range'
      ? [...start, ...rangeBetween(ordered, drawn(anchor) ? anchor : drawn(active) ? active : null, id)]
      : togglePicked(start, id)
  const set = new Set(next)
  return ordered.filter((x) => set.has(x))
}

/** ⌘1–⌘9: the nth visible session (1-based), or null when there are fewer. */
export function sessionForShortcut(groups: SidebarGroup[], n: number): SessionId | null {
  if (!Number.isInteger(n) || n < 1 || n > 9) return null
  return visibleSessionIds(groups)[n - 1] ?? null
}

/**
 * ⌘J: the next session needing attention after `activeId`, most urgent first, wrapping around — across all
 * projects, collapsed ones included. Null when none.
 */
export function nextAttentionSessionId(sessions: Session[], activeId: SessionId | null): SessionId | null {
  const queue = sessions.filter((s) => needsAttention(s.status)).sort(compareByUrgency).map((s) => s.id)
  if (queue.length === 0) return null
  const at = activeId === null ? -1 : queue.indexOf(activeId)
  return queue[(at + 1) % queue.length] ?? null
}

/**
 * ↑/↓: neighbouring visible session, clamped at the ends. With no current row, down picks the first, up the last. A
 * current session that is hidden in a folded group (`above`: the sessions that dispatched it, nearest first) starts
 * from its nearest visible dispatcher.
 */
export function adjacentSessionId(
  groups: SidebarGroup[],
  currentId: SessionId | null,
  direction: 1 | -1,
  above: readonly SessionId[] = []
): SessionId | null {
  const ids = visibleSessionIds(groups)
  if (ids.length === 0) return null
  const from = currentId !== null && !ids.includes(currentId) ? (above.find((id) => ids.includes(id)) ?? currentId) : currentId
  const at = from === null ? -1 : ids.indexOf(from)
  if (at === -1) return (direction === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, at + direction))] ?? null
}
