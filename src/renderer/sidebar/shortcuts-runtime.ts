// Binds the pure sidebar shortcuts to the workspace store. Installed once at module load
// (imported by Sidebar.tsx) so ⌘1–9 / ⌘J keep working while the sidebar is collapsed.
import type { SessionId } from '@shared/types'
import { MAIN_WINDOW, type WindowKey } from '@shared/window-layout'
import { everyWindow } from '../app-shell/windows-runtime'
import { noteKeyCommand } from '../state/key-commands'
import { useWorkspace, windowEffects } from '../state/workspace'
import { dispatchAncestors } from '@shared/session-group'
import { buildSidebarGroups, nextAttentionSessionId, sessionForShortcut } from './model'
import { installSidebarShortcuts } from './shortcuts'
import { toggleOverview } from '../overview/store'

/** The sidebar of window `key` as it is now: a project window lists only its project (F20 · 多窗口). */
function groupsNow(key: WindowKey) {
  const { projects, worktrees, sessions, collapsedProjectIds, sidebarGroupBy, collapsedStatusGroups, expandedGroups, windows } = useWorkspace.getState()
  const scope = windows.find((w) => w.key === key)?.projectId ?? null
  const listed = scope === null ? projects : projects.filter((p) => p.id === scope)
  return buildSidebarGroups({ projects: listed, worktrees, sessions, collapsedProjectIds, groupBy: sidebarGroupBy, collapsedStatusGroups, expandedGroups })
}

/** ⌘J: the next session that needs the user, if any. */
export function jumpToNextAttention(): SessionId | null {
  const { sessions, activeSessionId, sidebarGroupBy } = useWorkspace.getState()
  const id = nextAttentionSessionId(sessions, activeSessionId)
  if (id) {
    // A folded member that needs the user opens every group above it, so the row it lands on is drawn (PRD v1.243).
    if (sidebarGroupBy !== 'status') useWorkspace.getState().expandGroups(dispatchAncestors(sessions, id))
    useWorkspace.getState().setActiveSession(id)
  }
  return id
}

const dispose = everyWindow((win, key) =>
  installSidebarShortcuts(win, {
    selectNth(n) {
      const id = sessionForShortcut(groupsNow(key), n)
      if (id) useWorkspace.getState().setActiveSession(id)
      return id
    },
    selectNextAttention() {
      noteKeyCommand('next-attention')
      return jumpToNextAttention()
    },
    toggleOverview() {
      noteKeyCommand('toggle-overview')
      // The overview is the main window's: from another window, that one comes forward.
      if (key !== MAIN_WINDOW) {
        useWorkspace.getState().focusWindow(MAIN_WINDOW)
        windowEffects.reveal(MAIN_WINDOW)
      }
      toggleOverview()
    }
  })
)

if (import.meta.hot) import.meta.hot.dispose(dispose)
