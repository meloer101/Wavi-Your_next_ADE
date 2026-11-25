// 「贴一张」 (N · PRD F9 v1.250, Figma 116B): a 320-wide note at the middle of the view. The text grows to six lines
// and then scrolls; Enter pastes it, ⇧Enter starts a new line, Esc drops it. The first line is the title (drawn Medium),
// the rest is the body. Below: the project (only with more than one), the card's leader (Claude Code, Codex or
// 暂不派发) and 「贴上」. The leader menu is the new-session sheet's menu.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { agentName, CLI_AGENTS } from '@shared/agents'
import { canLead, leaderBlock, type DispatchAgent, type LeaderCheck } from '@shared/dispatch'
import { defineMessages } from '@shared/i18n'
import { TASK_LIMITS } from '@shared/task-board'
import type { Project, ProjectId } from '@shared/types'
import { SheetMenu, type SheetMenuSection } from '../new-session/SheetMenu'
import { AgentIcon } from '../ui/AgentIcon'
import { useMessages } from '../ui/i18n'
import { Check, ChevronDown } from '../ui/icons'
import { splitCard } from './model'
import { useTaskBoard, type LeaderChoice } from './store'
import styles from './Compose.module.css'

const M = defineMessages({
  zh: { placeholder: '任务标题', project: '项目', leader: '主理人', none: '暂不派发', paste: '贴上', missing: '没装' },
  en: { placeholder: 'Task title', project: 'Project', leader: 'Leader', none: 'Do not dispatch', paste: 'Paste', missing: 'Not installed' }
})

/** The agents that can lead a card (`canLead`), in the menu's order. */
const LEADER_KINDS: readonly DispatchAgent[] = CLI_AGENTS.filter((id) => canLead(id))
const LINE = 20
const MAX_LINES = 6

export interface ComposeResult {
  projectId: ProjectId
  title: string
  body: string
  leader: LeaderChoice
}

interface Props {
  projects: readonly Pick<Project, 'id' | 'name'>[]
  initialProject: ProjectId
  /** Resolves true when the card was made; false keeps the box (main refused it). */
  onSubmit(result: ComposeResult): Promise<boolean>
  onCancel(): void
  /** The card was pasted: the box shrinks away (200 ms) before it is removed. */
  leaving?: boolean
}

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function Compose({ projects, initialProject, onSubmit, onCancel, leaving = false }: Props) {
  const m = useMessages(M)
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState(initialProject)
  const [leader, setLeader] = useState(() => useTaskBoard.getState().leaderChoice)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ kind: 'project' | 'leader'; anchor: HTMLElement } | null>(null)
  const [found, setFound] = useState<Record<string, boolean> | null>(null)
  const [check, setCheck] = useState<LeaderCheck | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    let cancelled = false
    void window.tr.app
      .detectAgents()
      .then((next) => !cancelled && setFound(next as unknown as Record<string, boolean>))
      .catch(() => {})
    void window.tr.dispatch
      .leaderCheck()
      .then((next) => !cancelled && setCheck(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Grows with the text up to six lines, then scrolls; the mirror behind it follows the scroll.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, LINE * MAX_LINES)}px`
  }, [text])

  const submit = async (): Promise<void> => {
    const card = splitCard(text)
    if (!card || busy) return
    setBusy(true)
    const made = await onSubmit({ projectId, ...card, leader })
    setBusy(false)
    if (!made) input.current?.focus()
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

  const choose = (choice: LeaderChoice): void => {
    setLeader(choice)
    useTaskBoard.getState().setLeaderChoice(choice)
  }
  const closeMenu = (refocus: boolean): void => {
    setMenu(null)
    if (refocus) input.current?.focus()
  }
  const toggle = (kind: 'project' | 'leader', anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })

  const leaderSections = (): SheetMenuSection[] => [
    {
      items: LEADER_KINDS.map((id) => {
        const blocked = leaderBlock(id, 'cli', check) ?? (found && found[id] === false ? m.missing : null)
        const meta = blocked ?? undefined
        return { value: id, label: agentName(id), icon: leader === id ? <Check {...ICON} /> : <AgentIcon kind={id} size={12} />, ...(meta ? { meta, disabled: true } : {}) }
      })
    },
    { items: [{ value: 'none', label: m.none, icon: leader === 'none' ? <Check {...ICON} /> : <span className={styles.noMark} /> }] }
  ]
  const projectSections = (): SheetMenuSection[] => [{ items: projects.map((p) => ({ value: p.id, label: p.name, icon: p.id === projectId ? <Check {...ICON} /> : null })) }]

  const [first, ...rest] = text.split('\n')
  const leaderLabel = leader === 'none' ? m.none : agentName(leader)
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''

  return (
    <div className={styles.compose} data-testid="task-compose" data-no-pan="" data-leaving={leaving}>
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
        {projects.length > 1 && (
          <Picker label={m.project} testId="task-compose-project" plain onClick={(el) => toggle('project', el)}>
            <span className={styles.pickerText}>{projectName}</span>
          </Picker>
        )}
        <Picker label={m.leader} testId="task-compose-leader" onClick={(el) => toggle('leader', el)}>
          {leader !== 'none' && <AgentIcon kind={leader} size={12} />}
          <span className={styles.pickerText}>{leaderLabel}</span>
        </Picker>
        <span className={styles.spacer} />
        <button type="button" className={styles.submit} disabled={busy || splitCard(text) === null} data-testid="task-compose-submit" onClick={() => void submit()}>
          {m.paste}
        </button>
      </div>
      {/* The menu is portalled to <body>, but React still bubbles its events up through here: keep them off the canvas. */}
      <div className={styles.menuHost} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {menu && (
          <SheetMenu
            anchor={menu.anchor}
            label={menu.kind === 'leader' ? m.leader : m.project}
            sections={menu.kind === 'leader' ? leaderSections : projectSections}
            selected={menu.kind === 'leader' ? leader : projectId}
            onPick={(value) => {
              if (menu.kind === 'leader') choose(value === 'none' ? 'none' : (LEADER_KINDS.find((id) => id === value) ?? leader))
              else setProjectId(value)
              closeMenu(true)
            }}
            onClose={closeMenu}
          />
        )}
      </div>
    </div>
  )
}

function Picker({ label, testId, plain, onClick, children }: { label: string; testId: string; plain?: boolean; onClick(anchor: HTMLElement): void; children: ReactNode }) {
  return (
    <button type="button" className={plain ? `${styles.picker} ${styles.plain}` : styles.picker} aria-label={label} aria-haspopup="listbox" data-testid={testId} onClick={(e) => onClick(e.currentTarget)}>
      {children}
      <ChevronDown {...ICON} />
    </button>
  )
}
