// Pure overview model (PRD F9, Figma 11 v2): every session across projects, grouped by what it
// needs from the user: the columns of 看板 · 进度.
import type { Project, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { defineMessages, localized, pick } from '@shared/i18n'
import { sessionTime } from '../sidebar/format-elapsed'
import { glyphStatus, phaseLine } from '../lifecycle/present'

/** A group is a session status (after folding a starting agent into running). */
export type OverviewGroupKey = SessionStatus

/** Most pressing first: answer, fix, review, watch, ignore. */
export const GROUP_ORDER: readonly OverviewGroupKey[] = ['needs_you', 'error', 'done_unread', 'running', 'idle', 'exited']

export const GROUP_LABEL: Record<OverviewGroupKey, string> = localized(
  defineMessages({
    zh: { needs_you: '等你处理', error: '出错', done_unread: '待审阅', running: '运行中', idle: '空闲', exited: '已退出' },
    en: { needs_you: 'Needs you', error: 'Error', done_unread: 'To review', running: 'Running', idle: 'Idle', exited: 'Exited' }
  })
)

const M = defineMessages({
  zh: {
    starting: '启动中',
    notStarted: '未启动',
    status: { needs_you: '等你处理', done_unread: '已完成', error: '出错', running: '运行中', idle: '空闲', exited: '已退出' } as Record<SessionStatus, string>,
    shell: (path: string) => `终端 · ${path}`,
    sessions: (n: number) => `${n} 个会话`,
    needYou: (n: number) => `${n} 个需要你`,
    answer: '等你回答'
  },
  en: {
    starting: 'Starting',
    notStarted: 'Not started',
    status: { needs_you: 'Needs you', done_unread: 'Done', error: 'Error', running: 'Running', idle: 'Idle', exited: 'Exited' },
    shell: (path: string) => `Terminal · ${path}`,
    sessions: (n: number) => (n === 1 ? '1 session' : `${n} sessions`),
    needYou: (n: number) => (n === 1 ? '1 needs you' : `${n} need you`),
    answer: 'Needs an answer'
  }
})

/** Color is only for the two states that pull the user in; everything else stays neutral. */
export type OverviewTone = 'attention' | 'error' | 'plain'

/** Board card fill (tokens `--card-<tone>`): one per group, exited shares idle's. */
export type CardTone = 'attention' | 'error' | 'review' | 'working' | 'idle'

export interface OverviewRow {
  session: Session
  /** Status shown as text next to the glyph (status is never color-only). */
  status: SessionStatus
  statusLabel: string
  tone: OverviewTone
  card: CardTone
  title: string
  /** `project › branch`, or just the project for its main checkout. */
  where: string
  projectName: string
  /** What it is doing, asking or reporting. */
  summary: string
  stat: string
  /** "已等 3m" while waiting, this turn's time while running, "5m 前" otherwise (PRD F10). */
  time: string
  /** Waited longer than five minutes: drawn heavier. */
  timeEmphasis: boolean
}

export interface OverviewGroup {
  key: OverviewGroupKey
  label: string
  rows: OverviewRow[]
}

export interface OverviewInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  now: number
  /** Free text plus `p:项目` / `s:状态` tokens, all of which must match. */
  filter?: string
}

function statusLabel(session: Session, status: SessionStatus): string {
  const m = pick(M)
  if (session.phase === 'starting') return m.starting
  if (session.phase === 'not-started') return m.notStarted
  return m.status[status]
}

/** What it is doing or asking: the status track writes "等你确认：运行 …" into currentAction while it waits. */
function summaryOf(session: Session, worktree: Worktree | undefined): string {
  const phase = phaseLine(session)
  if (phase) return phase
  if (session.currentAction) return session.currentAction
  if ((session.status === 'idle' || session.status === 'done_unread') && session.lastReply) return session.lastReply
  if (session.kind === 'shell' && worktree) return pick(M).shell(worktree.path)
  return ''
}

function timeFields(time: { text: string; emphasis: boolean }): { time: string; timeEmphasis: boolean } {
  return { time: time.text, timeEmphasis: time.emphasis }
}

function toneOf(status: SessionStatus): OverviewTone {
  if (status === 'needs_you') return 'attention'
  if (status === 'error') return 'error'
  return 'plain'
}

function cardOf(status: SessionStatus): CardTone {
  switch (status) {
    case 'needs_you':
      return 'attention'
    case 'error':
      return 'error'
    case 'done_unread':
      return 'review'
    case 'running':
      return 'working'
    case 'idle':
    case 'exited':
      return 'idle'
  }
}

/** The leader's `wavi tell` is what its session waits on now (a confirm or a 定时任务 request is shown before it). */
const toldNow = (session: Session): boolean => session.status === 'needs_you' && session.waviAsk === 'tell'

function toRow(session: Session, worktree: Worktree | undefined, project: Project | undefined, now: number): OverviewRow {
  const status = glyphStatus(session)
  const projectName = project?.name ?? ''
  // The main checkout reads as the project alone, whatever branch it is on.
  const branch = worktree && !worktree.isMain ? worktree.branch : ''
  const added = worktree?.added ?? 0
  const removed = worktree?.removed ?? 0
  return {
    session,
    status,
    statusLabel: toldNow(session) ? pick(M).answer : statusLabel(session, status),
    tone: toneOf(status),
    card: cardOf(status),
    title: session.title,
    where: branch ? `${projectName} › ${branch}` : projectName,
    projectName,
    summary: summaryOf(session, worktree),
    stat: added + removed > 0 ? `+${added} −${removed}` : '',
    ...timeFields(sessionTime(session, status, now, true))
  }
}

interface FilterTokens {
  text: string[]
  project: string[]
  status: string[]
}

export function parseFilter(filter: string | undefined): FilterTokens {
  const tokens: FilterTokens = { text: [], project: [], status: [] }
  for (const raw of (filter ?? '').toLowerCase().split(/\s+/)) {
    if (raw === '') continue
    const [prefix, rest] = [raw.slice(0, 2), raw.slice(2)]
    // eslint-disable-next-line no-restricted-syntax -- full-width colon typed by a Chinese input method
    if ((prefix === 'p:' || prefix === 'p：') && rest) tokens.project.push(rest)
    // eslint-disable-next-line no-restricted-syntax -- full-width colon typed by a Chinese input method
    else if ((prefix === 's:' || prefix === 's：') && rest) tokens.status.push(rest)
    else tokens.text.push(raw)
  }
  return tokens
}

function matches(row: OverviewRow, groupLabel: string, f: FilterTokens): boolean {
  const project = row.projectName.toLowerCase()
  const status = `${groupLabel} ${row.statusLabel} ${row.status}`.toLowerCase()
  const text = `${row.title} ${row.where} ${row.summary}`.toLowerCase()
  return (
    f.project.every((t) => project.includes(t)) && f.status.every((t) => status.includes(t)) && f.text.every((t) => text.includes(t))
  )
}

/**
 * Groups in GROUP_ORDER, each with its rows. Empty groups are kept (the board draws a column for each; the
 * list skips them) except `exited`, which only appears when it has rows. Waiting sessions list the one
 * that has waited longest first; every other group lists the most recently active first.
 */
export function buildOverview({ projects, worktrees, sessions, now, filter }: OverviewInput): OverviewGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const f = parseFilter(filter)
  const byGroup = new Map<OverviewGroupKey, OverviewRow[]>(GROUP_ORDER.map((k) => [k, []]))
  for (const session of sessions) {
    const worktree = worktreeById.get(session.worktreeId)
    if (worktree?.archived) continue
    const row = toRow(session, worktree, worktree && projectById.get(worktree.projectId), now)
    if (!matches(row, GROUP_LABEL[row.status], f)) continue
    byGroup.get(row.status)?.push(row)
  }
  return GROUP_ORDER.map((key) => {
    const rows = byGroup.get(key) ?? []
    rows.sort((a, b) =>
      key === 'needs_you'
        ? a.session.lastActivityAt - b.session.lastActivityAt
        : b.session.lastActivityAt - a.session.lastActivityAt
    )
    return { key, label: GROUP_LABEL[key], rows }
  }).filter((g) => g.key !== 'exited' || g.rows.length > 0)
}

/** Header line: "6 个会话 · 4 个需要你". */
export function overviewSummary(sessions: readonly Pick<Session, 'status'>[], attention: number): string {
  const m = pick(M)
  return attention > 0 ? `${m.sessions(sessions.length)} · ${m.needYou(attention)}` : m.sessions(sessions.length)
}

/** Session ids in drawn order (collapsed groups skipped) — ↑/↓ targets. */
export function orderedIds(groups: readonly OverviewGroup[], collapsed: ReadonlySet<OverviewGroupKey>): SessionId[] {
  return groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.rows.map((r) => r.session.id))
}

/** ↑/↓ within the drawn rows, clamped; with no selection, down picks the first and up the last. */
export function moveSelection(ids: readonly SessionId[], current: SessionId | null, direction: 1 | -1): SessionId | null {
  if (ids.length === 0) return null
  const at = current === null ? -1 : ids.indexOf(current)
  if (at === -1) return (direction === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, at + direction))] ?? null
}


