// 任务 board's pure model (PRD F9 v1.249): a card is a task joined with the session it is bound to, and the 「动态」
// panel's events are what changed between two looks at the board.
import { canLeadCard, type DispatchAgent } from '@shared/dispatch'
import { defineMessages, pick } from '@shared/i18n'
import { taskState, TASK_LIMITS, type Task, type TaskId, type TaskState } from '@shared/task-board'
import type { Session } from '@shared/types'
import type { LeaderFailure } from '../dispatch/task-deliver'

export type CardSession = Pick<Session, 'id' | 'status'>

export interface Card<S extends CardSession = CardSession> {
  task: Task
  state: TaskState
  /** The bound session when it still exists; a card whose session was closed is waiting again. */
  session?: S
}

/** Each task with its status: from its session's status (PRD §6.2), not from anything an agent wrote on the card. */
export function joinCards<S extends CardSession>(tasks: readonly Task[], sessions: readonly S[]): Card<S>[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  return tasks.map((task) => {
    const session = task.sessionId !== undefined ? byId.get(task.sessionId) : undefined
    return { task, state: taskState(task, session?.status), ...(session ? { session } : {}) }
  })
}

/**
 * The 过滤 box: every word has to match a card's title, `#seq`, note or body; `p:name` matches the project's name.
 * An empty filter matches all.
 */
export function matchesFilter(task: Task, projectName: string, filter: string): boolean {
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${task.title}\n#${task.seq}\n${task.note ?? ''}\n${task.body}`.toLowerCase()
  const project = projectName.toLowerCase()
  return words.every((w) => (w.startsWith('p:') ? project.includes(w.slice(2)) : hay.includes(w)))
}

/** 「3 个项目 · 12 个任务 · 2 个等你处理」: the header's summary numbers. */
export function boardCounts(cards: readonly Card[], projectCount: number): { projects: number; tasks: number; attention: number } {
  return { projects: projectCount, tasks: cards.filter((c) => c.state !== 'canceled').length, attention: cards.filter((c) => c.state === 'attention').length }
}

// ── 动态 ──────────────────────────────────────────────────────────────────────

export type ActivityKind = 'added' | 'split' | 'dispatched' | 'started' | 'done' | 'attention' | 'error' | 'canceled' | 'notDispatched'

export interface ActivityEvent {
  /** Unique, increasing: the list's key. */
  id: number
  at: number
  kind: ActivityKind
  seq: number
  title: string
  /** `split`: the parent, and the last of the children when several came at once (「#22 – #27」). */
  parentSeq?: number
  toSeq?: number
  /** `notDispatched`: why the card's leader did not start; the card stays 待派发. */
  reason?: LeaderFailure
}

interface Seen {
  seq: number
  title: string
  parentId?: TaskId
  state: TaskState
  sessionId?: string
}

export type Snapshot = ReadonlyMap<TaskId, Seen>

export function snapshotOf(cards: readonly Card[]): Snapshot {
  return new Map(
    cards.map((c) => [
      c.task.id,
      { seq: c.task.seq, title: c.task.title, state: c.state, ...(c.task.parentId !== undefined ? { parentId: c.task.parentId } : {}), ...(c.task.sessionId !== undefined ? { sessionId: c.task.sessionId } : {}) }
    ])
  )
}

type Draft = Omit<ActivityEvent, 'id'>

/**
 * What changed since the last look, oldest first. The first look (`prev` null) is not news. Several cards split from one
 * parent at once are one event; a card's state change names the new state (done, waiting on you, failed, started).
 */
export function diffActivity(prev: Snapshot | null, next: Snapshot, at: number): Draft[] {
  if (!prev) return []
  const out: Draft[] = []
  const splits = new Map<TaskId, Seen[]>()
  for (const [id, now] of next) {
    const before = prev.get(id)
    if (!before) {
      if (now.parentId !== undefined && next.has(now.parentId)) splits.set(now.parentId, [...(splits.get(now.parentId) ?? []), now])
      else out.push({ at, kind: 'added', seq: now.seq, title: now.title })
      continue
    }
    if (now.sessionId !== undefined && before.sessionId === undefined) out.push({ at, kind: 'dispatched', seq: now.seq, title: now.title })
    if (now.state === before.state) continue
    const kind = KIND_OF_STATE[now.state]
    if (kind) out.push({ at, kind, seq: now.seq, title: now.title })
  }
  for (const [parentId, kids] of splits) {
    const parent = next.get(parentId)!
    const seqs = kids.map((k) => k.seq).sort((a, b) => a - b)
    const first = kids.find((k) => k.seq === seqs[0])!
    out.push({
      at,
      kind: 'split',
      seq: seqs[0]!,
      title: first.title,
      parentSeq: parent.seq,
      ...(seqs.length > 1 ? { toSeq: seqs[seqs.length - 1]! } : {})
    })
  }
  return out
}

const KIND_OF_STATE: Partial<Record<TaskState, ActivityKind>> = {
  working: 'started',
  done: 'done',
  attention: 'attention',
  error: 'error',
  canceled: 'canceled'
}

export const MAX_EVENTS = 40

/** Newest first, capped; ids continue from the newest one in `list`. */
export function appendEvents(list: readonly ActivityEvent[], drafts: readonly Draft[]): ActivityEvent[] {
  if (drafts.length === 0) return list as ActivityEvent[]
  let id = (list[0]?.id ?? 0) + 1
  const added = drafts.map((d) => ({ ...d, id: id++ })).reverse()
  return [...added, ...list].slice(0, MAX_EVENTS)
}

// ── A leader that did not start ───────────────────────────────────────────────

export const LEADER_FAILURE_M = defineMessages({
  zh: {
    prefix: '主理人没启动：',
    reasons: {
      'no-project': '项目已经不在了',
      'not-git': '项目不是 git 仓库',
      'no-plan': '建不出新的 worktree',
      'no-session': '会话没能创建',
      unbound: '会话没能绑定到这张卡，卡片消息没有送出',
      failed: '启动时出错'
    } satisfies Record<LeaderFailure, string>
  },
  en: {
    prefix: 'Leader did not start: ',
    reasons: {
      'no-project': 'the project is gone',
      'not-git': 'the project is not a git repository',
      'no-plan': 'no new worktree could be planned',
      'no-session': 'the session could not be added',
      unbound: 'the session could not be bound to this card, so the card was not sent',
      failed: 'starting failed'
    } satisfies Record<LeaderFailure, string>
  }
})

/** The sentence left on a card whose leader did not start (its note, PRD F9 v1.252). */
export function leaderFailureNote(reason: LeaderFailure): string {
  const m = pick(LEADER_FAILURE_M)
  return `${m.prefix}${m.reasons[reason]}`
}

/** Whether a note is one `leaderFailureNote` wrote, in either language (the language may have changed since). */
export function isLeaderFailureNote(note: string | undefined): boolean {
  return note !== undefined && [LEADER_FAILURE_M.zh, LEADER_FAILURE_M.en].some((m) => note.startsWith(m.prefix))
}

// ── The card's action line ────────────────────────────────────────────────────

export type ActionLine =
  /** A parent whose descendants wait on the user: drawn in the attention colour. */
  | { kind: 'waiting'; count: number }
  | { kind: 'text'; text: string }
  /** The leader did not start: the reason, drawn in the error colour. */
  | { kind: 'failed'; text: string }
  | { kind: 'key'; key: 'unassigned' | 'done' | 'doneReview' | 'canceled' | 'working' | 'idle' | 'error' }

/**
 * The one line under a card's title: what its agent is doing (the session's current action, else its last sentence,
 * else the note the agent left on the card), or why nothing is: a card nobody took waits to be dispatched.
 */
export function actionLine(
  card: Card<Pick<Session, 'id' | 'status' | 'currentAction' | 'lastReply'>>,
  ctx: { waitingBelow: number }
): ActionLine {
  if (ctx.waitingBelow > 0) return { kind: 'waiting', count: ctx.waitingBelow }
  const { state, session, task } = card
  if (state === 'canceled') return { kind: 'key', key: 'canceled' }
  if (state === 'done') return { kind: 'key', key: session?.status === 'done_unread' ? 'doneReview' : 'done' }
  if (state === 'error') return { kind: 'key', key: 'error' }
  if (!session && task.note !== undefined && isLeaderFailureNote(task.note)) return { kind: 'failed', text: task.note }
  const said = session?.currentAction?.trim() || session?.lastReply?.trim() || task.note?.trim()
  if (said) return { kind: 'text', text: said }
  if (session) return { kind: 'key', key: state === 'working' ? 'working' : 'idle' }
  return { kind: 'key', key: 'unassigned' }
}

// ── The new-card box's text ───────────────────────────────────────────────────

/**
 * What the box holds as a card: the first line is the title (trimmed, at most `TASK_LIMITS.title` characters; what is
 * over starts the body), the other lines are the body. Blank lines before the text are dropped. `null` without text.
 */
export function splitCard(text: string): { title: string; body: string } | null {
  const lines = text.replace(/^\s+/, '').replace(/\s+$/, '').split('\n')
  const first = (lines[0] ?? '').trim()
  if (first === '') return null
  // Cut between code points: main counts the title in UTF-16 units (`checkDraft`), and a pair is never split.
  let title = ''
  let rest = ''
  for (const ch of first) {
    if (rest === '' && title.length + ch.length <= TASK_LIMITS.title) title += ch
    else rest += ch
  }
  const body = [...(rest !== '' ? [rest.trim()] : []), ...lines.slice(1)].join('\n').replace(/^\n+/, '')
  return { title: title.trimEnd(), body }
}

/** Who leads a pasted root card (PRD F9 v1.250): an agent, or `none` (暂不派发). */
export type LeaderChoice = DispatchAgent | 'none'

/**
 * The leader the new-card box really uses: the chosen agent when it is installed, else 暂不派发. A remembered agent
 * that is gone is not started, and is not forgotten either (the stored choice stays). While `found` (what detection
 * returned) is null the choice stands, and the box looks again before it submits.
 */
export function usableLeader(choice: LeaderChoice, found: Readonly<Record<string, boolean>> | null): LeaderChoice {
  if (choice === 'none') return 'none'
  if (found === null) return choice
  return found[choice] === true && canLeadCard(choice) ? choice : 'none'
}
