// A GUI session's input (PRD F23, Figma 65; `/` menu 49′C / 59H; formats 50C–E): one box — the formatted text
// (ComposerEditor) on top, under it + (attachments), the pickers (model, reasoning effort, 模式, 快速, the agent's own
// mode), and at the right the context ring (ContextButton) and stop while a turn runs, send otherwise. ⏎ sends and ⇧⏎
// is a newline — a new item in a list; in a code block ⏎ is a newline too (an input method's Enter is left to it).
// Formats are always on: there is no 格式 button, a selection gets the format buttons over it (50E).
// Before anything is said (`switchable`) the model menu lists the agents first, each with its models (Figma 65B).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowUp, Check, ChevronDown, ChevronRight, Gauge, ListTodo, Pencil, Plus, Shield, ShieldAlert, ShieldCheck, Square, Workflow, X, Zap } from '../ui/icons'
import { agentName, type CliAgent } from '@shared/agents'
import { guiAdapterOf } from '@shared/gui-agents'
import { matchCommands, type GuiCatalogResult, type GuiCommand, type GuiConfigOption } from '@shared/gui-chat'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind, SessionId } from '@shared/types'
import { installedAgents } from '../new-session/sheet-store'
import { openSettings } from '../settings/SettingsDialog'
import { useWorkspace } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { Toggle } from '../ui/Toggle'
import { ComposerEditor, insertNewline, type CaretContext } from './ComposerEditor'
import { ContextButton } from './ContextButton'
import {
  composerKey,
  guiAgentMenu,
  modeChanges,
  modelFamilies,
  pickCommand,
  pickerButtons,
  pickerSectionTitle,
  slashGroups,
  slashQuery,
  stepIndex,
  thumbnailUrl,
  type ModeChoice,
  type PickerButton,
  type SlashGroup,
  type Point,
} from './model'
import { addAttachments, draftOf, removeAttachment, setDraft, useGuiSessions } from './store'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: {
    defaultModel: '默认',
    attachments: '附件',
    addAttachment: '添加附件',
    ultracodeOn: 'Ultracode 开着：每个任务都编排多个 agent 并行做',
    ultracodeOff: 'Ultracode：每个任务都编排多个 agent 并行做',
    stop: '停止',
    stopTitle: '停止 ⎋',
    send: '发送',
    sendTitle: '发送 ↵',
    remove: (path: string) => `移除 ${path}`,
    commands: '命令',
    mode: '模式',
    model: '模型',
    loading: '加载中…',
    retry: '重试',
    agents: '智能体',
    notInstalled: '没装',
    modelsOf: (agent: string) => `${agent} 的模型`,
    afterAdapter: (adapter: string) => `装 ${adapter} 后可用`
  },
  en: {
    defaultModel: 'Default',
    attachments: 'Attachments',
    addAttachment: 'Add attachment',
    ultracodeOn: 'Ultracode is on: every task is split across several agents working in parallel',
    ultracodeOff: 'Ultracode: split every task across several agents working in parallel',
    stop: 'Stop',
    stopTitle: 'Stop ⎋',
    send: 'Send',
    sendTitle: 'Send ↵',
    remove: (path: string) => `Remove ${path}`,
    commands: 'Commands',
    mode: 'Mode',
    model: 'Model',
    loading: 'Loading…',
    retry: 'Retry',
    agents: 'Agents',
    notInstalled: 'Not installed',
    modelsOf: (agent: string) => `${agent} models`,
    afterAdapter: (adapter: string) => `Available after installing ${adapter}`
  }
})

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const SMALL = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Figma 65: each 模式 with its mark, on the button and in its list. */
const MODE_ICON: Record<ModeChoice, typeof Shield> = { ask: Shield, 'accept-edits': Pencil, auto: ShieldCheck, 'full-access': ShieldAlert, plan: ListTodo }

interface Props {
  sessionId: SessionId
  agent: AgentKind
  cwd: string
  busy: boolean
  commands: readonly GuiCommand[]
  config: readonly GuiConfigOption[]
  /** A card waits: with the composer empty, ⏎ / ⎋ / 1–9 / ↑↓ go to `cardKey` first (ChatPane). */
  cardWaiting: boolean
  /** Answers the waiting card from a key typed into the empty composer; true when the card took it. */
  cardKey(event: KeyboardEvent): boolean
  /** `from`: where the composer's first line was (Figma 98), for the message to fly from. */
  send(text: string, attachments: readonly string[], from?: Point): void
  interrupt(): void
  setConfig(optionId: string, value: string): Promise<unknown>
  /** Figma 65: nothing said yet — the agent can still change (the model menu lists the agents). */
  switchable: boolean
  /** Figma 65B: run another agent (with one of its models, when it listed them before). */
  switchAgent(agent: CliAgent, model: string | undefined): void
}

/** Figma 98: where the composer's first line starts on screen, for the message just sent to fly from. */
function firstLine(editor: Editor | null): Point | undefined {
  const rect = editor?.view.dom.firstElementChild?.getBoundingClientRect()
  return rect ? { x: rect.left, y: rect.top } : undefined
}

/** Figma 98D: 「回复」 comes back once the message has landed (--motion-duration-slide), fading in (--duration-fast). */
function holdPlaceholder(editor: Editor | null): void {
  if (!editor || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  requestAnimationFrame(() => {
    const css = getComputedStyle(document.documentElement)
    editor.view.dom.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], {
      pseudoElement: '::before',
      delay: parseFloat(css.getPropertyValue('--motion-duration-slide')) || 380,
      duration: parseFloat(css.getPropertyValue('--duration-fast')) || 120,
      easing: css.getPropertyValue('--ease-out').trim() || 'ease-out',
      fill: 'backwards',
    })
  })
}

export const Composer = memo(function Composer({ sessionId, agent, cwd, busy, commands, config, cardWaiting, cardKey, send, interrupt, setConfig, switchable, switchAgent }: Props) {
  const m = useMessages(M)
  const draft = useGuiSessions((s) => s.drafts[sessionId]) ?? draftOf(sessionId)
  const attachments = useGuiSessions((s) => s.attachments[sessionId]) ?? []
  const focusRequest = useGuiSessions((s) => s.focus[sessionId] ?? 0)
  const editorRef = useRef<Editor | null>(null)
  // The highlighted command, for the query it was moved in (a new query starts at the top).
  const [menuAt, setMenuAt] = useState<{ query: string | null; index: number }>({ query: null, index: 0 })
  const [menuDismissed, setMenuDismissed] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ button: PickerButton; anchor: HTMLElement } | null>(null)

  const query = slashQuery(draft)
  // Figma 59H: 命令, then Skills; ↑↓ go down the menu in that order.
  const groups = query !== null && query !== menuDismissed ? slashGroups(matchCommands(commands, query)) : []
  const matches = groups.flatMap((g) => g.commands)
  const menuOpen = matches.length > 0
  const menuIndex = menuAt.query === query ? menuAt.index : 0
  const setMenuIndex = (update: number | ((at: number) => number)): void =>
    setMenuAt({ query, index: typeof update === 'function' ? update(menuIndex) : update })
  const empty = draft.trim() === '' && attachments.length === 0
  const buttons = pickerButtons(config)
  // Before the agent reported its pickers: the model button still names the agent, so it can be switched.
  const shown: PickerButton[] = buttons.some(isModelButton) || !switchable ? buttons : [{ key: 'model', label: m.defaultModel, options: [] }, ...buttons]
  // The model option's own id (an ACP agent names it in its configOptions).
  const modelId = config.find((o) => o.category === 'model')?.id

  // Asked to take the keyboard (selected, a file added, text inserted): never from a dialog in front.
  useEffect(() => {
    if (focusRequest === 0) return
    const editor = editorRef.current
    if (!editor || editor.view.dom.ownerDocument.querySelector('[role="dialog"][aria-modal="true"]')) return
    editor.commands.focus('end', { scrollIntoView: false })
  }, [focusRequest])

  const submit = (): void => {
    if (empty) return
    send(draft, attachments, firstLine(editorRef.current))
    holdPlaceholder(editorRef.current)
  }
  const pick = (command: GuiCommand | undefined): void => {
    if (!command) return
    setDraft(sessionId, pickCommand(command))
    // After the editor took the new text: the caret goes after the command.
    requestAnimationFrame(() => editorRef.current?.commands.focus('end'))
  }

  const onKeyDown = (event: KeyboardEvent, caret: CaretContext): boolean => {
    // An empty composer gives the card above it its keys (ChatPane).
    if (cardWaiting && empty && !menuOpen && cardKey(event)) return true
    const { key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing } = event
    const action = composerKey({ key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing }, { menuOpen, busy, inCode: caret.inCode })
    const editor = editorRef.current
    switch (action) {
      case null:
        return false
      case 'newline':
        // ⏎ in a code block is the editor's (three in a row leave it).
        if (!editor || (caret.inCode && !shiftKey)) return false
        insertNewline(editor, caret)
        return true
      case 'send':
        submit()
        return true
      case 'stop':
        interrupt()
        return true
      case 'menu-up':
      case 'menu-down':
        setMenuIndex((at) => stepIndex(at, action === 'menu-up' ? -1 : 1, matches.length))
        return true
      case 'menu-pick':
        pick(matches[menuIndex])
        return true
      case 'menu-close':
        setMenuDismissed(query)
        return true
    }
  }

  const attach = (): void => {
    void window.tr.ui.pickFiles(cwd).then((paths) => addAttachments(sessionId, paths))
  }

  // 模式: the changes in order (leaving 计划 sends the level first, then plan off).
  const pickMode = async (choice: ModeChoice, planning: boolean): Promise<void> => {
    for (const [id, value] of modeChanges(choice, planning)) await setConfig(id, value)
  }

  const open = picker ? (shown.find((b) => b.key === picker.button.key) ?? picker.button) : null

  return (
    <div className={styles.composerWrap} data-testid="gui-composer">
      {menuOpen && <SlashMenu groups={groups} index={menuIndex} onHover={setMenuIndex} onPick={pick} />}
      <div className={styles.composer} data-testid="gui-composer-box">
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label={m.attachments}>
            {attachments.map((path) => (
              <Attachment key={path} path={path} remove={() => removeAttachment(sessionId, path)} />
            ))}
          </ul>
        )}
        <div className={styles.composerText}>
          <ComposerEditor
            draft={draft}
            onChange={(text) => {
              setDraft(sessionId, text)
              setMenuDismissed(null)
            }}
            onKeyDown={onKeyDown}
            editorRef={editorRef}
          />
        </div>
        <div className={styles.controls}>
          {/* The buttons leave the keyboard and the caret in the text. */}
          <button type="button" className={styles.barIcon} aria-label={m.addAttachment} title={m.addAttachment} onMouseDown={(e) => e.preventDefault()} onClick={attach}>
            <Plus {...ICON} />
          </button>
          {shown.map((button) =>
            button.toggle && button.options[0]?.category === 'ultracode' ? (
              // Ultracode (Figma 74A): named, since only its name says what it costs; pressed while on. Only the user
              // turns it on, for this session (PRD F25).
              <button
                key={button.key}
                type="button"
                className={styles.picker}
                aria-pressed={button.toggle.on}
                title={button.toggle.on ? m.ultracodeOn : m.ultracodeOff}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void setConfig(button.options[0]!.id, button.toggle!.on ? 'off' : 'on')}
              >
                {switchMark('ultracode', button.toggle.on)}
                <span>{button.label}</span>
              </button>
            ) : button.toggle ? (
              // 快速 (Figma 65): the mark only, pressed while on; the tooltip says why it is not taking effect.
              <button
                key={button.key}
                type="button"
                className={styles.pickerIcon}
                aria-label={button.label}
                title={button.hint ?? button.label}
                aria-pressed={button.toggle.on}
                data-hint={button.hint ? true : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void setConfig(button.options[0]!.id, button.toggle!.on ? 'off' : 'on')}
              >
                {switchMark('fast', button.toggle.on)}
              </button>
            ) : (
              <button
                key={button.key}
                type="button"
                className={styles.picker}
                aria-haspopup="dialog"
                aria-expanded={picker?.button.key === button.key}
                data-picker={button.key}
                onClick={(e) => {
                  const anchor = e.currentTarget
                  setPicker((at) => (at?.button.key === button.key ? null : { button, anchor }))
                }}
              >
                {buttonMark(button, agent)}
                <span>{button.label}</span>
                {/* Figma 78B: 快速 (solid ⚡), then Ultracode (workflow), after the 模式 while they are on. */}
                {button.switches?.map((s) =>
                  s.on ? (
                    <span key={s.option.id} className={styles.pickerOn} data-switch={s.option.category} role="img" aria-label={s.option.label}>
                      {switchMark(s.option.category, true)}
                    </span>
                  ) : null
                )}
                <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
              </button>
            )
          )}
          <span className={styles.spacer} />
          <ContextButton sessionId={sessionId} agent={agent} />
          {busy ? (
            <button type="button" className={styles.round} aria-label={m.stop} title={m.stopTitle} onClick={interrupt}>
              <Square {...ICON} />
            </button>
          ) : (
            <button type="button" className={styles.round} aria-label={m.send} title={m.sendTitle} disabled={empty} onClick={submit}>
              <ArrowUp {...ICON} />
            </button>
          )}
        </div>
      </div>
      {picker && open && (
        <PickerMenu
          button={open}
          anchor={picker.anchor}
          below={switchable}
          agent={agent}
          switchable={switchable}
          onPick={(optionId, value) => void setConfig(optionId, value)}
          onMode={(choice) => void pickMode(choice, open.mode?.current === 'plan')}
          onAgent={(next, model) => {
            setPicker(null)
            if (next === agent) {
              if (model && modelId) void setConfig(modelId, model)
            } else switchAgent(next, model)
          }}
          onClose={() => {
            picker.anchor.focus()
            setPicker(null)
          }}
        />
      )}
    </div>
  )
})

/** The model's button: its option, or the stand-in shown before the agent reported its pickers. */
const isModelButton = (button: PickerButton): boolean => (button.options.length === 0 ? button.key === 'model' : button.options[0]?.category === 'model')

/** What leads each picker button (Figma 65): the agent's mark on the model, a gauge on effort, the 模式's own mark. */
function buttonMark(button: PickerButton, agent: AgentKind): ReactNode {
  if (isModelButton(button)) return <AgentIcon kind={agent} size={14} />
  if (button.options[0]?.category === 'thought_level') return <Gauge {...SMALL} />
  if (button.mode) {
    const Mark = MODE_ICON[button.mode.current]
    return <Mark {...SMALL} />
  }
  return null
}

/** 快速's ⚡ (solid while on, the author 2026-11-08) and Ultracode's workflow mark (Figma 74A / 78). */
function switchMark(category: GuiConfigOption['category'], on: boolean): ReactNode {
  return category === 'ultracode' ? <Workflow {...SMALL} /> : <Zap {...SMALL} fill={on ? 'currentColor' : 'none'} />
}

/**
 * 50C: a picture as a 64 px thumbnail (× on hover), any other file — or a picture that cannot be read — as its name.
 * 71A / 71D: the same over a sent message's bubble, without ×.
 */
export function Attachment({ path, remove }: { path: string; remove?: () => void }) {
  const m = useMessages(M)
  const [broken, setBroken] = useState(false)
  const url = broken ? null : thumbnailUrl(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const button = remove && (
    <button type="button" className={styles.attachmentRemove} aria-label={m.remove(path)} onClick={remove}>
      <X size={12} strokeWidth={1.75} aria-hidden />
    </button>
  )
  if (url) {
    return (
      <li className={styles.thumb} title={path}>
        <img src={url} alt={name} draggable={false} onError={() => setBroken(true)} />
        {button}
      </li>
    )
  }
  return (
    <li className={styles.attachment} title={path} data-fixed={remove ? undefined : 'true'}>
      <span className={styles.attachmentName}>{name}</span>
      {button}
    </li>
  )
}

/**
 * 49′C / 59H: the agent's commands matching what follows `/`, under 命令 and Skills; each entry its name · argument
 * hint · description. ↑↓ move, ⏎ / ⇥ pick.
 */
function SlashMenu({ groups, index, onHover, onPick }: { groups: readonly SlashGroup[]; index: number; onHover(index: number): void; onPick(command: GuiCommand): void }) {
  const m = useMessages(M)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return (
    <div ref={listRef} className={`${styles.popover} ${styles.slashMenu}`} role="listbox" aria-label={m.commands} data-testid="gui-slash-menu">
      {groups.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className={styles.slashGroup} data-testid="gui-slash-group">
          <span className={styles.popoverTitle} aria-hidden>
            {group.title}
          </span>
          {group.commands.map((command, j) => {
            const i = group.start + j
            return (
              <div
                key={command.name}
                role="option"
                aria-selected={i === index}
                data-index={i}
                className={styles.command}
                onMouseEnter={() => onHover(i)}
                // Down, not click: the text area keeps the keyboard.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(command)
                }}
              >
                <span className={styles.commandName}>/{command.name}</span>
                {command.argumentHint && <span className={styles.commandHint}>{command.argumentHint}</span>}
                <span className={styles.commandText}>{command.description}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

interface PickerMenuProps {
  button: PickerButton
  anchor: HTMLElement
  /** Open under the button (the composer stands in the middle of an empty session), else over it. */
  below: boolean
  agent: AgentKind
  switchable: boolean
  onPick(optionId: string, value: string): void
  onMode(choice: ModeChoice): void
  onAgent(agent: CliAgent, model: string | undefined): void
  onClose(): void
}

/**
 * A picker's choices by its button, left-aligned with it. Model: before anything is said, the agents (Figma 65B) — the
 * hovered one's models beside the list; afterwards the agent's models under its name (65C). 模式: one list, each with
 * its mark (65E). Any other option is a list. ✓ on the current choice.
 */
function PickerMenu({ button, anchor, below, agent, switchable, onPick, onMode, onAgent, onClose }: PickerMenuProps) {
  const m = useMessages(M)
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    const host = menu?.offsetParent
    if (!menu || !host) return
    const box = anchor.getBoundingClientRect()
    const frame = host.getBoundingClientRect()
    setPlace(below ? { left: box.left - frame.left, top: box.bottom - frame.top + 4 } : { left: box.left - frame.left, bottom: frame.bottom - box.top + 4 })
    menu.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"], [role="menuitem"]')?.focus({ preventScroll: true })
  }, [anchor, below])

  useEffect(() => {
    const doc = anchor.ownerDocument
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    // ⎋ closes it wherever the keyboard is (the menu may not have it: a theme change, a click on its gap).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey, true)
    return () => {
      doc.removeEventListener('mousedown', onDown, true)
      doc.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  const option = button.options[0]
  const label = button.mode ? m.mode : option ? pickerSectionTitle(option) : m.model
  let body: ReactNode
  let families = false
  // 65B: the agents and the hovered one's models, two menus side by side.
  const pair = isModelButton(button) && switchable && agent !== 'shell'
  if (pair) {
    body = <AgentModels agent={agent} models={option?.values ?? []} current={option?.current} onAgent={onAgent} />
  } else if (button.mode) {
    const mode = button.mode
    body = (
      <div className={styles.pickerSection} role="menu" aria-label={m.mode}>
        {mode.choices.map((c) => {
          const Mark = MODE_ICON[c.value]
          return (
            <PickerRow
              key={c.value}
              checked={c.value === mode.current}
              mark={<Mark {...SMALL} />}
              label={c.label}
              onClick={() => {
                onMode(c.value)
                onClose()
              }}
            />
          )
        })}
        {/* Figma 78A: 快速 and Ultracode under a hairline, each with its switch; a switch leaves the menu open. */}
        {button.switches && button.switches.length > 0 && <div className={styles.menuDivider} role="separator" />}
        {button.switches?.map((s) => {
          const title = s.option.category === 'ultracode' ? (s.on ? m.ultracodeOn : m.ultracodeOff) : s.hint
          return (
            <label key={s.option.id} className={styles.pickerRow} title={title} data-hint={s.hint ? true : undefined}>
              {switchMark(s.option.category, s.on)}
              <span className={styles.pickerLabel}>{s.option.label}</span>
              {/* The switch carries the tooltip too, so it is there when the keyboard lands on it. */}
              <Toggle checked={s.on} label={s.option.label} title={title} onChange={(on) => onPick(s.option.id, on ? 'on' : 'off')} />
            </label>
          )
        })}
      </div>
    )
  } else if (option && option.category === 'model' && agent !== 'shell') {
    // 65C / 103C: the agent's models under its name, a row for each family; a family's versions in a column beside it.
    families = true
    body = (
      <FamilyColumns
        values={option.values}
        current={option.current}
        label={label}
        header={
          <span className={`${styles.popoverTitle} ${styles.agentTitle}`}>
            <AgentIcon kind={agent} size={14} />
            {agentName(agent)}
          </span>
        }
        onPick={(value) => {
          onPick(option.id, value)
          onClose()
        }}
      />
    )
  } else if (option) {
    body = (
      <div className={styles.pickerSection} role="menu" aria-label={label}>
        {option.values.map((v) => (
          <PickerRow
            key={v.value}
            checked={v.value === option.current}
            label={v.label}
            onClick={() => {
              onPick(option.id, v.value)
              onClose()
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={pair || families ? styles.pickerPair : `${styles.popover} ${styles.pickerMenu}`}
      data-below={below || undefined}
      role="dialog"
      aria-label={label}
      style={place ?? { visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // ↑ ↓ walk the column the focus is in (a family's versions are a column of their own).
          const active = e.currentTarget.ownerDocument.activeElement as HTMLElement
          const rows = [...((active.closest('[role="menu"]') ?? ref.current)?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"], [role="switch"]') ?? [])]
          const at = rows.indexOf(active)
          rows[stepIndex(at, e.key === 'ArrowDown' ? 1 : -1, rows.length)]?.focus()
          e.preventDefault()
        }
      }}
    >
      {body}
    </div>
  )
}

function PickerRow({ checked, mark, label, onClick }: { checked: boolean; mark?: ReactNode; label: string; onClick(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className={styles.pickerRow} onClick={onClick}>
      {mark}
      <span className={styles.pickerLabel}>{label}</span>
      {checked && <Check {...ICON} />}
    </button>
  )
}

/**
 * Figma 103C: a model list as one row per family, showing the family's newest version (or the current one, when it is an
 * older version of that family, with its ✓). A family with versions to choose from ends in › and opens them in a column
 * beside it — on hover or →, aligned with its row (← returns), headed by the family's name; the row itself picks what it
 * shows. The versions' column is out of the flow (beside the host), so opening it never changes the menu's size.
 */
function FamilyColumns({ values, current, label, header, testId, onPick }: { values: readonly { value: string; label: string }[]; current: string | undefined; label: string; header?: ReactNode; testId?: string; onPick(value: string): void }) {
  const families = useMemo(() => modelFamilies(values), [values])
  const [open, setOpen] = useState<string | null>(null)
  const [drop, setDrop] = useState(0)
  const column = useRef<HTMLDivElement>(null)
  const flyout = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLElement>())
  const enter = useRef(false)
  const family = families.find((f) => f.key === open)

  // The versions' column starts level with its row; a row so far down that it would stand out under the first column's
  // foot moves up (to the top at most).
  useLayoutEffect(() => {
    const row = open ? rows.current.get(open) : undefined
    const first = column.current
    const second = flyout.current
    if (!row || !first || !second) return
    setDrop(Math.max(0, Math.min(row.offsetTop - first.offsetTop - first.scrollTop, first.offsetHeight - second.offsetHeight)))
    if (enter.current) {
      enter.current = false
      second.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus()
    }
  }, [open])

  return (
    <div className={styles.familyHost}>
      <div ref={column} className={`${styles.popover} ${styles.pickerColumn}`} role="menu" aria-label={label} data-testid={testId}>
        {header}
        {families.map((f) => {
          const shown = f.versions.find((v) => v.value === current) ?? f.versions[0]!
          const several = f.versions.length > 1
          return (
            <button
              key={f.key}
              ref={(el) => {
                if (el) rows.current.set(f.key, el)
                else rows.current.delete(f.key)
              }}
              type="button"
              role="menuitemradio"
              aria-checked={shown.value === current}
              aria-haspopup={several ? 'menu' : undefined}
              aria-expanded={several ? open === f.key : undefined}
              className={styles.pickerRow}
              onMouseEnter={() => setOpen(several ? f.key : null)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' || !several) return
                e.preventDefault()
                if (open === f.key) flyout.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus()
                else {
                  enter.current = true
                  setOpen(f.key)
                }
              }}
              onClick={() => onPick(shown.value)}
            >
              <span className={styles.pickerLabel}>{shown.label}</span>
              {shown.value === current && <Check {...ICON} />}
              {several && <ChevronRight {...SMALL} />}
            </button>
          )
        })}
      </div>
      {family && (
        <div
          ref={flyout}
          className={`${styles.popover} ${styles.versionsColumn}`}
          style={{ top: drop }}
          role="menu"
          aria-label={family.name}
          data-testid={testId && `${testId}-versions`}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft') return
            e.preventDefault()
            rows.current.get(family.key)?.focus()
          }}
        >
          <span className={styles.popoverTitle} data-testid={testId && `${testId}-versions-title`}>
            {family.name}
          </span>
          {family.versions.map((v) => (
            <PickerRow key={v.value} checked={v.value === current} label={v.label} onClick={() => onPick(v.value)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Figma 65B: the agents an empty session can run — installed ones (› their models), Pi-like ones whose GUI needs an
 * adapter (their models show; a pick opens 设置 · 智能体 for it), then 没装 in grey. The hovered agent's models stand
 * beside the list: the current agent's as it reports them; another's as it listed them in a session before, else as
 * main asks it without a conversation (catalog.ts, as T3 Code / Paseo) — 加载中 meanwhile, the reason and 重试 if it
 * could not say, just its default for an agent that only lists models in a session.
 */
function AgentModels({ agent, models, current, onAgent }: { agent: AgentKind; models: readonly { value: string; label: string }[]; current: string | undefined; onAgent(agent: CliAgent, model: string | undefined): void }) {
  const m = useMessages(M)
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [hovered, setHovered] = useState<CliAgent | null>(agent === 'shell' ? null : agent)
  const [asked, setAsked] = useState<Partial<Record<CliAgent, GuiCatalogResult | 'loading'>>>({})
  const picks = useWorkspace((s) => s.guiPicks)
  useEffect(() => {
    let live = true
    void installedAgents().then((next) => live && setFound(next))
    return () => {
      live = false
    }
  }, [])
  const { installed, adapter, missing } = guiAgentMenu(found)

  const probe = useCallback((id: CliAgent) => {
    void window.tr.gui
      .models(id)
      .catch((error: unknown): GuiCatalogResult => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }))
      .then((result) => {
        setAsked((at) => ({ ...at, [id]: result }))
        // Kept (as T3 Code keeps its catalog on disk) unless a session of it listed its own ids since.
        if (result.ok && useWorkspace.getState().guiPicks[id]?.modelsFrom !== 'live') {
          useWorkspace.getState().rememberGuiPicks(id, { models: result.catalog.models, modelsFrom: 'probe' })
        }
      })
  }, [])
  // Every installed agent but the running one, asked once the menu opens (main keeps answers a few minutes).
  const toAsk = [...installed, ...adapter].filter((id) => id !== agent).join(',')
  useEffect(() => {
    for (const id of toAsk ? (toAsk.split(',') as CliAgent[]) : []) probe(id)
  }, [toAsk, probe])

  const needsAdapter = hovered !== null && adapter.includes(hovered)
  // Not answered yet (asked as the menu opened, or again by 重试): 加载中.
  const answer = hovered ? (asked[hovered] ?? (hovered !== agent && toAsk.split(',').includes(hovered) ? 'loading' : undefined)) : undefined
  const catalog = answer && answer !== 'loading' && answer.ok ? answer.catalog : undefined
  const listed = hovered === agent ? models : (hovered ? picks[hovered]?.models : undefined) ?? catalog?.models ?? []
  const chosen = hovered === agent ? current : hovered ? (picks[hovered]?.model ?? catalog?.current) : undefined
  const pick = (id: CliAgent, model: string | undefined) => (needsAdapter ? openSettings('agents', id) : onAgent(id, model))
  const agentRow = (id: CliAgent) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={hovered === id}
      className={styles.pickerRow}
      onMouseEnter={() => setHovered(id)}
      onFocus={() => setHovered(id)}
      onClick={() => setHovered(id)}
    >
      <AgentIcon kind={id} size={14} />
      <span className={styles.pickerLabel}>{agentName(id)}</span>
      <ChevronRight {...SMALL} />
    </button>
  )
  let body: ReactNode
  if (!hovered) body = null
  else if (listed.length > 0) body = null
  else if (answer === 'loading') body = <span className={styles.popoverTitle} data-testid="gui-agent-models-loading">{m.loading}</span>
  else if (answer && !answer.ok && 'reason' in answer)
    body = (
      <>
        <span className={styles.popoverTitle}>{answer.reason}</span>
        <button
          type="button"
          role="menuitem"
          className={styles.pickerRow}
          onClick={() => {
            setAsked((at) => ({ ...at, [hovered]: 'loading' }))
            probe(hovered)
          }}
        >
          <span className={styles.pickerLabel}>{m.retry}</span>
        </button>
      </>
    )
  else body = <PickerRow checked={false} label={m.defaultModel} onClick={() => pick(hovered, undefined)} />
  const adapterName = needsAdapter ? guiAdapterOf(hovered) : null

  return (
    <>
      <div className={`${styles.popover} ${styles.pickerColumn}`} role="menu" aria-label={m.agents} data-testid="gui-agent-menu">
        {installed.map(agentRow)}
        {adapter.map(agentRow)}
        {missing.length > 0 && (
          <>
            <span className={styles.menuDivider} role="separator" />
            <span className={styles.popoverTitle}>{m.notInstalled}</span>
            {missing.map((id) => (
              <button key={id} type="button" role="menuitem" className={styles.pickerRow} data-muted onMouseEnter={() => setHovered(null)} onClick={() => openSettings('agents', id)}>
                <AgentIcon kind={id} size={14} />
                <span className={styles.pickerLabel}>{agentName(id)}</span>
              </button>
            ))}
          </>
        )}
      </div>
      {hovered && listed.length > 0 && (
        // 103C: the hovered agent's models as families, a family's versions in a third column.
        <FamilyColumns
          key={hovered}
          values={listed}
          current={chosen}
          label={m.modelsOf(agentName(hovered))}
          testId="gui-agent-models"
          header={adapterName ? <span className={styles.popoverTitle}>{m.afterAdapter(adapterName)}</span> : undefined}
          onPick={(value) => pick(hovered, value)}
        />
      )}
      {hovered && listed.length === 0 && (
        <div className={`${styles.popover} ${styles.pickerColumn}`} role="menu" aria-label={m.modelsOf(agentName(hovered))} data-testid="gui-agent-models">
          {/* Amp without amp-acp: its models, and a pick opens 设置 · 智能体 where the adapter's install command is. */}
          {adapterName && <span className={styles.popoverTitle}>{m.afterAdapter(adapterName)}</span>}
          {body}
        </div>
      )}
    </>
  )
}
