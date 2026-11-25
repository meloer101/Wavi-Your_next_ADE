// Settings content (Figma 07 · 设置 · 外观), shown inside SettingsDialog over the main window.
import { useRef, type KeyboardEvent } from 'react'
import { Bot, Command, Gauge, GitBranch, MessageSquare, Palette, Smartphone, SquareTerminal, Workflow, X, type IconComponent } from '../ui/icons'
import { create } from 'zustand'
import { defineMessages } from '@shared/i18n'
import { IconButton } from '../ui/IconButton'
import { useMessages } from '../ui/i18n'
import { AgentsPane } from './AgentsPane'
import { AppearancePane } from './AppearancePane'
import { AutomationPane } from './AutomationPane'
import { ChatPane } from './ChatPane'
import { PhonePane } from './PhonePane'
import { ShortcutsPane } from './ShortcutsPane'
import { TerminalPane } from './TerminalPane'
import { UsagePane } from './UsagePane'
import { useSettings } from './useSettings'
import { WorktreePane } from './WorktreePane'
import styles from './SettingsApp.module.css'

// 通用 comes back with its content; an empty "即将推出" pane is a dead end (B11). The version and 检查更新
// moved from 关于 to the sidebar's 更新 (Figma 36G, PRD v1.93). 外观 / 终端 / 对话 are three pages (Figma 66): the
// window, the CLI sessions' terminal, the GUI sessions' chat. 快捷键 lists every shortcut (Figma 97E, PRD v1.210).
export type SettingsPaneId = 'appearance' | 'terminal' | 'chat' | 'agents' | 'usage' | 'worktree' | 'automation' | 'phone' | 'shortcuts'
type PaneId = SettingsPaneId

/** The pane on show; openSettings('usage') (the sidebar's 额度, ⇧⌘U) sets it. */
export const useSettingsPane = create<{ pane: PaneId }>()(() => ({ pane: 'appearance' }))
const setPane = (pane: PaneId) => useSettingsPane.setState({ pane })

const M = defineMessages({
  zh: {
    settings: '设置',
    close: '关闭设置（Esc）',
    nav: { appearance: '外观', terminal: '终端', chat: '对话', agents: '智能体', usage: '额度', worktree: 'Worktree', automation: '自动化', phone: '手机', shortcuts: '快捷键' }
  },
  en: {
    settings: 'Settings',
    close: 'Close settings (Esc)',
    nav: { appearance: 'Appearance', terminal: 'Terminal', chat: 'Chat', agents: 'Agents', usage: 'Usage', worktree: 'Worktree', automation: 'Automation', phone: 'Phone', shortcuts: 'Shortcuts' }
  }
})

const NAV: ReadonlyArray<{ id: PaneId; Icon: IconComponent }> = [
  { id: 'appearance', Icon: Palette },
  { id: 'terminal', Icon: SquareTerminal },
  { id: 'chat', Icon: MessageSquare },
  { id: 'agents', Icon: Bot },
  { id: 'usage', Icon: Gauge },
  { id: 'worktree', Icon: GitBranch },
  { id: 'automation', Icon: Workflow },
  { id: 'phone', Icon: Smartphone },
  { id: 'shortcuts', Icon: Command }
]

export function SettingsApp({ onClose }: { onClose(): void }) {
  const { settings, loaded, updateAppearance, updatePorts, updateReview, updateArchive, updateAlerts, updatePr, updateDispatch, updateRemote, updateSchedules, updatePower } = useSettings()
  const pane = useSettingsPane((s) => s.pane)
  const items = useRef(new Map<PaneId, HTMLButtonElement>())
  const m = useMessages(M)

  const onNavKeyDown = (event: KeyboardEvent): void => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = NAV.findIndex((item) => item.id === pane)
    const next = NAV[(index + delta + NAV.length) % NAV.length]
    if (!next) return
    setPane(next.id)
    items.current.get(next.id)?.focus()
  }

  return (
    <div className={styles.window}>
      <nav className={styles.nav} aria-label={m.settings}>
        <h1 className={styles.title}>{m.settings}</h1>
        <div className={styles.items} role="tablist" aria-orientation="vertical" onKeyDown={onNavKeyDown}>
          {NAV.map(({ id, Icon }) => (
            <button
              key={id}
              ref={(node) => {
                if (node) items.current.set(id, node)
                else items.current.delete(id)
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={pane === id}
              aria-controls="settings-pane"
              tabIndex={pane === id ? 0 : -1}
              className={styles.item}
              onClick={() => setPane(id)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{m.nav[id]}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className={styles.content} id="settings-pane" role="tabpanel" aria-labelledby={`tab-${pane}`} data-loaded={loaded}>
        <div className={styles.closeBar}>
          <IconButton label={m.close} onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
        {pane === 'appearance' && loaded && <AppearancePane appearance={settings.appearance} update={updateAppearance} />}
        {pane === 'terminal' && loaded && <TerminalPane appearance={settings.appearance} update={updateAppearance} />}
        {pane === 'chat' && loaded && <ChatPane appearance={settings.appearance} update={updateAppearance} />}
        {pane === 'worktree' && loaded && <WorktreePane
            base={settings.ports.base}
            update={(base) => updatePorts({ base })}
            archiveAfterMerge={settings.archive.afterMerge}
            updateArchiveAfterMerge={(afterMerge) => updateArchive({ afterMerge })}
          />}
        {pane === 'automation' && loaded && (
          <AutomationPane
            review={settings.review}
            update={updateReview}
            pr={settings.pr}
            updatePr={updatePr}
            dispatch={settings.dispatch}
            updateDispatch={updateDispatch}
            schedules={settings.schedules}
            updateSchedules={updateSchedules}
            power={settings.power}
            updatePower={updatePower}
          />
        )}
        {pane === 'phone' && loaded && <PhonePane remote={settings.remote} update={updateRemote} />}
        {pane === 'agents' && <AgentsPane />}
        {pane === 'shortcuts' && <ShortcutsPane />}
        {pane === 'usage' && <UsagePane alerts={loaded ? settings.alerts : null} updateAlerts={updateAlerts} />}
      </main>
    </div>
  )
}
