import { usageVendor } from '@shared/agents'
import { AlertCircle, Ellipsis, Folder, GitBranch, GitFork, Globe, PanelLeft, Paperclip, Play, Square, Workflow, X, type IconComponent } from '../ui/icons'
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { emptyQueue, wakesThisHour } from '@shared/dispatch'
import { useDispatch } from '../dispatch/store'
import { subscribeClock } from '../sidebar/clock'
import { isLeader } from '../state/workspace-model'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { useHooksHealth } from '../lifecycle/hooks-health'
import { useWorktreeCreations } from '../new-session/creation'
import { PANEL_VIEW_LABEL } from '../state/workspace-model'
import { pressRun, runAction, runSessionOf, useRepoScripts, useRunRunning, type RunAction } from '../scripts/run-script'
import { openSessionHeaderMenu, renameSession } from '../state/session-actions'
import { MAIN_WINDOW } from '@shared/window-layout'
import { useSessionView, useWorkspace, windowEffects, type PanelView } from '../state/workspace'
import { openSchedules } from '../schedules/store'
import { LoopBadge } from '../schedules/LoopBadge'
import { useRecordForSession } from '../issue-watch/store'
import { useOverviewStore } from '../overview/store'
import { openItem } from '../overview/github-store'
import { useSidebarCollapsed, useWindowKey } from '../state/window-scope'
import { useMainFullScreen } from '../app-shell/full-screen'
import { StatusGlyph } from '../ui/StatusGlyph'
import { IconButton } from '../ui/IconButton'
import { SessionMetaChips } from '../session-meta/MetaChips'
import { LimitResumeButton, useLimitResumeShown } from '../limit-resume/LimitResumeButton'
import { addFiles } from '../terminal/file-input'
import { readViewport } from '../terminal/registry'
import { ultracodeOnScreen } from '@shared/startup-screen'
import type { SessionId } from '@shared/types'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import { useSessionMeta } from '../session-meta/store'
import styles from './SessionHeader.module.css'
import { formatAccelerator } from '../ui/menu-model'
import { SHORTCUTS } from '@shared/shortcuts'

const M = defineMessages({
  zh: {
    showSidebar: '显示侧栏',
    leaderWakes: (n: number) => `leader · 本小时叫醒 ${n} 次`,
    openBoard: '打开看板 · ⇧⌘A',
    waiting: (n: number) => `${n} 个会话需要你`,
    dragTitle: '拖动到别的格或边上 · 双击重命名',
    scheduledBefore: '由定时任务「',
    scheduledAfter: '」开出',
    autoClaimed: (n: number) => `自动领取 #${n}`,
    autoClaimedTitle: '自动领取的 issue · 点击看详情',
    hooksTitle: 'hooks 不可用，状态只能按终端标题判断',
    hooks: '状态仅按标题判断',
    addFiles: '添加文件或文件夹',
    addFilesTitle: '添加文件或文件夹 · 也可以拖进终端，或 ⌘V 粘贴截图',
    rightPanel: '右侧栏',
    sessionMenu: '会话菜单',
    closePane: '关掉这一格',
    closePaneTitle: '关掉这一格，会话继续运行',
    runStart: '运行 run 脚本',
    runShow: '显示正在运行的 run',
    runStop: '停止 run 脚本',
    ultracode: 'Ultracode 开着：每个任务都编排多个 agent 并行做',
    sessionName: '会话名称',
    dispatchedTitle: (title: string) => `这个会话是「${title}」里的 agent 开的，它做完的结果会报告给那边 · 点击前往`,
    dispatchedBefore: '由「',
    dispatchedAfter: '」派出'
  },
  en: {
    showSidebar: 'Show sidebar',
    leaderWakes: (n: number) => `leader · woken ${n} ${n === 1 ? 'time' : 'times'} this hour`,
    openBoard: 'Open board · ⇧⌘A',
    waiting: (n: number) => (n === 1 ? '1 session needs you' : `${n} sessions need you`),
    dragTitle: 'Drag to another pane or an edge · double-click to rename',
    scheduledBefore: 'Started by scheduled task “',
    scheduledAfter: '”',
    autoClaimed: (n: number) => `Auto-claimed #${n}`,
    autoClaimedTitle: 'The issue Wavi claimed for this session · click for its details',
    hooksTitle: "Hooks unavailable: status can only be read from the terminal's title",
    hooks: 'Status from title only',
    addFiles: 'Add files or folders',
    addFilesTitle: 'Add files or folders · or drag them into the terminal, or paste a screenshot with ⌘V',
    rightPanel: 'Right panel',
    sessionMenu: 'Session menu',
    closePane: 'Close this pane',
    closePaneTitle: 'Close this pane; the session keeps running',
    runStart: 'Run the run script',
    runShow: 'Show the running run',
    runStop: 'Stop the run script',
    ultracode: 'Ultracode is on: every task is split across several agents working in parallel',
    sessionName: 'Session name',
    dispatchedTitle: (title: string) => `An agent in “${title}” started this session and reports its result there · click to go`,
    dispatchedBefore: 'Dispatched from “',
    dispatchedAfter: '”'
  }
})

/** Right panel switcher (Figma 13 "Pane switcher" 149:6398): one icon per view, the open one in Active. 终端 and iOS 模拟器 are in the … menu instead. */
const PANE_ICONS: { view: PanelView; icon: IconComponent }[] = [
  { view: 'browser', icon: Globe },
  { view: 'git', icon: GitBranch },
  { view: 'worktree', icon: GitFork },
  { view: 'files', icon: Folder }
]

/** A pane of the main area's split (PRD F20 · Figma 21 PaneHeader): one header per pane. */
export interface PaneChrome {
  /** The keyboard is in this pane: primary title, the paperclip and the right panel's icons. */
  focused: boolean
  /** The top-left pane: room for the traffic lights and the sidebar button when the sidebar is hidden. */
  lead: boolean
  /** Touches the window's top edge, so it is part of the window drag region. */
  top: boolean
  /** The × that closes only this pane (absent with a single pane). */
  onClose?: () => void
  /** A press on the session name, which drags the pane elsewhere. */
  onTitlePointerDown?: (e: PointerEvent<HTMLElement>) => void
}

/**
 * Which part of the header to draw. While the main window's right panel is open, the focused session's tools sit
 * above the panel at the window's right edge, where they are when it is closed (Figma 28G / 28H): its own header
 * keeps the title (and a split pane's ×), and the panel draws the tools part.
 */
export type SessionHeaderPart = 'full' | 'title' | 'tools'

/**
 * Figma component `SessionHeader` (11:86). Doubles as the window drag region. Without a `sessionId` it shows the
 * active session; in a split each pane has its own (`pane`).
 */
export function SessionHeader({ sessionId, pane, part: asked = 'full' }: { sessionId?: string; pane?: PaneChrome; part?: SessionHeaderPart } = {}) {
  const m = useMessages(M)
  const active = useSessionView(sessionId)
  const focused = pane?.focused ?? true
  const lead = pane?.lead ?? true
  const windowKey = useWindowKey()
  const sidebarCollapsed = useSidebarCollapsed() && lead
  // Full screen has no traffic lights, so the collapsed sidebar's button can sit on the terminal text's left edge.
  const fullScreen = useMainFullScreen() && windowKey === MAIN_WINDOW
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const waiting = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).length)
  const mostUrgent = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).sort(compareByUrgency)[0]?.status)
  // The overview is the main window's: from another window (F20 · 多窗口) that one comes forward.
  const openOverview = (): void => {
    if (windowKey !== MAIN_WINDOW) {
      useWorkspace.getState().focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    useWorkspace.getState().setMainView('overview')
  }
  const rightPanel = useWorkspace((s) => s.rightPanel)
  const overview = useWorkspace((s) => s.mainView === 'overview')
  const togglePanelView = useWorkspace((s) => s.togglePanelView)
  const part: SessionHeaderPart = asked === 'full' && focused && active && windowKey === MAIN_WINDOW && rightPanel !== null && !overview ? 'title' : asked
  const showTitle = part !== 'tools'
  const showTools = part !== 'title'
  const hooks = useHooksHealth(active?.session.id ?? null)
  const shellAgent = useSessionMeta((s) => (active ? s.bySession[active.session.id]?.agent : undefined))
  const limitResume = useLimitResumeShown(active?.session.id ?? '')
  // Inline rename from the … menu: the session being renamed (so switching sessions ends it).
  const [renaming, setRenaming] = useState<string | null>(null)
  // 会话 › 重命名会话 in the app menu: each new request starts renaming the active session.
  useEffect(
    () =>
      useWorkspace.subscribe((next, prev) => {
        if (next.renameRequest !== prev.renameRequest && next.activeSessionId) setRenaming(next.activeSessionId)
      }),
    []
  )
  // The worktree's `run` script (PRD F4): the button only exists when `.tr/settings.toml` has one.
  // A new worktree's folder appears after its session does: read again once it is there.
  const creating = useWorktreeCreations((s) => (active ? s.held[active.session.id] : undefined))
  const scripts = useRepoScripts(active?.worktree?.path, creating)
  const worktreeId = active?.worktree?.id
  const runSession = useWorkspace((s) => (worktreeId ? runSessionOf(s.sessions, worktreeId) : undefined))
  const running = useRunRunning(runSession?.id)
  // The right panel's switcher, and the 终端 / iOS 模拟器 entries of the … menu: the focused pane of the main window.
  const panelsInMenu = showTools && focused && active !== null && windowKey === MAIN_WINDOW
  const agentUp = active !== null && active.session.kind !== 'shell' && active.session.phase !== 'not-started' && active.session.phase !== 'exited'
  // The status is in the sidebar row already (F17 dropped the copy here); only a hooks problem is worth repeating.

  return (
    <header className={styles.header} data-region="session-header" data-part={part} data-sidebar-collapsed={sidebarCollapsed && showTitle} data-fullscreen={fullScreen} data-focused={focused} data-drag-region={pane?.top ?? true}>
      {showTitle && sidebarCollapsed && (
        <IconButton label={m.showSidebar} title={`${m.showSidebar} · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      {/* With the sidebar hidden nothing else says another session is waiting (B9). */}
      {showTitle && sidebarCollapsed && waiting > 0 && mostUrgent && (
        <button type="button" className={styles.waiting} title={m.openBoard} onClick={openOverview}>
          <span aria-hidden className={styles.waitingGlyph}>
            <StatusGlyph status={mostUrgent} />
          </span>
          {m.waiting(waiting)}
        </button>
      )}
      {active && showTitle && (
        <>
          {renaming === active.session.id ? (
            <TitleEditor
              key={active.session.id}
              initial={active.session.title}
              onDone={(value) => {
                if (value !== null) renameSession(active.session.id, value)
                setRenaming(null)
              }}
            />
          ) : (
            <h1
              className={styles.title}
              data-movable={pane?.onTitlePointerDown !== undefined}
              title={pane?.onTitlePointerDown ? m.dragTitle : undefined}
              onPointerDown={pane?.onTitlePointerDown}
              onDoubleClick={() => setRenaming(active.session.id)}
            >
              {active.session.title}
            </h1>
          )}
          {active.session.kind === 'claude' && active.session.ui !== 'gui' && <UltracodeBadge sessionId={active.session.id} />}
          {active.worktree?.branch && (
            <span className={styles.branch}>
              <GitBranch size={16} strokeWidth={1.75} />
              {active.worktree.branch}
            </span>
          )}
          {active.session.dispatchedBy && <DispatchedBy parentId={active.session.dispatchedBy} />}
          <LeaderMeta sessionId={active.session.id} />
          <LoopBadge sessionId={active.session.id} />
          {active.session.scheduledBy && (
            <button
              type="button"
              className={styles.dispatchedBy}
              onClick={() => openSchedules(active.session.scheduledBy?.id)}
              data-testid="scheduled-by"
            >
              {m.scheduledBefore}
              <span className={styles.dispatchedByName}>{active.session.scheduledBy.name}</span>
              {m.scheduledAfter}
            </button>
          )}
          {active.worktree && <AutoClaimed sessionId={active.session.id} projectId={active.worktree.projectId} />}
        </>
      )}
      {active && <span className={styles.spacer} />}
      {active && showTools && (
        <>
          {/* Figma 17A: todo · context · usage, after the branch and before the pane icons (PRD F11 / F12). */}
          {/* A plain terminal shows the agent started in it by hand, while it runs. */}
          {/* A GUI session shows context and usage under its composer instead (Figma 52F). */}
          <SessionMetaChips
            sessionId={active.session.id}
            vendor={active.session.kind === 'shell' ? shellAgent ?? null : usageVendor(active.session.kind)}
            meters={active.session.ui !== 'gui'}
          >
            {/* After the used-up UsageChip: type 继续 once the plan limit resets (PRD F11). */}
            {limitResume && <LimitResumeButton sessionId={active.session.id} />}
          </SessionMetaChips>
          {agentUp && hooks === 'unavailable' && (
            <span className={styles.hooks} data-testid="hooks-unavailable" title={m.hooksTitle}>
              <AlertCircle size={16} strokeWidth={1.75} />
              {m.hooks}
            </span>
          )}
        </>
      )}
      {/* Without a session there is no status to push the tools right. */}
      {!active && <span className={styles.spacer} />}
      <span className={styles.tools}>
        {/* The run script, paperclip and right panel act on the focused pane's session (PRD F20). */}
        {showTools && focused && active?.worktree && scripts?.scripts.run && (
          <RunButton
            action={runAction(running, runSession?.id === active.session.id)}
            command={scripts.scripts.run}
            port={scripts.port}
            onPress={(action) => {
              if (active.worktree) void pressRun(active.worktree, action)
            }}
          />
        )}
        {/* PRD F19: the files' paths go into the input line; the agent makes images attachments. */}
        {showTools && focused && active && (
          <IconButton
            label={m.addFiles}
            title={m.addFilesTitle}
            data-testid="add-files"
            onClick={() => {
              const id = active.session.id
              void window.tr.ui.pickFiles(active.worktree?.path).then((paths) => addFiles(id, paths))
            }}
          >
            <Paperclip size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        {/* The right panel is the main window's (F20 · 多窗口: not in other windows yet). */}
        {panelsInMenu && (
          <span className={styles.panes} role="group" aria-label={m.rightPanel}>
            {PANE_ICONS.map(({ view, icon: Icon }) => (
              <IconButton
                key={view}
                label={PANEL_VIEW_LABEL[view]}
                active={rightPanel === view}
                aria-pressed={rightPanel === view}
                onClick={() => togglePanelView(view)}
              >
                <Icon size={16} strokeWidth={1.75} />
              </IconButton>
            ))}
          </span>
        )}
        {active && (showTools || pane?.onClose) && (
          <IconButton
            label={m.sessionMenu}
            aria-haspopup="menu"
            active={panelsInMenu && (rightPanel === 'terminal' || rightPanel === 'simulator')}
            onClick={(e) => {
              const id = active.session.id
              void openSessionHeaderMenu(id, e.currentTarget, panelsInMenu).then((choice) => {
                if (choice === 'rename') setRenaming(id)
              })
            }}
          >
            <Ellipsis size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        {showTitle && pane?.onClose && (
          <IconButton label={m.closePane} title={`${m.closePaneTitle} · ${formatAccelerator(SHORTCUTS['close-pane'])}`} onClick={pane.onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </span>
    </header>
  )
}

/** Play starts the worktree's run script (or shows it while it runs elsewhere); in the run session itself, Square stops it. */
function RunButton({ action, command, port, onPress }: { action: RunAction; command: string; port: number | null; onPress(action: RunAction): void }) {
  const m = useMessages(M)
  const RUN_LABEL: Record<RunAction, string> = { start: m.runStart, show: m.runShow, stop: m.runStop }
  const firstLine = command.split('\n')[0] ?? ''
  const title = [RUN_LABEL[action], firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine, port !== null ? `TR_PORT ${port}` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <IconButton label={RUN_LABEL[action]} title={title} active={action !== 'start'} data-testid="run-script" onClick={() => onPress(action)}>
      {action === 'stop' ? <Square size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
    </IconButton>
  )
}

/** How often the shown Claude terminal's screen is read for its ultracode tag. */
const ULTRACODE_READ_MS = 1_500

/**
 * Figma 74D: Ultracode is on in this Claude terminal — the user turned it on there (/effort ultracode); Wavi never
 * does (PRD F25). Read from the TUI's prompt box border every 1.5 s while the header shows the session; a screen with
 * no prompt box keeps the last answer.
 */
function UltracodeBadge({ sessionId }: { sessionId: SessionId }) {
  const m = useMessages(M)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const read = (): void => {
      const seen = ultracodeOnScreen(readViewport(sessionId))
      if (seen !== null) setOn(seen)
    }
    read()
    const timer = setInterval(read, ULTRACODE_READ_MS)
    return () => clearInterval(timer)
  }, [sessionId])
  if (!on) return null
  return (
    <span className={styles.ultracode} data-testid="ultracode-badge" title={m.ultracode}>
      <Workflow size={14} strokeWidth={1.75} aria-hidden />
      Ultracode
    </span>
  )
}

/** The title as a text field: ↵ or leaving it saves, Esc cancels (IME composition keeps its own ↵ / Esc). */
function TitleEditor({ initial, onDone }: { initial: string; onDone(value: string | null): void }) {
  const m = useMessages(M)
  const [value, setValue] = useState(initial)
  const [done, setDone] = useState(false)
  const finish = (result: string | null) => {
    if (done) return
    setDone(true)
    onDone(result)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(null)
    }
  }
  return (
    <input
      className={styles.titleInput}
      aria-label={m.sessionName}
      value={value}
      maxLength={200}
      spellCheck={false}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(value)}
    />
  )
}

/** A project's leader (PRD F21 v1.198 · 花费, Figma 81E): how many times reports woke it in the last hour. */
function LeaderMeta({ sessionId }: { sessionId: SessionId }) {
  const leader = useWorkspace((s) => isLeader(s, sessionId))
  const queue = useDispatch((s) => s.queues[sessionId])
  const wakes = useSyncExternalStore(subscribeClock, () => wakesThisHour(queue ?? emptyQueue(), Date.now()))
  const m = useMessages(M)
  if (!leader) return null
  return (
    <span className={styles.leaderMeta} data-testid="leader-meta">
      {m.leaderWakes(wakes)}
    </span>
  )
}

/** 由「…」派出 (PRD F21): the session whose agent started this one; a click goes there. */
function DispatchedBy({ parentId }: { parentId: string }) {
  const m = useMessages(M)
  const title = useWorkspace((s) => s.sessions.find((x) => x.id === parentId)?.title)
  if (title === undefined) return null
  return (
    <button
      type="button"
      className={styles.dispatchedBy}
      title={m.dispatchedTitle(title)}
      onClick={() => useWorkspace.getState().setActiveSession(parentId)}
      data-testid="dispatched-by"
    >
      {m.dispatchedBefore}
      <span className={styles.dispatchedByName}>{title}</span>
      {m.dispatchedAfter}
    </button>
  )
}


/** 自动领取 #号 (PRD F26, Figma 102D): the issue this session was claimed for; a click opens its 77′C detail. */
function AutoClaimed({ sessionId, projectId }: { sessionId: SessionId; projectId: string }) {
  const m = useMessages(M)
  const record = useRecordForSession(sessionId)
  const root = useWorkspace((s) => s.projects.find((p) => p.id === projectId)?.rootPath ?? null)
  const windowKey = useWindowKey()
  if (!record) return null
  const open = (): void => {
    // The 看板 · GitHub tab is the main window's (as openOverview in the header).
    if (windowKey !== MAIN_WINDOW) {
      useWorkspace.getState().focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    useWorkspace.getState().setMainView('overview')
    useOverviewStore.getState().setTab('github')
    if (root) openItem(projectId, root, 'issue', record.number)
  }
  return (
    <button type="button" className={styles.dispatchedBy} onClick={open} title={m.autoClaimedTitle} data-testid="auto-claimed">
      {m.autoClaimed(record.number)}
    </button>
  )
}
