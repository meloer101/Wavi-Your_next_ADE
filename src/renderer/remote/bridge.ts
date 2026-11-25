// 手机远程 in the window (PRD F22): while 允许手机连接 is on, tells main about its sessions whenever they change, and
// carries out what main forwards from the phone. Started once by the shell.
import type { SubagentInfo } from '@shared/agent-events'
import type { TeamState } from '@shared/agent-team'
import type { WorkflowRun } from '@shared/workflow-run'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useGuiSessions } from '../gui/store'
import { useShips } from '../pull-requests/ship-runner'
import { usePullRequests } from '../pull-requests/store'
import { sideItemsOf } from '../sidebar/model'
import { useSessionMeta } from '../session-meta/store'
import { sessionSettings } from '../session-settings'
import { useWorkspace } from '../state/workspace'
import { handleRemoteCommand } from './handler'
import { remoteSessions, remoteUsage, sessionUsageVendor } from './model'

/** Status lines change several times a second while agents run; the phone list does not need every one. */
const PUBLISH_MS = 300
/** An exit's result notice comes right after its run is gone (ship-runner.ts `finish`); later notices are other things. */
const ENDING_MS = 3000

let started = false

/** Each session's subagents, workflow runs and team as the sidebar draws them (`sideItemsOf`), for the phone's groups. */
function memberLines(sessions: ReturnType<typeof useWorkspace.getState>['sessions'], bySession: ReturnType<typeof useSessionMeta.getState>['bySession']) {
  const subagents: Record<string, SubagentInfo[]> = {}
  const runs: Record<string, WorkflowRun[]> = {}
  const teams: Record<string, TeamState> = {}
  for (const [id, m] of Object.entries(bySession)) {
    if (m.subagents) subagents[id] = m.subagents
    if (m.workflows) runs[id] = m.workflows
    if (m.team) teams[id] = m.team
  }
  return sideItemsOf({ sessions, subagents, runs, teams })
}

export function startRemoteBridge(): () => void {
  if (started) return () => {}
  started = true
  let enabled = DEFAULT_SETTINGS.remote.enabled
  let last = ''
  let timer: number | null = null
  // How each worktree's last exit ended, for the phone's 45J: the notice set within ENDING_MS of its run ending, not the
  // auto-fix or comment notices that share the same place; a new run clears it.
  const endings: Record<string, string> = {}
  const endedAt: Record<string, number> = {}
  const publish = () => {
    if (!enabled || timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      const meta = useSessionMeta.getState()
      const workspace = useWorkspace.getState()
      const list = remoteSessions(workspace, { ships: useShips.getState().byWorktree, endings }, sessionSettings, (s) => meta.bySession[s.id]?.checks, (s) => meta.bySession[s.id]?.context, (s) => sessionUsageVendor(s, meta.bySession[s.id]), memberLines(workspace.sessions, meta.bySession))
      // The vendors' plan windows for the phone's context sheet (PRD F22 v1.230 ④).
      const usage = remoteUsage(meta.usage, meta.accounts, Date.now())
      if (usage.length > 0) list.usage = usage
      const text = JSON.stringify(list)
      if (text === last) return
      last = text
      window.tr.remote.publishSessions(list)
    }, PUBLISH_MS)
  }
  const setEnabled = (on: boolean) => {
    enabled = on
    last = ''
    publish()
  }
  void window.tr.settings.get().then((s) => setEnabled(s.remote.enabled))
  const offSettings = window.tr.settings.onChange((s) => {
    if (s.remote.enabled !== enabled) setEnabled(s.remote.enabled)
  })
  const offStore = useWorkspace.subscribe(publish)
  // A GUI session's pickers change in its own store (the phone's 会话设置, Figma 64B).
  const offGui = useGuiSessions.subscribe((state, before) => {
    if (Object.keys(state.states).some((id) => state.states[id]?.config !== before.states[id]?.config)) publish()
  })
  // What a terminal agent reports of its model, effort and permission (hooks, statusLine), what it ran this turn
  // (看板 · 进度's checks line, PRD F22 v1.229 ②), its context window, and the plan usage (the phone's context sheet, v1.230 ④).
  const offMeta = useSessionMeta.subscribe((state, before) => {
    if (state.usage !== before.usage || state.accounts !== before.accounts) return publish()
    const changed = (id: string, key: 'settings' | 'checks' | 'context' | 'plan' | 'agent' | 'subagents' | 'workflows' | 'team') => state.bySession[id]?.[key] !== before.bySession[id]?.[key]
    if (Object.keys(state.bySession).some((id) => changed(id, 'settings') || changed(id, 'checks') || changed(id, 'context') || changed(id, 'plan') || changed(id, 'agent') || changed(id, 'subagents') || changed(id, 'workflows') || changed(id, 'team'))) publish()
  })
  // An exit's steps and how it ended show on the phone (Figma 45J).
  const offShips = useShips.subscribe((state, before) => {
    for (const path of Object.keys(state.byWorktree)) if (!before.byWorktree[path]) delete endings[path]
    for (const path of Object.keys(before.byWorktree)) if (!state.byWorktree[path]) endedAt[path] = Date.now()
    publish()
  })
  const offNotices = usePullRequests.subscribe((state, before) => {
    if (state.notice === before.notice) return
    for (const [path, notice] of Object.entries(state.notice)) {
      if (notice !== before.notice[path] && Date.now() - (endedAt[path] ?? 0) < ENDING_MS) endings[path] = notice.text
    }
    publish()
  })
  const offRequests = window.tr.remote.onRequest((request) => {
    void handleRemoteCommand(request.command).then((result) => window.tr.remote.reply(request.callId, result))
  })
  return () => {
    started = false
    if (timer !== null) window.clearTimeout(timer)
    offSettings()
    offStore()
    offGui()
    offMeta()
    offShips()
    offNotices()
    offRequests()
  }
}
