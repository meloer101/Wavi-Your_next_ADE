// 看板 (PRD F9 v1.184 · Figma 77): two tabs over the main area, the terminals mounted behind it. 进度 is the status
// board (Figma 11v2-C / D): a card opens the session's own terminal in an overlay; ↑↓ move · Space opens / closes ·
// ↵ enter · Esc closes, then leaves. ⌘ / ⇧ click picks sessions for a batch action (BatchBar); 一题多解 groups sit
// above the columns and open the overlay with their members side by side. GitHub lists each project's open issues and
// PRs (GitHubBoard). The list view and its in-place terminal were removed in v1.184.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, PanelLeft, RefreshCw, Search } from '../ui/icons'
import { rangeBetween, togglePicked } from '@shared/batch-actions'
import { useShallow } from 'zustand/react/shallow'
import { needsAttention } from '@shared/session-status'
import { orderVendors } from '@shared/session-meta'
import type { SessionId } from '@shared/types'
import { defineMessages } from '@shared/i18n'
import { useLang, useMessages } from '../ui/i18n'
import { subscribeClock } from '../sidebar/clock'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { Segmented } from '../ui/Segmented'
import { StatusGlyph } from '../ui/StatusGlyph'
import { TERMINAL_HOST_SELECTOR } from './BorrowedTerminal'
import { PortTags } from '../panels/browser/PortTags'
import { TurnChecksTag } from '../turn-checks/TurnChecksTag'
import { UsageChip, useMetaNow, useUsageList } from '../session-meta/MetaChips'
import metaStyles from '../session-meta/SessionMeta.module.css'
import { buildOverview, moveSelection, orderedIds, overviewSummary, type OverviewGroup, type OverviewRow } from './model'
import { layoutIds } from './pane-layout'
import { SessionOverlay } from './SessionOverlay'
import { BatchBar } from './BatchBar'
import { AttemptGroups } from '../attempts/AttemptGroups'
import { DispatchGroups } from '../dispatch/DispatchGroups'
import { GitHubBoard } from './GitHubBoard'
import { TaskBoard } from '../tasks/TaskBoard'
import { TasksSummary } from '../tasks/TasksSummary'
import { githubSummary } from './github-model'
import { refreshGitHub, useGitHubBoard } from './github-store'
import { CardMembers, MembersContext, MembersNowContext, useBoardMembers } from './CardMembers'
import { enterSession, useOverviewStore, type BoardTab } from './store'
import styles from './Overview.module.css'
import { formatAccelerator } from '../ui/menu-model'
import { SHORTCUTS } from '@shared/shortcuts'

const ICON = { size: 16, strokeWidth: 1.75 } as const

const TICK_MS = 15_000

const NONE = new Set<never>()

/** The sessions picked for a batch action; cards draw a check while any is picked. */
const Picked = createContext<ReadonlySet<SessionId>>(new Set())

const M = defineMessages({
  zh: {
    progress: '进度',
    tasks: '任务',
    showSidebar: '显示侧栏',
    board: '看板',
    refresh: '刷新',
    filterProgress: '过滤  p:项目  s:状态',
    filterGitHub: '过滤  #编号  标签',
    filterTasks: '过滤  标题  #编号  p:项目',
    filterSessions: '过滤会话',
    filterItems: '过滤 issue 和 PR',
    filterNotes: '过滤任务',
    sessions: '会话',
    noSessions: '还没有会话。打开一个项目，在侧栏的项目上点 ＋ 新建会话。',
    noMatch: (filter: string) => `没有匹配“${filter}”的会话。`,
    picked: '已选'
  },
  en: {
    progress: 'Progress',
    tasks: 'Tasks',
    showSidebar: 'Show sidebar',
    board: 'Board',
    refresh: 'Refresh',
    filterProgress: 'Filter  p:project  s:status',
    filterGitHub: 'Filter  #number  label',
    filterTasks: 'Filter  title  #number  p:project',
    filterSessions: 'Filter sessions',
    filterItems: 'Filter issues and PRs',
    filterNotes: 'Filter tasks',
    sessions: 'Sessions',
    noSessions: 'No sessions yet. Open a project, then click ＋ on it in the sidebar to start a session.',
    noMatch: (filter: string) => `No sessions match “${filter}”.`,
    picked: 'Selected'
  }
})

const tabs = (m: (typeof M)['zh']): ReadonlyArray<{ value: BoardTab; label: string }> => [
  { value: 'progress', label: m.progress },
  { value: 'tasks', label: m.tasks },
  { value: 'github', label: 'GitHub' }
]

/** "Now" on the shared 15 s clock, so "已等 3m" keeps counting without re-rendering on every frame. */
function useClockNow(): number {
  return useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / TICK_MS) * TICK_MS)
}

export function Overview() {
  const m = useMessages(M)
  // The cards' text (status, time, summary) is built in the memo below: it follows the language.
  const lang = useLang()
  const { projects, worktrees, sessions, sidebarCollapsed, toggleSidebar, setMainView } = useWorkspace(
    useShallow((s) => ({
      projects: s.projects,
      worktrees: s.worktrees,
      sessions: s.sessions,
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      setMainView: s.setMainView
    }))
  )
  const now = useClockNow()
  const { tab, selectedId, layout, filter, picked, pickAnchor, setTab, select, openOverlay, closePane, setFilter, setPicked } = useOverviewStore()
  const github = useGitHubBoard(useShallow((g) => ({ loading: Object.values(g.byRoot).some((p) => p?.loading), summary: githubSummary(g.byRoot) })))
  const bodyRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(
    () => buildOverview({ projects, worktrees, sessions, now, filter: tab === 'progress' ? filter : '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang: the cards' text follows the interface language
    [projects, worktrees, sessions, filter, now, tab, lang]
  )
  const ids = useMemo(() => orderedIds(groups, NONE), [groups])
  // Archived worktrees' sessions are not on 看板 (PRD F15).
  const shown = useMemo(() => {
    const archived = new Set(worktrees.filter((w) => w.archived).map((w) => w.id))
    return sessions.filter((s) => !archived.has(s.worktreeId))
  }, [sessions, worktrees])
  const attention = shown.filter((s) => needsAttention(s.status)).length
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const members = useBoardMembers(shown)
  const onBoard = useMemo(() => new Set(ids), [ids])
  // The members' clicks go through the latest onCardClick without making the context value change on every render.
  const cardClick = useRef<(id: SessionId, e: MouseEvent) => void>(() => undefined)
  const openMember = useCallback((id: SessionId, e: MouseEvent) => cardClick.current(id, e), [])
  const focusBoard = useCallback(() => bodyRef.current?.focus(), [])
  const membersValue = useMemo(() => ({ ...members, onBoard, open: openMember, focusBoard }), [members, onBoard, openMember, focusBoard])
  const paneIds = useMemo(() => (layout ? layoutIds(layout) : []), [layout])

  // Keep a selection that exists; default to the first card so ↵ / Space work right away.
  useEffect(() => {
    if (selectedId === null || !ids.includes(selectedId)) select(ids[0] ?? null)
  }, [ids, selectedId, select])
  // A session that was closed or filtered out takes its overlay tile with it.
  useEffect(() => {
    for (const id of paneIds) if (!rows.some((r) => r.session.id === id)) closePane(id)
  }, [paneIds, rows, closePane])
  // A picked session that was closed or filtered out leaves the batch.
  useEffect(() => {
    const kept = picked.filter((id) => ids.includes(id))
    if (kept.length !== picked.length) setPicked(kept)
  }, [ids, picked, setPicked])
  const pickedSet = useMemo(() => new Set(picked), [picked])
  // Opened on a comparison (一题多解), the overlay keeps the keyboard it took.
  useEffect(() => {
    if (!useOverviewStore.getState().layout) bodyRef.current?.focus()
  }, [])
  useEffect(() => {
    if (selectedId) bodyRef.current?.querySelector(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const closeOverlay = () => {
    openOverlay(null)
    bodyRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    // Keys typed in a session's terminal are the session's — Esc included, which agents use to interrupt or
    // decline. The overlays handle their own keys.
    if (target.closest(TERMINAL_HOST_SELECTOR) || target.closest('[role="dialog"]')) return
    const inText = target.closest('input, textarea') !== null
    if (e.key === 'Escape') {
      e.preventDefault()
      if (layout) openOverlay(null)
      else if (picked.length > 0 && !inText) setPicked([])
      else if (inText && filter) setFilter('')
      else setMainView('session')
      bodyRef.current?.focus()
      return
    }
    if (e.key === '/' && !inText) {
      e.preventDefault()
      filterRef.current?.focus()
      return
    }
    // GitHub's rows are buttons: Tab, ↵ and Space are theirs.
    if (tab !== 'progress') return
    if (inText && !(e.target === filterRef.current && (e.key === 'ArrowDown' || e.key === 'Enter'))) return
    // Space / ↵ on a tab or a card's buttons keep their own meaning.
    if ((e.key === ' ' || e.key === 'Enter') && target.closest('button') !== null) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      select(moveSelection(ids, selectedId, e.key === 'ArrowDown' ? 1 : -1))
      if (inText) bodyRef.current?.focus()
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault()
      enterSession(selectedId)
    } else if (e.key === ' ' && selectedId) {
      e.preventDefault()
      openOverlay(selectedId)
    }
  }

  const onCardClick = (id: SessionId, e: MouseEvent) => {
    // ⌘ toggles one session in the batch, ⇧ picks the range from the last one clicked (F9 批量操作).
    if (e.metaKey || e.shiftKey) {
      setPicked(e.shiftKey ? [...new Set([...picked, ...rangeBetween(ids, pickAnchor ?? selectedId, id)])] : togglePicked(picked, id), id)
      select(id)
      bodyRef.current?.focus()
      return
    }
    useOverviewStore.setState({ pickAnchor: id })
    // A click opens the session's terminal in the overlay; 进入会话 / ↵ / a double-click go there.
    openOverlay(id)
    bodyRef.current?.focus()
  }

  useEffect(() => {
    cardClick.current = onCardClick
  })
  return (
    <Picked.Provider value={pickedSet}>
      <MembersContext.Provider value={membersValue}>
      <MembersNowContext.Provider value={now}>
      <div className={styles.overview} data-region="overview" data-glass-card="" data-tab={tab} onKeyDown={onKeyDown}>
        <header className={styles.header} data-sidebar-collapsed={sidebarCollapsed}>
          {sidebarCollapsed && (
            <IconButton label={m.showSidebar} title={`${m.showSidebar} · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
              <PanelLeft {...ICON} />
            </IconButton>
          )}
          <h1 className={styles.title}>{m.board}</h1>
          <Segmented label={m.board} variant="outline" semantics="tab" value={tab} options={tabs(m)} onChange={setTab} />
          <span className={styles.summary}>{tab === 'progress' ? overviewSummary(shown, attention) : tab === 'tasks' ? <TasksSummary /> : github.summary}</span>
          <span className={styles.spacer} />
          {tab === 'progress' ? (
            <PlanUsage />
          ) : tab === 'github' ? (
            <IconButton label={m.refresh} title={m.refresh} disabled={github.loading} onClick={() => refreshGitHub(true)}>
              <RefreshCw {...ICON} />
            </IconButton>
          ) : null}
          <label className={styles.filter}>
            <Search {...ICON} />
            <input
              ref={filterRef}
              type="search"
              value={filter}
              placeholder={tab === 'progress' ? m.filterProgress : tab === 'tasks' ? m.filterTasks : m.filterGitHub}
              aria-label={tab === 'progress' ? m.filterSessions : tab === 'tasks' ? m.filterNotes : m.filterItems}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </header>
        {tab === 'tasks' ? (
          <div ref={bodyRef} className={styles.body} data-view="tasks" tabIndex={-1}>
            <TaskBoard />
          </div>
        ) : tab === 'github' ? (
          <div ref={bodyRef} className={styles.body} data-view="github" tabIndex={-1}>
            <GitHubBoard filter={filter} />
          </div>
        ) : (
          <div
            ref={bodyRef}
            className={styles.body}
            data-view="board"
            tabIndex={-1}
            role="listbox"
            aria-label={m.sessions}
            aria-activedescendant={selectedId ? `overview-row-${selectedId}` : undefined}
          >
            {sessions.length > 0 && !filter && <AttemptGroups />}
            {sessions.length > 0 && !filter && <DispatchGroups />}
            {sessions.length === 0 ? (
              <p className={styles.empty}>{m.noSessions}</p>
            ) : (
              <div className={styles.board}>
                {groups.map((g) => (
                  <BoardColumn key={g.key} group={g} selectedId={selectedId} onClick={onCardClick} />
                ))}
              </div>
            )}
            {sessions.length > 0 && ids.length === 0 && filter && <p className={styles.empty}>{m.noMatch(filter)}</p>}
          </div>
        )}
        {tab === 'progress' && picked.length > 0 && (
          <BatchBar
            ids={picked}
            onClear={() => {
              setPicked([])
              bodyRef.current?.focus()
            }}
            onSettled={() => bodyRef.current?.focus()}
          />
        )}
        {/* The board's overlay; also 一题多解's comparison. */}
        {layout && (
          <SessionOverlay layout={layout} rows={rows} candidates={rows.filter((r) => !paneIds.includes(r.session.id))} onClose={closeOverlay} />
        )}
      </div>
      </MembersNowContext.Provider>
      </MembersContext.Provider>
    </Picked.Provider>
  )
}

/** Figma 17C PlanUsage: one UsageChip per vendor with data, each opening the same popover. */
function PlanUsage() {
  const all = useUsageList()
  const now = useMetaNow()
  const vendors = orderVendors(all, null, now)
  if (vendors.length === 0) return null
  return (
    <span className={metaStyles.planUsage} data-testid="plan-usage">
      {vendors.map((usage, i) => (
        // A clicked usage notification opens the panel from the first chip (it lists every vendor).
        <UsageChip key={usage.vendor} usage={usage} current={null} all={all} opensOnRequest={i === 0} />
      ))}
    </span>
  )
}

interface RowProps {
  row: OverviewRow
  selected: boolean
  onClick(id: SessionId, e: MouseEvent): void
}

function BoardColumn({ group, selectedId, onClick }: { group: OverviewGroup; selectedId: SessionId | null; onClick(id: SessionId, e: MouseEvent): void }) {
  return (
    <section className={styles.column} aria-label={group.label}>
      <div className={styles.columnHeader}>
        <h2>{group.label}</h2>
        <span className={styles.count}>{group.rows.length}</span>
      </div>
      {group.rows.map((row) => (
        <StatusCard key={row.session.id} row={row} selected={row.session.id === selectedId} onClick={onClick} />
      ))}
    </section>
  )
}

/** StatusCard (104:286): a borderless status-colored block; status is also the glyph's shape and the column. */
function StatusCard({ row, selected, onClick }: RowProps) {
  const id = row.session.id
  const picked = useContext(Picked)
  return (
    <div
      id={`overview-row-${id}`}
      className={styles.card}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-session-id={id}
      data-card={row.card}
      data-picked={picked.has(id)}
      onClick={(e) => onClick(id, e)}
      onDoubleClick={(e) => !e.metaKey && !e.shiftKey && enterSession(id)}
    >
      <span className={styles.cardHead}>
        {picked.size > 0 && <PickMark picked={picked.has(id)} />}
        <StatusGlyph status={row.status} />
        <span className={styles.cardTitle}>{row.title}</span>
        <span className={styles.cardMeta} data-emphasis={row.timeEmphasis}>
          {row.time}
        </span>
      </span>
      {row.where && <span className={styles.cardWhere}>{row.where}</span>}
      {row.summary && <span className={styles.cardSummary}>{row.summary}</span>}
      {row.session.status === 'done_unread' && <TurnChecksTag sessionId={id} />}
      <PortTags sessionId={id} />
      {row.stat && <span className={styles.cardStat}>{row.stat}</span>}
      <CardMembers sessionId={id} />
    </div>
  )
}

/** Picked for a batch action: a check (shape, not color), and its place kept empty for the rows not picked. */
function PickMark({ picked }: { picked: boolean }) {
  const m = useMessages(M)
  return (
    <span className={styles.pick} data-testid="pick-mark" title={picked ? m.picked : undefined} aria-label={picked ? m.picked : undefined}>
      {picked && <Check size={14} strokeWidth={2} aria-hidden />}
    </span>
  )
}
