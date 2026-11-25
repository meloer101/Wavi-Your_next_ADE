// Opens a session in a new worktree, the way 新建会话 does: the session is added at once over the worktree that is still
// being made, its title and first message are set (a first message starts the agent as 派活's does), and it starts.
// 定时任务 (schedules/runner.ts) and 自动领取 (issue-watch/runner.ts) both come through here; what is only theirs
// (定时任务's scheduledBy, 自动领取's github link) is passed as `patch`.
import { cliPermissionLevels } from '@shared/agent-launch'
import type { CliAgent } from '@shared/agents'
import { isCliPermission, type GuiPermission } from '@shared/gui-chat'
import type { WorktreeCreateRequest } from '@shared/new-session'
import type { Session, SessionId, SessionUi } from '@shared/types'
import { setLaunch } from '../dispatch/store'
import { useWorkspace } from '../state/workspace'
import { randomId } from '../state/workspace-model'
import { createWorktreeFor, holdForWorktree, startEagerly } from './creation'

export interface NewWorktreeSession {
  projectId: string
  agent: CliAgent
  ui: SessionUi
  /** Where the worktree is made (from `planCreate`). */
  path: string
  request: WorktreeCreateRequest
  /** The session's name, `titleSource: 'user'`: the agent does not rename it. */
  title: string
  /** The first message (PRD F21's launch). */
  prompt: string
  model?: string
  /** The permission picked in the caller's settings; a CLI session only takes what its launch can set. */
  permission?: GuiPermission
  /** Fields only the caller sets (scheduledBy, github, …), written with the title. */
  patch?: Partial<Session>
  /** A given id (tests); by default a fresh one. */
  id?: SessionId
}

/**
 * Adds the session, sets its first message, model and permission, and starts it. Null when the workspace refused the
 * session (the project or the worktree is gone).
 */
export function launchWorktreeSession(session: NewWorktreeSession): SessionId | null {
  const workspace = useWorkspace.getState()
  const id = workspace.addBackgroundSession(
    session.projectId,
    { path: session.path, branch: session.request.branch, baseBranch: session.request.base },
    session.agent,
    session.id ?? randomId('s'),
    session.ui
  )
  if (!id) return null
  workspace.patchSession(id, {
    title: session.title,
    titleSource: 'user',
    ...session.patch,
    ...(session.ui === 'gui' && session.permission ? { guiPermission: session.permission } : {})
  })
  // A terminal session takes the 权限 as its CLI's launch flag or variable (PRD F24 v1.205); none is its own default.
  const cliPermission =
    session.ui === 'cli' && isCliPermission(session.permission) && cliPermissionLevels(session.agent).includes(session.permission) ? session.permission : undefined
  setLaunch(id, { initialPrompt: session.prompt, ...(session.model ? { model: session.model } : {}), ...(cliPermission ? { permission: cliPermission } : {}) })
  holdForWorktree(id)
  void createWorktreeFor(id, session.agent, session.request)
  startEagerly(id)
  return id
}
