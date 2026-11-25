import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Clock, Folder, Gauge, LayoutList, ListTree, PanelLeft, Plus, Search, SlidersHorizontal } from '../ui/icons'
import { useShallow } from 'zustand/react/shallow'
import { MAIN_WINDOW, shownIn } from '@shared/window-layout'
import { shownEverywhere, useWorkspace, windowEffects } from '../state/workspace'
import { usePaneView, useSecondaryWindow, useWindowKey } from '../state/window-scope'
import { pressSession } from '../split/drag'
import {
  closeSessionsInteractive,
  newSessionInProject,
  openPickedSessionsMenu,
  openProjectInteractive,
  openProjectMenu,
  openSessionContextMenu
} from '../state/session-actions'
import { IconButton } from '../ui/IconButton'
import { popupMenu, type MenuAnchor } from '../ui/menu'
import { NavItem } from './NavItem'
import { UpdateEntry } from './UpdateEntry'
import { openCommandPalette } from '../command-palette'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { toggleOverview } from '../overview/store'
import { StatusGlyph } from '../ui/StatusGlyph'
import { openSettings } from '../settings/SettingsDialog'
import { openSchedules } from '../schedules/store'
import { ProjectHeader } from './ProjectHeader'
import { SelectionDrops } from './SelectionDrop'
import { SessionRow } from './SessionRow'
import { FoldRow } from './FoldRow'
import { SubagentRow } from './SubagentRow'
import { useSessionMeta } from '../session-meta/store'
import { useDispatch } from '../dispatch/store'
import type { SubagentInfo } from '@shared/agent-events'
import type { SessionId } from '@shared/types'
import { adjacentSessionId, buildSidebarGroups, pendingItems, pickSessions, teamItems, topLevelChunks, visibleSessionIds, workflowItems, type SideItem } from './model'
import { dispatchAncestors } from '@shared/session-group'
import type { WorkflowRun } from '@shared/workflow-run'
import type { TeamState } from '@shared/agent-team'
import './shortcuts-runtime'
import styles from './Sidebar.module.css'
import { formatAccelerator } from '../ui/menu-model'
import { SHORTCUTS } from '@shared/shortcuts'
import { defineMessages, pick } from '@shared/i18n'
import { useLang, useMessages } from '../ui/i18n'

const ICON = { size: 16, strokeWidth: 1.75 } as const

const M = defineMessages({
  zh: {
    group: '分组',
    byProject: '项目',
    byStatus: '状态',
    groupSessions: '会话分组',
    hideSidebar: '隐藏侧栏',
    nav: '导航',
    openProject: '打开项目…',
    jumpTo: '跳转到…',
    board: '看板',
    waiting: (n: number) => `${n} 个会话需要你`,
    usage: '额度',
    newSession: '新建会话',
    noProjects: '还没有项目',
    schedules: '定时任务',
    settings: '设置'
  },
  en: {
    group: 'Group by',
    byProject: 'Project',
    byStatus: 'Status',
    groupSessions: 'Group sessions',
    hideSidebar: 'Hide sidebar',
    nav: 'Navigation',
    openProject: 'Project',
    jumpTo: 'Jump to…',
    board: 'Board',
    waiting: (n: number) => (n === 1 ? '1 session needs you' : `${n} sessions need you`),
    usage: 'Usage',
    newSession: 'New session',
    noProjects: 'No projects yet',
    schedules: 'Schedule',
    settings: 'Settings'
  }
})

/** The titlebar's 会话分组 button (Figma 53C): 项目 or 状态, kept in the workspace file. */
async function chooseGroupBy(anchor: Element): Promise<void> {
  const current = useWorkspace.getState().sidebarGroupBy
  const m = pick(M)
  const choice = await popupMenu(
    [
      { type: 'header', label: m.group },
      { type: 'item', id: 'project', label: m.byProject, checked: current === 'project' },
      { type: 'item', id: 'status', label: m.byStatus, checked: current === 'status' }
    ],
    anchor
  )
  if (choice === 'project' || choice === 'status') useWorkspace.getState().setSidebarGroupBy(choice)
}

/**
 * Status sidebar — Figma screens 01 / 02 / 08. Pure view over the workspace store. In a project's own window
 * (F20 · 多窗口) it lists only that project; the row of the session the keyboard is in, in this window, is selected.
 */
export function Sidebar() {
  const m = useMessages(M)
  // Row text (phase lines, 已完成 · …, team lines) is built in the memos below: they follow the language.
  const lang = useLang()
  const windowKey = useWindowKey()
  const scope = useSecondaryWindow()?.projectId ?? null
  const {
    projects: allProjects,
    worktrees,
    sessions,
    collapsedProjectIds,
    groupBy,
    collapsedStatusGroups,
    expandedGroups,
    leaderSessions,
    setActiveSession,
    toggleSidebar,
    toggleProjectCollapsed,
    toggleStatusGroupCollapsed,
    toggleGroupExpanded,
    mainOverview
  } =
    useWorkspace(
      useShallow((s) => ({
        projects: s.projects,
        worktrees: s.worktrees,
        sessions: s.sessions,
        collapsedProjectIds: s.collapsedProjectIds,
        groupBy: s.sidebarGroupBy,
        collapsedStatusGroups: s.collapsedStatusGroups,
        expandedGroups: s.expandedGroups,
        toggleGroupExpanded: s.toggleGroupExpanded,
        leaderSessions: s.leaderSessions,
        toggleStatusGroupCollapsed: s.toggleStatusGroupCollapsed,
        setActiveSession: s.setActiveSession,
        toggleSidebar: s.toggleSidebar,
        toggleProjectCollapsed: s.toggleProjectCollapsed,
        mainOverview: s.mainView === 'overview'
      }))
    )
  const overview = windowKey === MAIN_WINDOW && mainOverview
  const paneView = usePaneView()
  const activeSessionId = paneView.activeSessionId
  // The sessions this window's panes show: each has a glass block under its row (Figma 37B).
  const inPanes = useMemo(() => (overview ? [] : shownIn(paneView)), [overview, paneView])
  const projects = useMemo(() => (scope === null ? allProjects : allProjects.filter((p) => p.id === scope)), [allProjects, scope])
  // Sessions shown anywhere (PRD F20); those in another window only get the 1px outline, this window's have blocks.
  const shown = useWorkspace((s) => shownEverywhere(s).join('\n'))
  // The overview belongs to the main window: from another window, that one comes forward.
  const onOverview = useCallback(() => {
    if (windowKey !== MAIN_WINDOW) {
      useWorkspace.getState().focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    toggleOverview()
  }, [windowKey])
  const listRef = useRef<HTMLDivElement>(null)
  const onRowPress = useCallback((e: PointerEvent<HTMLElement>, id: string) => pressSession(e, id, 'sidebar'), [])

  // Only the subagent lists: the context readings that change every second elsewhere in session-meta do not rebuild rows.
  const subagentLists = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, SubagentInfo[]> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.subagents) out[id] = metrics.subagents
      return out
    })
  )
  // Figma 74D: Claude's workflow runs hang under their session before its subagents; a run's row folds its phases.
  const runLists = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, WorkflowRun[]> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.workflows) out[id] = metrics.workflows
      return out
    })
  )
  // Figma 82′F: Claude's agent team under its lead (PRD §6.20).
  const teams = useSessionMeta(
    useShallow((s) => {
      const out: Record<string, TeamState> = {}
      for (const [id, metrics] of Object.entries(s.bySession)) if (metrics.team) out[id] = metrics.team
      return out
    })
  )
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleRun = useCallback((rowId: string) => {
    const key = rowId.slice('workflow:'.length)
    setFolded((now) => {
      const next = new Set(now)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])
  // Figma 83B: the sessions a `wavi run` asked for hang under the session that asked until the user answers.
  const confirms = useDispatch((s) => s.confirms)
  const subagents = useMemo(() => {
    const out: Record<string, SideItem[]> = { ...subagentLists }
    for (const [id, runs] of Object.entries(runLists)) {
      const unread = sessions.find((s) => s.id === id)?.status === 'done_unread'
      const lines = workflowItems(runs, { unread, folded })
      if (lines.length > 0) out[id] = [...lines, ...(subagentLists[id] ?? [])]
    }
    for (const [id, team] of Object.entries(teams)) {
      const lines = teamItems(team)
      if (lines.length > 0) out[id] = [...lines, ...(out[id] ?? [])]
    }
    for (const [id, waiting] of Object.entries(pendingItems(confirms.flatMap((c) => (c.kind === 'start' ? [c] : []))))) out[id] = [...waiting, ...(out[id] ?? [])]
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang: the lines' text follows the interface language
  }, [subagentLists, runLists, sessions, folded, confirms, teams, lang])
  const groups = useMemo(
    () => buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds, subagents, groupBy, collapsedStatusGroups, expandedGroups, ...(leaderSessions ? { leaderSessions } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang: the rows' text follows the interface language
    [projects, worktrees, sessions, collapsedProjectIds, subagents, groupBy, collapsedStatusGroups, expandedGroups, leaderSessions, lang]
  )
  // Sessions above the selected one: a group holding the selection is tinted (Figma 111I). In 按状态 children are flat rows.
  const selectionAbove = useMemo(
    () => (groupBy === 'status' || activeSessionId === null ? [] : dispatchAncestors(sessions, activeSessionId)),
    [groupBy, sessions, activeSessionId]
  )
  const ids = useMemo(() => visibleSessionIds(groups), [groups])
  // Rows picked with ⇧ / ⌘ click (issue #6), closed together after one confirmation. A closed or folded row drops out.
  const [picks, setPicks] = useState<{ ids: readonly SessionId[]; anchor: SessionId | null }>({ ids: [], anchor: null })
  const picked = useMemo(() => {
    const listed = new Set(ids)
    return picks.ids.filter((id) => listed.has(id))
  }, [picks.ids, ids])
  const pickedSet = useMemo(() => new Set(picked), [picked])
  // Folding a group or closing a row takes it out of the pick for good, so unfolding does not bring it back
  // (adjusted while rendering, React's pattern for state that follows other state).
  if (picked.length !== picks.ids.length) setPicks((p) => ({ ...p, ids: picked }))
  // Read by the row handlers, which stay the same functions so the memoized rows do not redraw on every store change.
  const latest = useRef({ ids, activeSessionId, picked })
  useLayoutEffect(() => {
    latest.current = { ids, activeSessionId, picked }
  })
  const onPick = useCallback((id: SessionId, how: 'range' | 'toggle') => {
    const { ids: ordered, activeSessionId: active, picked: now } = latest.current
    setPicks((p) => ({ ids: pickSessions({ ordered, picked: now, anchor: p.anchor, active, id, how }), anchor: id }))
  }, [])
  const onRowSelect = useCallback(
    (id: SessionId) => {
      setPicks({ ids: [], anchor: id })
      setActiveSession(id)
    },
    [setActiveSession]
  )
  const closePicked = useCallback(async (ids: readonly SessionId[], anchor?: MenuAnchor) => {
    const closed = await (anchor ? openPickedSessionsMenu(ids, anchor) : closeSessionsInteractive(ids))
    if (closed) setPicks({ ids: [], anchor: null })
  }, [])
  const onRowContextMenu = useCallback(
    (id: SessionId, anchor: MenuAnchor) => {
      const now = latest.current.picked
      if (now.length > 1 && now.includes(id)) void closePicked(now, anchor)
      else void openSessionContextMenu(id, anchor)
    },
    [closePicked]
  )
  const waiting = useMemo(() => sessions.filter((s) => needsAttention(s.status)).sort(compareByUrgency), [sessions])
  // Roving tabindex: the selected row if it is listed, else the first one.
  const tabStopId = activeSessionId !== null && ids.includes(activeSessionId) ? activeSessionId : (ids[0] ?? null)

  const onListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Esc drops any pick; ⌫ / ⌦ close a pick of two or more, as the right-click menu does (PRD v1.197 ③).
      if (picked.length > 0 && e.key === 'Escape') {
        e.preventDefault()
        setPicks((p) => ({ ...p, ids: [] }))
        return
      }
      if (picked.length > 1 && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault()
        void closePicked(picked)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const focusedId = (e.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? null
      const next = adjacentSessionId(groups, focusedId ?? activeSessionId, e.key === 'ArrowDown' ? 1 : -1)
      if (!next) return
      e.preventDefault()
      setActiveSession(next)
      listRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(next)}"]`)?.focus()
    },
    [groups, activeSessionId, setActiveSession, picked, closePicked]
  )

  return (
    <>
      <div className={styles.titlebar}>
        {/* Native traffic lights (hiddenInset, x=16 y=17) sit over this gap. */}
        <div className={styles.trafficLights} aria-hidden />
        <IconButton label={m.groupSessions} aria-haspopup="menu" onClick={(e) => void chooseGroupBy(e.currentTarget)}>
          <ListTree {...ICON} />
        </IconButton>
        <IconButton label={m.hideSidebar} title={`${m.hideSidebar} · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
          <PanelLeft {...ICON} />
        </IconButton>
      </div>
      <nav className={styles.nav} aria-label={m.nav}>
        <NavItem icon={<Folder {...ICON} />} label={m.openProject} shortcut={formatAccelerator(SHORTCUTS['open-project'])} onClick={() => void openProjectInteractive()} />
        <NavItem icon={<Search {...ICON} />} label={m.jumpTo} shortcut={formatAccelerator(SHORTCUTS['command-palette'])} onClick={openCommandPalette} />
        <NavItem
          icon={<LayoutList {...ICON} />}
          label={m.board}
          shortcut={formatAccelerator(SHORTCUTS['toggle-overview'])}
          selected={overview}
          title={waiting.length > 0 ? `${m.waiting(waiting.length)} · ${formatAccelerator(SHORTCUTS['toggle-overview'])}` : `${m.board} · ${formatAccelerator(SHORTCUTS['toggle-overview'])}`}
          badge={
            waiting[0] && (
              <>
                <StatusGlyph status={waiting[0].status} />
                {waiting.length}
              </>
            )
          }
          onClick={onOverview}
        />
        <NavItem icon={<Clock {...ICON} />} label={m.schedules} shortcut={formatAccelerator(SHORTCUTS['open-schedules'])} onClick={() => openSchedules()} />
      </nav>
      <div className={styles.sessions} ref={listRef} onKeyDown={onListKeyDown}>
        <SelectionDrops ids={inPanes} />
        {groups.map((group) => (
          <section key={group.id} className={styles.group} aria-label={group.title}>
            {group.kind === 'status' ? (
              // A status group (Figma 53C): the project header's look, without ＋ and ….
              <ProjectHeader
                name={group.title}
                count={group.sessionCount}
                collapsed={group.collapsed}
                attention={group.attention}
                onToggle={() => group.status && toggleStatusGroupCollapsed(group.status)}
              />
            ) : (
              <ProjectHeader
                name={group.title}
                count={group.sessionCount}
                collapsed={group.collapsed}
                attention={group.attention}
                onToggle={() => toggleProjectCollapsed(group.id)}
                onNewSession={() => newSessionInProject(group.id)}
                onMenu={(anchor) => void openProjectMenu(group.id, anchor)}
              />
            )}
            {topLevelChunks(group.rows).map((chunk) => {
              const main = chunk[0]!
              const body = chunk.map((row) => (
                <Fragment key={row.session.id}>
                  <SessionRow
                    row={row}
                    selected={!overview && row.session.id === activeSessionId}
                    shown={!overview && !inPanes.includes(row.session.id) && shown.split('\n').includes(row.session.id)}
                    picked={pickedSet.has(row.session.id)}
                    onPick={onPick}
                    onPress={onRowPress}
                    tabStop={row.session.id === tabStopId}
                    onSelect={onRowSelect}
                    onContextMenu={onRowContextMenu}
                  />
                  {row.fold && <FoldRow row={row.fold} onToggle={toggleGroupExpanded} />}
                  {row.after?.map((sub) => <SubagentRow key={sub.id} row={sub} onSelect={setActiveSession} onToggle={toggleRun} />)}
                </Fragment>
              ))
              // One box per session with members, so the selection can cover the whole group (PRD v1.243).
              return main.fold ? (
                <div
                  key={main.session.id}
                  className={styles.groupBox}
                  data-group-of={main.session.id}
                  data-member-selected={!overview && selectionAbove.includes(main.session.id)}
                >
                  {body}
                </div>
              ) : (
                <Fragment key={main.session.id}>{body}</Fragment>
              )
            })}
            {group.kind === 'project' && !group.collapsed && group.sessionCount === 0 && (
              <button type="button" className={styles.newSession} aria-haspopup="dialog" onClick={() => newSessionInProject(group.id)}>
                <Plus {...ICON} />
                {m.newSession}
              </button>
            )}
          </section>
        ))}
        {groups.length === 0 && projects.length === 0 && <p className={styles.empty}>{m.noProjects}</p>}
        {/* 按状态 with no sessions yet: no project header offers ＋, so this row does (the sheet picks the project). */}
        {groups.length === 0 && projects[0] && (
          <button type="button" className={styles.newSession} aria-haspopup="dialog" onClick={() => newSessionInProject(projects[0]!.id)}>
            <Plus {...ICON} />
            {m.newSession}
          </button>
        )}
      </div>
      <div className={styles.footer}>
        <UpdateEntry />
        <NavItem icon={<Gauge {...ICON} />} label={m.usage} shortcut={formatAccelerator(SHORTCUTS['open-usage'])} onClick={() => openSettings('usage')} />
        <NavItem icon={<SlidersHorizontal {...ICON} />} label={m.settings} shortcut={formatAccelerator(SHORTCUTS.settings)} onClick={() => openSettings()} />
      </div>
    </>
  )
}
