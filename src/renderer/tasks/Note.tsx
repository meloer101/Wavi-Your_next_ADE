// A card on the board (PRD F9 v1.246 · Figma 115A4 / 115A4b): a note at 100 %, a one-line chip when zoomed out, a dot
// when far out. Status is the glyph's shape and the words, never only the colour; the agent's mark is a pin on the top
// edge, so a card nobody took has no pin.
import { memo, type CSSProperties } from 'react'
import { defineMessages } from '@shared/i18n'
import type { TaskState } from '@shared/task-board'
import type { Session, SessionStatus } from '@shared/types'
import { sessionTime } from '../sidebar/format-elapsed'
import { AgentIcon } from '../ui/AgentIcon'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import type { Drawing, PlacedCard } from './layout'
import { actionLine, type ActionLine, type Card } from './model'
import styles from './Note.module.css'

export const NOTE_M = defineMessages({
  zh: {
    waitLeader: '等主理人',
    noLeader: '没有主理人，不会派发',
    unassigned: '待派发',
    done: '已完成',
    doneReview: '已完成 · 等你审阅',
    canceled: '已取消',
    working: '进行中',
    idle: '空闲',
    waiting: (n: number) => `${n} 个子任务等你处理`,
    states: { idle: '待派发', working: '运行中', attention: '等你处理', done: '已完成', error: '出错', canceled: '已取消' } satisfies Record<TaskState, string>
  },
  en: {
    waitLeader: 'Waiting for the leader',
    noLeader: 'No leader, will not be dispatched',
    unassigned: 'To dispatch',
    done: 'Done',
    doneReview: 'Done · awaiting review',
    canceled: 'Canceled',
    working: 'Working',
    idle: 'Idle',
    waiting: (n: number) => `${n} ${n === 1 ? 'subtask needs' : 'subtasks need'} you`,
    states: { idle: 'To dispatch', working: 'Working', attention: 'Needs you', done: 'Done', error: 'Failed', canceled: 'Canceled' } satisfies Record<TaskState, string>
  }
})

/** The glyph a task state draws: the session glyphs, so the board reads like the sidebar. */
export const GLYPH_OF: Record<TaskState, SessionStatus> = { idle: 'idle', working: 'running', attention: 'needs_you', done: 'done_unread', error: 'error', canceled: 'exited' }

export interface NoteInfo {
  /** The children's states in order (the little segments under a parent). */
  segments: readonly TaskState[]
  progress: { done: number; total: number }
  /** Descendants waiting on the user. */
  waiting: number
  isRoot: boolean
  hasLeader: boolean
}

export interface NoteProps {
  card: Card<Session>
  placed: PlacedCard
  drawing: Drawing
  info: NoteInfo
  selected: boolean
  dimmed: boolean
  now: number
  onSelect(id: string): void
  onOpen(id: string): void
}

export function useActionText(line: ActionLine): string {
  const m = useMessages(NOTE_M)
  return line.kind === 'waiting' ? m.waiting(line.count) : line.kind === 'text' ? line.text : m[line.key]
}

function timeOf(card: Card<Session>, now: number): string {
  if (card.session) return sessionTime(card.session, card.session.status, now).text
  // Done by hand (or by an agent that has since gone): how long ago it was marked.
  if (card.state === 'done') return sessionTime({ startedAt: card.task.updatedAt, lastActivityAt: card.task.updatedAt }, 'idle', now).text
  return ''
}

function NoteView({ card, placed, drawing, info, selected, dimmed, now, onSelect, onOpen }: NoteProps) {
  const m = useMessages(NOTE_M)
  const { task, state, session } = card
  const line = actionLine(card, { waitingBelow: info.waiting, isRoot: info.isRoot, hasLeader: info.hasLeader })
  const action = useActionText(line)
  const style: CSSProperties = { left: placed.x, top: placed.y, width: placed.w, height: placed.h }
  const common = {
    className: styles.card,
    style,
    'data-state': state,
    'data-drawing': drawing,
    'data-selected': selected,
    'data-dimmed': dimmed,
    'data-task-id': task.id,
    'data-seq': task.seq,
    onClick: () => onSelect(task.id),
    onDoubleClick: () => onOpen(task.id)
  }

  if (drawing === 'dot') {
    return <div {...common} role="img" aria-label={`#${task.seq} ${task.title} · ${m.states[state]}`} title={`#${task.seq} ${task.title}`}><span className={styles.dot} /></div>
  }
  if (drawing === 'chip') {
    return (
      <div {...common} role="button" tabIndex={-1} aria-label={`#${task.seq} ${task.title} · ${m.states[state]}`}>
        <StatusGlyph status={GLYPH_OF[state]} />
        <span className={styles.chipTitle}>{task.title}</span>
        {session && <AgentIcon kind={session.kind} size={12} />}
      </div>
    )
  }
  const time = timeOf(card, now)
  return (
    <div {...common} role="button" tabIndex={-1} aria-label={`#${task.seq} ${task.title} · ${m.states[state]}`}>
      {session && (
        <span className={styles.pin}>
          <AgentIcon kind={session.kind} size={12} />
        </span>
      )}
      <span className={styles.meta}>
        <StatusGlyph status={GLYPH_OF[state]} />
        <span className={styles.mono}>#{task.seq}</span>
        <span className={styles.spacer} />
        {time && <span className={styles.mono}>{time}</span>}
      </span>
      <span className={styles.title}>{task.title}</span>
      <span className={styles.action} data-attention={line.kind === 'waiting' || state === 'attention'}>
        {action}
      </span>
      {placed.parent && (
        <span className={styles.segments}>
          {info.segments.map((s, i) => (
            <span key={i} className={styles.segment} data-state={s} />
          ))}
          <span className={styles.spacer} />
          <span className={styles.mono}>
            {info.progress.done}/{info.progress.total}
          </span>
        </span>
      )}
    </div>
  )
}

const same = (a: NoteProps, b: NoteProps): boolean =>
  a.card.task === b.card.task &&
  a.card.state === b.card.state &&
  a.card.session?.id === b.card.session?.id &&
  a.card.session?.kind === b.card.session?.kind &&
  a.card.session?.status === b.card.session?.status &&
  a.card.session?.currentAction === b.card.session?.currentAction &&
  a.card.session?.lastReply === b.card.session?.lastReply &&
  a.card.session?.statusSince === b.card.session?.statusSince &&
  a.placed.x === b.placed.x &&
  a.placed.y === b.placed.y &&
  a.placed.parent === b.placed.parent &&
  a.drawing === b.drawing &&
  a.selected === b.selected &&
  a.dimmed === b.dimmed &&
  a.now === b.now &&
  a.info.waiting === b.info.waiting &&
  a.info.isRoot === b.info.isRoot &&
  a.info.hasLeader === b.info.hasLeader &&
  a.info.progress.done === b.info.progress.done &&
  a.info.progress.total === b.info.progress.total &&
  a.info.segments.join() === b.info.segments.join() &&
  a.onSelect === b.onSelect &&
  a.onOpen === b.onOpen

export const Note = memo(NoteView, same)
