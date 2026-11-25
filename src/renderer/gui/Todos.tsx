// The agent's task list (PRD F23, Figma 59J; the tray on the composer, 113A, PRD v1.244): Claude's TodoWrite, Codex's and ACP agents' plan. The latest list sits
// in a tray on the composer while something in it is left (ChatPane, `currentTodos`); in the feed its row
// 「任务 · N 项」 opens to the same list (Feed). Each task: its status glyph — done, in progress, not started — and its
// text, the one in progress in the primary colour, done ones tertiary.
import { useState } from 'react'
import { ChevronDown, ChevronUp } from '../ui/icons'
import { defineMessages } from '@shared/i18n'
import type { ChatTodo } from '@shared/transcript-chat'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { todoProgress, todoStatus } from './model'
import { useMessages } from '../ui/i18n'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: { tasks: '任务', collapse: '收起', expand: '展开' },
  en: { tasks: 'Tasks', collapse: 'Collapse', expand: 'Expand' }
})

export function TodoList({ todos, className }: { todos: readonly ChatTodo[]; className?: string }) {
  return (
    <ul className={className ? `${styles.todos} ${className}` : styles.todos}>
      {todos.map((todo, i) => (
        <li key={i} className={styles.todo} data-status={todo.status}>
          <StatusGlyph status={todoStatus(todo.status)} />
          <span className={styles.todoText}>{todo.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Collapsed trays by session — in memory only, so a reload starts expanded (PRD v1.244). */
const collapsedSessions = new Set<SessionId>()

/** A task's 16px mark in the tray: done a filled circle with a check, in progress a turning arc, not started a ring. */
function TodoMark({ status }: { status: ChatTodo['status'] }) {
  return (
    <svg className={styles.todoMark} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {status === 'completed' && (
        <>
          <circle cx="8" cy="8" r="8" fill="var(--text-primary)" />
          <path d="M4.6 8.2 7 10.6l4.4-4.9" stroke="var(--text-inverse)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'in_progress' && (
        <g className={styles.todoSpin}>
          <path d="M8 2A6 6 0 1 1 2 8" stroke="var(--status-working)" strokeWidth="1.75" strokeLinecap="round" />
        </g>
      )}
      {status === 'pending' && <circle cx="8" cy="8" r="6.25" stroke="var(--text-secondary)" strokeWidth="1.5" />}
    </svg>
  )
}

/** The task tray on the composer (Figma 113A): the header row with the count and one segment per task, a row per task. */
export function TodoCard({ sessionId, todos }: { sessionId: SessionId; todos: readonly ChatTodo[] }) {
  const m = useMessages(M)
  const [collapsed, setCollapsed] = useState(() => collapsedSessions.has(sessionId))
  const { done, total } = todoProgress(todos)
  const toggle = (): void => {
    if (collapsed) collapsedSessions.delete(sessionId)
    else collapsedSessions.add(sessionId)
    setCollapsed(!collapsed)
  }
  return (
    <section className={styles.tray} aria-label={m.tasks} data-testid="gui-todos">
      <header className={styles.trayHeader}>
        <span className={styles.trayName}>{m.tasks}</span>
        <span className={styles.trayCount}>
          {done}/{total}
        </span>
        <span className={styles.traySpacer} />
        <span className={styles.todoSegments} aria-hidden>
          {todos.map((todo, i) => (
            <span key={i} className={styles.todoSegment} data-status={todo.status} />
          ))}
        </span>
        <button type="button" className={styles.trayButton} aria-label={collapsed ? m.expand : m.collapse} aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? <ChevronUp size={16} strokeWidth={1.75} /> : <ChevronDown size={16} strokeWidth={1.75} />}
        </button>
      </header>
      {!collapsed && (
        <ul className={styles.trayTodos}>
          {todos.map((todo, i) => (
            <li key={i} className={styles.trayTodo} data-status={todo.status}>
              <TodoMark status={todo.status} />
              <span className={styles.todoText}>{todo.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
