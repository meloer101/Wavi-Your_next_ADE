// 自动领取 GitHub issue in the window (PRD F26): main's settings, scan reasons and issue records, kept current from
// `issueWatch.onChanged`, and the lookups the report block, 看板 · GitHub's rows and the settings section need.
import { create } from 'zustand'
import type { IssueRecord, IssueWatchProjectSettings, IssueWatchState } from '@shared/issue-watch'
import type { SessionId } from '@shared/types'
import { recordForSession } from './model'

interface State {
  state: IssueWatchState | null
  /** The first answer has come (before that, the defaults are shown). */
  loaded: boolean
}

export const useIssueWatch = create<State>()(() => ({ state: null, loaded: false }))

let listening = false

/** Loads main's records once and follows changes from then on (the runner, the report block, the settings row). */
export function followIssueWatch(): void {
  if (listening) return
  listening = true
  window.tr.issueWatch.onChanged((state) => useIssueWatch.setState({ state, loaded: true }))
  void window.tr.issueWatch.get().then((state) => useIssueWatch.setState({ state, loaded: true }))
}

/** The project's settings by project id (undefined while the project has no row yet). */
export const projectSettings = (state: IssueWatchState | null, projectId: string): IssueWatchProjectSettings | undefined =>
  state?.projects.find((p) => p.projectId === projectId)

/** The record a session works on, for the session header and the report block. */
export const useRecordForSession = (sessionId: SessionId | undefined): IssueRecord | undefined =>
  useIssueWatch((s) => recordForSession(s.state?.issues ?? [], sessionId))
