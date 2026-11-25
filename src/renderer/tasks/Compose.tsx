// 「贴一张」 (N): an input note at the middle of the view. Enter pastes it as a card of the chosen project, Esc drops it.
// With more than one project a small picker sits next to the input.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { defineMessages } from '@shared/i18n'
import { TASK_LIMITS } from '@shared/task-board'
import type { Project, ProjectId } from '@shared/types'
import { useMessages } from '../ui/i18n'
import styles from './Compose.module.css'

const M = defineMessages({
  zh: { title: '任务标题', project: '项目' },
  en: { title: 'Task title', project: 'Project' }
})

interface Props {
  projects: readonly Pick<Project, 'id' | 'name'>[]
  initialProject: ProjectId
  /** Resolves true when the card was made; false keeps the input (main refused it). */
  onSubmit(projectId: ProjectId, title: string): Promise<boolean>
  onCancel(): void
}

export function Compose({ projects, initialProject, onSubmit, onCancel }: Props) {
  const m = useMessages(M)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(initialProject)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const submit = async (): Promise<void> => {
    const text = title.trim()
    if (text === '' || busy) return
    setBusy(true)
    const made = await onSubmit(projectId, text)
    setBusy(false)
    if (!made) input.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    // Typed keys are the input's: the board's own (N, ⇧1, ⌥D …) skip events from inputs, and Esc stops here.
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className={styles.compose} data-testid="task-compose" data-no-pan="">
      <input
        ref={input}
        className={styles.input}
        value={title}
        maxLength={TASK_LIMITS.title}
        placeholder={m.title}
        aria-label={m.title}
        data-testid="task-compose-input"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {projects.length > 1 && (
        <select className={styles.project} value={projectId} aria-label={m.project} onChange={(e) => setProjectId(e.target.value)} onKeyDown={onKeyDown}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
