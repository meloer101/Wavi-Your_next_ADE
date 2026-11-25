// A card opened (Figma 114B): a modal over the board. Title bar: 停止, 进入会话, close. Body: the task, its subtasks,
// the agent's latest words, who dispatched it. 取消任务 and 删除 sit at the bottom (PRD F9 取消和清理).
import { useEffect, useRef } from 'react'
import { defineMessages } from '@shared/i18n'
import type { Task } from '@shared/task-board'
import type { Session, Worktree } from '@shared/types'
import { enterSession } from '../overview/store'
import { interruptAgent } from '../session-io'
import { useSessionMeta } from '../session-meta/store'
import { sessionTime } from '../sidebar/format-elapsed'
import { AgentIcon } from '../ui/AgentIcon'
import { X } from '../ui/icons'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import { GLYPH_OF, NOTE_M, useActionText } from './Note'
import { actionLine, type Card } from './model'
import styles from './Detail.module.css'

const M = defineMessages({
  zh: {
    stop: '停止',
    enter: '进入会话',
    close: '关闭',
    subtasks: '子任务',
    recent: '最近活动',
    dispatch: '派发',
    byYou: '你贴的',
    byAgent: (title: string) => `由 ${title} 贴出`,
    cancel: '取消任务',
    delete: '删除',
    confirmTitle: (title: string) => `删除“${title}”？`,
    confirmDetail: (n: number) => (n > 0 ? `它的 ${n} 张子任务也会一起删除。绑定的会话不会被关闭。` : '绑定的会话不会被关闭。'),
    confirmLabel: '删除'
  },
  en: {
    stop: 'Stop',
    enter: 'Enter session',
    close: 'Close',
    subtasks: 'Subtasks',
    recent: 'Recent',
    dispatch: 'Dispatched',
    byYou: 'Pasted by you',
    byAgent: (title: string) => `Pasted by ${title}`,
    cancel: 'Cancel task',
    delete: 'Delete',
    confirmTitle: (title: string) => `Delete “${title}”?`,
    confirmDetail: (n: number) => (n > 0 ? `Its ${n} subtasks are deleted with it. The bound session stays open.` : 'The bound session stays open.'),
    confirmLabel: 'Delete'
  }
})

interface Props {
  card: Card<Session>
  /** Direct children, oldest first. */
  children: readonly Card<Session>[]
  descendants: number
  projectName: string
  parentTitle: string | undefined
  worktree: Worktree | undefined
  dispatcher: Session | undefined
  hasLeader: boolean
  now: number
  onClose(): void
}

function SubtaskRow({ card, now, hasLeader }: { card: Card<Session>; now: number; hasLeader: boolean }) {
  const line = actionLine(card, { waitingBelow: 0, isRoot: false, hasLeader })
  const text = useActionText(line)
  const time = card.session ? sessionTime(card.session, card.session.status, now).text : ''
  return (
    <li className={styles.subtask}>
      <StatusGlyph status={GLYPH_OF[card.state]} />
      <span className={styles.mono}>#{card.task.seq}</span>
      <span className={styles.subtitle}>{card.task.title}</span>
      <span className={styles.subaction}>{text}</span>
      {card.session && <AgentIcon kind={card.session.kind} size={12} />}
      <span className={styles.mono}>{time}</span>
    </li>
  )
}

export function Detail({ card, children, descendants, projectName, parentTitle, worktree, dispatcher, hasLeader, now, onClose }: Props) {
  const m = useMessages(M)
  const n = useMessages(NOTE_M)
  const dialog = useRef<HTMLDivElement>(null)
  const { task, session, state } = card
  const model = useSessionMeta((s) => (session ? s.bySession[session.id]?.settings?.model : undefined)) ?? session?.dispatchModel
  useEffect(() => dialog.current?.focus(), [])

  const stop = async (): Promise<void> => {
    if (!session) return
    try {
      await interruptAgent(session.id)
    } catch {
      // A plain terminal has no agent to interrupt: the button is for agents, nothing to report.
    }
  }
  const remove = async (task: Task): Promise<void> => {
    const ok = await window.tr.ui.confirm({ message: m.confirmTitle(task.title), detail: m.confirmDetail(descendants), confirmLabel: m.confirmLabel, destructive: true })
    if (!ok) return
    onClose()
    await window.tr.tasks.remove(task.id)
  }
  const said = session?.lastReply?.trim() || task.note?.trim()
  const time = session ? sessionTime(session, session.status, now).text : ''

  return (
    <div className={styles.scrim} data-no-pan="" onClick={onClose}>
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`#${task.seq} ${task.title}`}
        tabIndex={-1}
        data-testid="task-detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <header className={styles.bar}>
          <StatusGlyph status={GLYPH_OF[state]} />
          <span className={styles.mono}>#{task.seq}</span>
          <h2 className={styles.title}>{task.title}</h2>
          <span className={styles.where}>
            {projectName}
            {parentTitle !== undefined && ` › ${parentTitle}`}
          </span>
          <span className={styles.spacer} />
          {session && (
            <>
              <button type="button" className={styles.button} onClick={() => void stop()}>
                {m.stop}
              </button>
              <button type="button" className={styles.primary} onClick={() => enterSession(session.id)}>
                {m.enter}
              </button>
            </>
          )}
          <button type="button" className={styles.close} aria-label={m.close} title={m.close} onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.status}>
            <span>{n.states[state]}</span>
            {time && <span className={styles.dim}>{time}</span>}
            {session && <AgentIcon kind={session.kind} size={12} />}
            {model && <span className={styles.mono}>{model}</span>}
            {worktree && <span className={styles.mono}>{worktree.branch}</span>}
          </p>
          {task.body.trim() !== '' && <p className={styles.text}>{task.body}</p>}
          {children.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.heading}>
                {m.subtasks} <span className={styles.dim}>{children.length}</span>
              </h3>
              <ul className={styles.list}>
                {children.map((c) => (
                  <SubtaskRow key={c.task.id} card={c} now={now} hasLeader={hasLeader} />
                ))}
              </ul>
            </section>
          )}
          {said && (
            <section className={styles.section}>
              <h3 className={styles.heading}>{m.recent}</h3>
              <p className={styles.text}>{said}</p>
            </section>
          )}
          <section className={styles.section}>
            <h3 className={styles.heading}>{m.dispatch}</h3>
            <p className={styles.text}>{task.createdBy === 'user' || !dispatcher ? m.byYou : m.byAgent(dispatcher.title)}</p>
          </section>
          <footer className={styles.footer}>
            {state !== 'canceled' && (
              <button type="button" className={styles.button} onClick={() => void window.tr.tasks.update(task.id, { manual: 'canceled' })}>
                {m.cancel}
              </button>
            )}
            <button type="button" className={styles.danger} onClick={() => void remove(task)}>
              {m.delete}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}
