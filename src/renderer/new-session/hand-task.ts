// 看板 · GitHub's 交给 agent (PRD F9 v1.184, Figma 77E; the phone's new-session with a task, PRD F22 v1.229 ④): the
// new session takes the item's title and link, and its first message — on the CLI's command line or the GUI's launch
// where the agent has one, else typed in once the agent is ready (as 一题多解 does). One function for the desktop's
// 新建会话 sheet and the phone, so the session they build is the same.
import { promptOnCommandLine } from '@shared/agent-launch'
import type { AgentKind, GitHubLink, SessionId, SessionUi } from '@shared/types'
import { setLaunch } from '../dispatch/store'
import { submitPrompt, whenAgentReady } from '../session-io'
import { useWorkspace } from '../state/workspace'

/** What the task says about the session: the item's title and the link it records (Session.github). */
export interface HandedTask {
  title: string
  link: GitHubLink
}

/** `text`: the first message, already trimmed of nothing (null = the form left it empty); the phone's picked model rides
 *  on the launch, as the sheet's does. */
export function handTask(id: SessionId, task: HandedTask, kind: AgentKind, ui: SessionUi, text: string | null, model?: string): void {
  useWorkspace.getState().patchSession(id, { title: task.title, titleSource: 'prompt', github: task.link })
  if (text === null || kind === 'shell') return
  if (ui === 'gui' || promptOnCommandLine(kind)) {
    setLaunch(id, { initialPrompt: text, ...(model ? { model } : {}) })
    return
  }
  void whenAgentReady(id)
    .then(() => submitPrompt(id, text))
    .catch((error: unknown) => console.error('[new-session] the task did not reach the agent:', error))
}
