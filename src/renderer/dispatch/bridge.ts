// Dispatch in a window (PRD F21): answers agents' `wavi` commands and reports back to dispatchers, 同任务多解's sessions
// too (F4 v1.68). Started once by the shell.
import { DEFAULT_SETTINGS } from '@shared/settings'
import { handleWaviRequest, resumeConfirmTimers, setDispatchSettings } from './handler'
import { startAttemptReports } from '../attempts/report'
import { addSnapshotPart, initialWorkspaceFile, requestSave } from '../state/persistence'
import { resumeReports, startReports } from './reports'
import { useWorkspace } from '../state/workspace'
import { onUserSubmit } from '../terminal/typing'
import { forgetLeader, restoreDispatch, savedDispatch, setTell, useDispatch } from './store'

let started = false
/** The saved waits are taken up once per window (not again on a remount). */
let restored = false

export function startDispatchBridge(): () => void {
  if (started) return () => {}
  started = true
  setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  void window.tr.settings.get().then((s) => setDispatchSettings(s.dispatch))
  const offSettings = window.tr.settings.onChange((s) => setDispatchSettings(s.dispatch))
  const offRequests = window.tr.dispatch.onRequest((request) => {
    void handleWaviRequest(request).then((result) => window.tr.dispatch.reply(request.callId, result))
  })
  const offReports = startReports()
  // What an earlier window left waiting comes back (a reload, a crash, a restart): saved with the workspace.
  if (!restored) {
    restored = true
    restoreDispatch(initialWorkspaceFile()?.dispatch)
  }
  resumeConfirmTimers()
  resumeReports()
  const offSnapshot = addSnapshotPart(() => {
    const dispatch = savedDispatch(useDispatch.getState())
    return dispatch ? { dispatch } : {}
  })
  const offSaves = useDispatch.subscribe((s, prev) => {
    if (s.confirms !== prev.confirms || s.queues !== prev.queues || s.held !== prev.held) requestSave()
  })
  // 同任务多解's members report through the same channels (attempts/report.ts).
  const offAttempts = startAttemptReports()
  // A leader's `wavi tell` is answered when the user sends a line in its terminal (PRD F21 v1.198 · 交给用户).
  const offSubmits = onUserSubmit((id) => setTell(id, null))
  // A leader closed or no longer the leader (its project's `leaderSessions` entry gone or changed) leaves nothing behind.
  const offLeaders = useWorkspace.subscribe((s, prev) => {
    if (s.leaderSessions === prev.leaderSessions) return
    const now = new Set(Object.values(s.leaderSessions ?? {}))
    for (const id of Object.values(prev.leaderSessions ?? {})) if (!now.has(id)) forgetLeader(id)
  })
  return () => {
    offLeaders()
    offSubmits()
    offAttempts()
    offSaves()
    offSnapshot()
    started = false
    offSettings()
    offRequests()
    offReports()
  }
}
