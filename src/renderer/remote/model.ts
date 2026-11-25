// What the window tells main about its sessions for the phone (PRD F22, Figma 45B): every project (new sessions start
// in one), the agent sessions of worktrees that are not archived with what the phone list shows, and for main only each
// session's folder and each project's root. Pure.
import type { GuiModelCatalog, GuiPicks } from '@shared/gui-chat'
import { USAGE_VENDORS, usageVendor } from '@shared/agents'
import type { RemoteAgentModels, RemoteContext, RemoteGroup, RemoteMember, RemoteSession, RemoteShip, RemoteShipField, RemoteVendorUsage, RemoteWindowSessions } from '@shared/remote'
import { contextHigh, contextMark, planLabel, vendorStatus, windowKey, type ContextUsage, type UsageAccount, type UsageVendor, type VendorUsage } from '@shared/session-meta'
import type { SessionSettings } from '@shared/session-settings'
import { turnCheckView, type TurnChecks } from '@shared/turn-checks'
import type { Project, Session, SessionId, Worktree } from '@shared/types'
import { groupsOf, type SideItem } from '../sidebar/model'
import { glyphStatus } from '../lifecycle/present'
import { glanceFields, submitBlocker, submitLabel, type ShipKind, type ShipState } from '../pull-requests/ship-flow'

/** Local folders never go to the phone (PRD F22): a worktree's or project's path in a message becomes `.` / the folder name. */
export function hidePaths(text: string, folders: readonly string[]): string {
  let out = text
  for (const folder of [...folders].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(`${folder}/`).join('./').split(folder).join(folder.split('/').pop() ?? '.')
  }
  return out
}

/** The runs the phone shows (their kind is an opaque string to it): the exits and 推送 of the base; 提交, 同步 and 拉取
 *  stay off the phone until it learns them. */
export const shownOnPhone = (kind: ShipKind): kind is RemoteShip['kind'] => kind === 'main' || kind === 'pr' || kind === 'push-pr' || kind === 'push-base'

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * An exit in progress as the phone draws it (Figma 45J): the Ship block's state with its glance worked out. Long text is
 * cut to what main accepts (a session whose run does not validate would drop off the phone's list); `folders` are
 * hidden from messages and git output.
 */
export function remoteShip(state: ShipState, folders: readonly string[] = []): RemoteShip {
  const fields = glanceFields(state).filter((f): f is RemoteShipField => f !== 'base')
  const { error } = state
  const text = (value: string, max: number) => clip(hidePaths(value, folders), max)
  const blocker = submitBlocker(state)
  return {
    // remoteSessions passes only runs shownOnPhone; the fallback keeps the type without a cast.
    kind: shownOnPhone(state.kind) ? state.kind : 'push-pr',
    title: clip(state.title, 300),
    agent: clip(state.agent, 100),
    stage: state.stage,
    steps: state.steps.slice(0, 12).map((s) => ({ id: s.id, label: text(s.label, 300), state: s.state, ...(s.note ? { note: text(s.note, 300) } : {}) })),
    texts: { commit: clip(state.texts.commit, 20_000), title: clip(state.texts.title, 500), body: clip(state.texts.body, 60_000), draft: state.texts.draft },
    fields,
    submitLabel: submitLabel(state.kind),
    submitBlocker: blocker ? clip(blocker, 300) : null,
    error: error
      ? {
          step: error.step,
          message: text(error.message, 2000),
          ...(error.output ? { output: hidePaths(error.output, folders).slice(-8000) } : {}),
          conflicts: Boolean(error.conflicts?.length),
          pushRefused: error.pushRefused === true,
          ...(error.reviewStop ? { reviewStop: true as const } : {})
        }
      : null
  }
}

/** The desktop ring's figures for the phone (PRD F22 v1.230 ④); `high` is decided here, once, by the desktop's rule. */
export function remoteContext(context: ContextUsage): RemoteContext {
  return {
    percent: Math.min(100, Math.max(0, context.percent)),
    ...(context.usedTokens !== undefined ? { usedTokens: context.usedTokens } : {}),
    ...(context.windowTokens !== undefined ? { windowTokens: context.windowTokens } : {}),
    // Always the desktop's mark: the agent's compaction point, else 80 % (the bar draws the same on both).
    markPercent: Math.min(100, Math.max(0, contextMark(context))),
    high: contextHigh(context)
  }
}

/**
 * The vendor whose plan windows apply to a session, as the desktop picks it (ContextButton.tsx): the agent actually
 * running in it (`bySession[id].agent`), else its own kind. None while it runs off the vendor's plan (a third-party
 * endpoint: the account's usage is not this session's).
 */
export function sessionUsageVendor(session: Pick<Session, 'kind'>, metrics?: { agent?: UsageVendor; plan?: false }): UsageVendor | undefined {
  if (metrics?.plan === false) return undefined
  return metrics?.agent ?? usageVendor(session.kind) ?? undefined
}

/** One entry per plan vendor with live windows, as the 额度 page lists them (`vendorStatus`). */
export function remoteUsage(
  usage: Partial<Record<UsageVendor, VendorUsage>>,
  accounts: Partial<Record<UsageVendor, UsageAccount>>,
  now: number
): RemoteVendorUsage[] {
  const out: RemoteVendorUsage[] = []
  for (const vendor of USAGE_VENDORS) {
    const status = vendorStatus(usage[vendor], accounts[vendor], now)
    if (status.windows.length === 0) continue
    const plan = accounts[vendor]?.plan ? planLabel(accounts[vendor].plan) : ''
    // One window per identity (minutes and scope), the first.
    const seen = new Set<string>()
    const windows = status.windows.filter((w) => !seen.has(windowKey(w)) && seen.add(windowKey(w)))
    out.push({
      vendor,
      ...(plan ? { plan } : {}),
      windows: windows.slice(0, 8).map((w) => ({ minutes: w.minutes, ...(w.scope ? { scope: w.scope.slice(0, 40) } : {}), percent: Math.min(100, Math.max(0, w.percent)), ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {}) }))
    })
  }
  return out
}

export interface RemoteShipping {
  /** Ship block states by worktree path. */
  ships: Readonly<Record<string, ShipState>>
  /** How the last exit of a worktree ended, by worktree path (only exits: other notices do not count). */
  endings: Readonly<Record<string, string>>
}

/** The most a group lists: the fold shows one level and the wire validates the same bound. */
const MAX_MEMBERS = 200

/**
 * The collaboration groups of the sessions the phone lists (PRD v1.243), counted by the sidebar's own `groupsOf`: a
 * session whose dispatcher is not listed has no parent here. `parentId` per child, `group` per session with members.
 */
export function remoteGroups(
  listed: readonly Session[],
  items: Readonly<Record<SessionId, readonly SideItem[]>>,
  /** Each listed session's worktree path and project root: local folders never go to the phone (`hidePaths`). */
  folders: Readonly<Record<SessionId, readonly string[]>> = {}
): { parents: Record<SessionId, SessionId>; groups: Record<SessionId, RemoteGroup> } {
  const byId = new Map(listed.map((s) => [s.id, s]))
  const parents: Record<SessionId, SessionId> = {}
  for (const s of listed) if (s.dispatchedBy && s.dispatchedBy !== s.id && byId.has(s.dispatchedBy)) parents[s.id] = s.dispatchedBy
  const groups: Record<SessionId, RemoteGroup> = {}
  for (const [id, group] of Object.entries(groupsOf(listed, items))) {
    const text = (owner: SessionId, value: string, max: number) => clip(hidePaths(value, folders[owner] ?? []), max)
    const lines = new Map((items[id] ?? []).map((item) => [item.id, item]))
    const phases = (items[id] ?? []).filter((item) => item.kind === 'phase')
    const members: RemoteMember[] = [
      ...group.children.flatMap((child): RemoteMember[] => {
        const s = byId.get(child)
        return s ? [{ id: s.id, kind: 'session', title: text(s.id, s.title, 500), status: glyphStatus(s) }] : []
      }),
      ...group.items.flatMap((item): RemoteMember[] => {
        const line = lines.get(item.id)
        if (!line) return []
        const kind = line.kind === 'workflow' ? 'workflow' : line.kind === 'teammate' ? 'teammate' : 'subagent'
        // A run's meta is the phase it is in; a subagent's and a teammate's is their model.
        const meta = kind === 'workflow' ? (phases.find((p) => p.id.startsWith(`phase:${line.id.slice('workflow:'.length)}:`) && p.glyph === 'running')?.title ?? line.right) : kind === 'teammate' ? line.right : line.model
        return [{ id: item.id, kind, title: text(id, line.title, 500), status: item.status, ...(meta ? { meta: text(id, meta, 200) } : {}) }]
      })
    ]
    groups[id] = { total: group.total, counts: group.counts.map((c) => ({ status: c.status, count: c.count })), members: members.slice(0, MAX_MEMBERS) }
  }
  return { parents, groups }
}

export function remoteSessions(
  data: { projects: readonly Project[]; worktrees: readonly Worktree[]; sessions: readonly Session[] },
  shipping: RemoteShipping = { ships: {}, endings: {} },
  settings: (session: Session) => SessionSettings | undefined = () => undefined,
  checks: (session: Session) => TurnChecks | undefined = () => undefined,
  context: (session: Session) => ContextUsage | undefined = () => undefined,
  vendor: (session: Session) => UsageVendor | undefined = () => undefined,
  /** Every session's subagents, workflow runs and team as the sidebar lines (`sideItemsOf`), for the groups. */
  items: Readonly<Record<SessionId, readonly SideItem[]>> = {}
): RemoteWindowSessions {
  const worktrees = new Map(data.worktrees.map((w) => [w.id, w]))
  const out: RemoteWindowSessions = { projects: [], sessions: [], folders: {}, roots: {} }
  const listed: Session[] = []
  const hidden: Record<SessionId, string[]> = {}
  for (const s of data.sessions) {
    const w = worktrees.get(s.worktreeId)
    if (!w || w.archived || s.kind === 'shell') continue
    const row: RemoteSession = { id: s.id, projectId: w.projectId, title: s.title, agent: s.kind, status: s.status, activity: s.lastActivityAt }
    if (s.currentAction) row.action = s.currentAction
    if (s.statusSince !== undefined) row.since = s.statusSince
    if (w.branch) row.branch = w.branch
    if (s.dispatchModel) row.model = s.dispatchModel
    if (s.lastReply) row.reply = s.lastReply
    const own = settings(s)
    if (own) row.settings = own
    // 看板 · 进度's third line (PRD F22 v1.229 ②): the desktop card's checks and `+N −M`, as the phone draws them.
    const view = turnCheckView(checks(s))
    if (view) row.checks = { turn: view.turn, edited: view.edited, kinds: view.kinds.map((k) => ({ kind: k.kind, status: k.status })) }
    const ring = context(s)
    if (ring) row.context = remoteContext(ring)
    const owner = vendor(s)
    if (owner) row.usageVendor = owner
    const added = w.added ?? 0
    const removed = w.removed ?? 0
    if (added + removed > 0) row.stat = { added, removed }
    if (s.github) row.github = s.github
    const ship = shipping.ships[w.path]
    const root = data.projects.find((p) => p.id === w.projectId)?.rootPath ?? ''
    if (ship && shownOnPhone(ship.kind)) row.ship = remoteShip(ship, [w.path, root])
    const ending = shipping.endings[w.path]
    if (ending && !ship) row.shipNotice = clip(hidePaths(ending, [w.path, root]), 300)
    out.sessions.push(row)
    listed.push(s)
    hidden[s.id] = [w.path, root]
    out.folders[s.id] = { cwd: w.path, ...(w.baseBranch ? { base: w.baseBranch } : {}), ...(s.agentSessionId ? { agentSession: s.agentSessionId } : {}) }
  }
  const { parents, groups } = remoteGroups(listed, items, hidden)
  for (const row of out.sessions) {
    const parentId = parents[row.id]
    if (parentId) row.parentId = parentId
    const group = groups[row.id]
    if (group) row.group = group
  }
  for (const p of data.projects) {
    out.roots[p.id] = p.rootPath
    out.projects.push({ id: p.id, name: p.name })
  }
  return out
}

/**
 * 新建会话's 模型 row (PRD F22 v1.161, Figma 67A): the agent's models as the desktop's empty-session menu lists them
 * (Figma 65) — what a session of it listed before, else what main asked it — and the one a new session starts with,
 * its last pick (left out when the list does not have it: the agent's default). None when it will not run as GUI.
 */
export function agentModels(gui: boolean, picks: GuiPicks | undefined, catalog: GuiModelCatalog | undefined): RemoteAgentModels {
  if (!gui) return { gui, models: [] }
  const models = picks?.models?.length ? picks.models : (catalog?.models ?? [])
  const current = picks?.model ?? catalog?.current
  return { gui, models: [...models], ...(current !== undefined && models.some((m) => m.value === current) ? { current } : {}) }
}
