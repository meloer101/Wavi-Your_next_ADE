// A card opened (Figma 114B / 117G): a modal over the board. Title bar: 停止 and 进入会话, or 派给主理人… for a card
// that waits, and close. Body: the task, its subtasks, the agent's latest words, who dispatched it. The title and the
// text are edited in place (Enter saves, Esc drops; ⇧Enter is a new line in the text). 取消任务 / 恢复任务 and 删除 sit
// at the bottom; a delete is not asked about, it can be undone (PRD F9 v1.252).
import { useEffect, useRef, useState } from 'react'
import { defineMessages } from '@shared/i18n'
import { TASK_LIMITS } from '@shared/task-board'
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
    restore: '恢复任务',
    delete: '删除',
    dispatchTo: '派给主理人…',
    title: '任务标题',
    body: '正文'
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
    restore: 'Restore task',
    delete: 'Delete',
    dispatchTo: 'Dispatch to leader…',
    title: 'Task title',
    body: 'Details'
  }
})

interface Props {
  card: Card<Session>
  /** Direct children, oldest first. */
  children: readonly Card<Session>[]
  /** Open with the title being edited (⌘E, 编辑). */
  edit: boolean
  /** 派给主理人…, only for a root card that waits; absent otherwise. */
  onDispatch: (() => void) | undefined
  onDelete(): void
  projectName: string
  parentTitle: string | undefined
  worktree: Worktree | undefined
  dispatcher: Session | undefined
  now: number
  onClose(): void
}

function SubtaskRow({ card, now }: { card: Card<Session>; now: number }) {
  const line = actionLine(card, { waitingBelow: 0 })
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

/**
 * The title or the text being edited. Enter saves (⇧Enter is a new line in the text), Esc drops, leaving the field
 * saves what is there.
 */
function Editor({ value, multiline, label, className, onDone }: { value: string; multiline: boolean; label: string; className: string; onDone(next: string | null, refocus: boolean): void }) {
  const [text, setText] = useState(value)
  const done = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(field.current.value.length, field.current.value.length)
  }, [])
  const finish = (next: string | null, refocus: boolean): void => {
    if (done.current) return
    done.current = true
    onDone(next, refocus)
  }
  return (
    <textarea
      ref={field}
      className={`${styles.editor} ${className}`}
      value={text}
      rows={1}
      aria-label={label}
      placeholder={label}
      spellCheck={false}
      maxLength={multiline ? TASK_LIMITS.body : TASK_LIMITS.title}
      onChange={(e) => setText(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
      onBlur={() => finish(text, false)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') {
          // Drops the edit only; the overlay stays.
          e.preventDefault()
          e.stopPropagation()
          finish(null, true)
        } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
          e.preventDefault()
          finish(text, true)
        }
      }}
    />
  )
}

export function Detail({ card, children, edit, onDispatch, onDelete, projectName, parentTitle, worktree, dispatcher, now, onClose }: Props) {
  const m = useMessages(M)
  const n = useMessages(NOTE_M)
  const dialog = useRef<HTMLDivElement>(null)
  const { task, session, state } = card
  const model = useSessionMeta((s) => (session ? s.bySession[session.id]?.settings?.model : undefined)) ?? session?.dispatchModel
  const [editing, setEditing] = useState<'title' | 'body' | null>(edit ? 'title' : null)
  // Not when it opens on the title field, which takes the keyboard itself.
  useEffect(() => {
    if (!edit) dialog.current?.focus()
  }, [edit])

  const stop = async (): Promise<void> => {
    if (!session) return
    try {
      await interruptAgent(session.id)
    } catch {
      // A plain terminal has no agent to interrupt: the button is for agents, nothing to report.
    }
  }
  const save = (field: 'title' | 'body', next: string | null, refocus: boolean): void => {
    setEditing(null)
    if (refocus) dialog.current?.focus()
    if (next === null) return
    const value = field === 'title' ? next.trim() : next.replace(/\s+$/, '')
    // A card keeps a title: an emptied one stays as it was.
    if ((field === 'title' && value === '') || value === task[field]) return
    void window.tr.tasks.update(task.id, field === 'title' ? { title: value } : { body: value })
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
          {editing === 'title' ? (
            <Editor value={task.title} multiline={false} label={m.title} className={styles.titleEditor!} onDone={(next, refocus) => save('title', next, refocus)} />
          ) : (
            <h2 className={styles.title}>
              <button type="button" className={styles.editable} data-testid="task-detail-title" onClick={() => setEditing('title')}>
                {task.title}
              </button>
            </h2>
          )}
          <span className={styles.where}>
            {projectName}
            {parentTitle !== undefined && ` › ${parentTitle}`}
          </span>
          <span className={styles.spacer} />
          {onDispatch && (
            <button type="button" className={styles.primary} onClick={onDispatch}>
              {m.dispatchTo}
            </button>
          )}
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
          {editing === 'body' ? (
            <Editor value={task.body} multiline label={m.body} className={styles.bodyEditor!} onDone={(next, refocus) => save('body', next, refocus)} />
          ) : (
            <button type="button" className={`${styles.editable} ${styles.text}`} data-testid="task-detail-body" data-empty={task.body.trim() === ''} onClick={() => setEditing('body')}>
              {task.body.trim() !== '' ? task.body : m.body}
            </button>
          )}
          {children.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.heading}>
                {m.subtasks} <span className={styles.dim}>{children.length}</span>
              </h3>
              <ul className={styles.list}>
                {children.map((c) => (
                  <SubtaskRow key={c.task.id} card={c} now={now} />
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
            <button type="button" className={styles.button} onClick={() => void window.tr.tasks.update(task.id, { manual: task.manual === 'canceled' ? 'todo' : 'canceled' })}>
              {task.manual === 'canceled' ? m.restore : m.cancel}
            </button>
            <span className={styles.spacer} />
            <button type="button" className={styles.danger} onClick={onDelete}>
              {m.delete}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}
