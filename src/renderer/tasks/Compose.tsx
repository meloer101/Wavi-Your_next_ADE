// 「贴一张」 (N · PRD F9 v1.250 / v1.252, Figma 117D / 117D′ / 117E): a 460-wide note at the middle of the view, or where
// the user right-clicked. The text grows to six lines and then scrolls; Enter pastes it, ⇧Enter starts a new line, Esc
// drops it. The first line is the title (drawn Medium), the rest is the body. Below: the project (only with more than
// one), the card's leader with its model and effort (./LeaderPickers.tsx) and 「贴上」. A sub-card added by hand
// (加子任务) has neither: its parent's leader decides who does it.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { defineMessages } from '@shared/i18n'
import { TASK_LIMITS } from '@shared/task-board'
import type { Project, ProjectId } from '@shared/types'
import { SheetMenu } from '../new-session/SheetMenu'
import { useMessages } from '../ui/i18n'
import { Check } from '../ui/icons'
import { LeaderPickers, Picker, useLeaderPickers, type LeaderSelection } from './LeaderPickers'
import { splitCard } from './model'
import styles from './Compose.module.css'

const M = defineMessages({
  zh: { placeholder: '任务标题', project: '项目', paste: '贴上' },
  en: { placeholder: 'Task title', project: 'Project', paste: 'Paste' }
})

const LINE = 20
const MAX_LINES = 6

export interface ComposeResult {
  projectId: ProjectId
  title: string
  body: string
  /** `agent` null: 暂不派发, and always for a sub-card. */
  leader: LeaderSelection
}

interface Props {
  projects: readonly Pick<Project, 'id' | 'name'>[]
  initialProject: ProjectId
  /** A sub-card of this card: no project and no leader to pick. */
  child?: boolean
  /** Its top-left corner in the board, px; centred without it. */
  at?: { x: number; y: number }
  /** Resolves true when the card was made; false keeps the box (main refused it). */
  onSubmit(result: ComposeResult): Promise<boolean>
  onCancel(): void
  /** The card was pasted: the box shrinks away (200 ms) before it is removed. */
  leaving?: boolean
}

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function Compose({ projects, initialProject, child = false, at, onSubmit, onCancel, leaving = false }: Props) {
  const m = useMessages(M)
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState(initialProject)
  const [busy, setBusy] = useState(false)
  const [projectMenu, setProjectMenu] = useState<HTMLElement | null>(null)
  const leader = useLeaderPickers(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const focusInput = (): void => input.current?.focus()
  useEffect(() => input.current?.focus(), [])

  // Grows with the text up to six lines, then scrolls; the mirror behind it follows the scroll.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, LINE * MAX_LINES)}px`
  }, [text])

  const submit = async (): Promise<void> => {
    const card = splitCard(text)
    if (!card || busy || leaving) return
    setBusy(true)
    const selection = child ? { agent: null, options: {} } : await leader.resolve()
    const made = await onSubmit({ projectId, ...card, leader: selection })
    // Pasted: the box is on its way out and stays shut (no second card from a key repeat or a double click).
    if (!made) {
      setBusy(false)
      input.current?.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    // Typed keys are the box's: the board's own (N, ⇧1, ⌥D …) skip events from inputs, and Esc stops here.
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const [first, ...rest] = text.split('\n')
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''
  const place: CSSProperties | undefined = at ? { left: at.x, top: at.y } : undefined

  return (
    <div className={styles.compose} style={place} data-placed={at !== undefined} data-testid="task-compose" data-no-pan="" data-own-keys="" data-leaving={leaving}>
      <div className={styles.field}>
        {/* The first line is Medium, the rest regular: a textarea has one weight, so the visible text is this mirror and
            the textarea above it carries only the caret and the selection. */}
        <div ref={mirror} className={styles.mirror} aria-hidden>
          {text === '' ? <span className={styles.placeholder}>{m.placeholder}</span> : <span className={styles.first}>{first}</span>}
          {rest.length > 0 && `\n${rest.join('\n')}`}
          {'\n'}
        </div>
        <textarea
          ref={input}
          className={styles.input}
          value={text}
          rows={1}
          disabled={busy}
          maxLength={TASK_LIMITS.body}
          aria-label={m.placeholder}
          data-testid="task-compose-input"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.row}>
        {!child && projects.length > 1 && (
          <Picker label={m.project} testId="task-compose-project" plain onClick={(el) => setProjectMenu(projectMenu ? null : el)}>
            <span className={styles.pickerText}>{projectName}</span>
          </Picker>
        )}
        {!child && <LeaderPickers state={leader} onClosed={focusInput} />}
        <button type="button" className={styles.submit} disabled={busy || leaving || splitCard(text) === null} data-testid="task-compose-submit" onClick={() => void submit()}>
          {m.paste}
        </button>
      </div>
      {/* The menu is portalled to <body>, but React still bubbles its events up through here: keep them off the canvas. */}
      <div className={styles.menuHost} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        {projectMenu && (
          <SheetMenu
            fit
            anchor={projectMenu}
            label={m.project}
            sections={() => [{ items: projects.map((p) => ({ value: p.id, label: p.name, icon: p.id === projectId ? <Check {...ICON} /> : null })) }]}
            selected={projectId}
            onPick={(value) => {
              setProjectId(value)
              setProjectMenu(null)
              focusInput()
            }}
            onClose={(refocus) => {
              setProjectMenu(null)
              if (refocus) focusInput()
            }}
          />
        )}
      </div>
    </div>
  )
}
