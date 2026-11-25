// A GUI session's card in the main area (PRD F23, Figma 49″C `GUI`, 59J): the feed, then — each its own block, 8 apart —
// what the agent waits on, the messages queued behind the running turn, a failure, and the composer. Before anything is
// said (59G, 65H) the agent's mark and 「让我们在 <project> 中开工吧」 stand over the composer, the two in the middle of
// the card; the project (ProjectChip) and the agent (the model menu) can still change then. Drawn where a
// terminal would be (TerminalArea / PaneHosts). Files dropped or pasted on it become attachments (terminal/file-input
// → session-io → the composer).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from '../ui/icons'
import { agentName, type CliAgent } from '@shared/agents'
import { emptyGuiState, guiCanEdit, type GuiAnswer, type GuiBranch, type GuiRewindInfo, type GuiRewindScope } from '@shared/gui-chat'
import { defineMessages } from '@shared/i18n'
import type { AgentKind, SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { useSecondaryWindow } from '../state/window-scope'
import { attachFileInput } from '../terminal/file-input'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { PromptCard, type CardKeys } from './Cards'
import { Composer } from './Composer'
import { Feed } from './Feed'
import { TodoCard } from './Todos'
import { DispatchStripGui } from './Dispatch'
import { retargetGuiSession } from './launch'
import { useSessionMeta } from '../session-meta/store'
import { PaneStrips } from '../lifecycle/PaneStrips'
import type { WorkflowAsk } from './WorkflowCard'
import type { WorkflowRun } from '@shared/workflow-run'
import { cardKey, chatIsEmpty, currentTodos, projectChoices, runRowOf, shortAgentName, userCount, waitingToolId, withPendingSend, type PendingSend, type Point } from './model'
import { ProjectChip } from './ProjectChip'
import { addAttachments, clearComposer, insertIntoDraft, notePick, setDraft, setGuiState, useGuiSessions } from './store'
import { popupMenu } from '../ui/menu'
import { useMessages } from '../ui/i18n'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: {
    stopFailed: (name: string) => `没有停住 workflow「${name}」`,
    /** 「让我们在 <project> 中开工吧」: the words before and after the project. */
    welcomeBefore: '让我们在',
    welcomeAfter: '中开工吧',
    queued: '排队',
    edit: '编辑',
    editQueued: '编辑排队的消息',
    removeQueued: '删除排队的消息',
    rewindBoth: '回退对话和代码',
    rewindConversation: '只回退对话',
    rewindCode: '只回退代码',
    files: (n: number) => `${n} 个文件`,
    nothingToRewind: '这条消息之后没有可以回退的'
  },
  en: {
    stopFailed: (name: string) => `Couldn’t stop workflow “${name}”`,
    welcomeBefore: 'Let’s get started in',
    welcomeAfter: '',
    queued: 'Queued',
    edit: 'Edit',
    editQueued: 'Edit queued message',
    removeQueued: 'Remove queued message',
    rewindBoth: 'Rewind conversation and code',
    rewindConversation: 'Rewind conversation only',
    rewindCode: 'Rewind code only',
    files: (n: number) => (n === 1 ? '1 file' : `${n} files`),
    nothingToRewind: 'Nothing to rewind after this message'
  }
})

const EMPTY = emptyGuiState()

export const ChatPane = memo(function ChatPane({ sessionId, agent, cwd, active }: { sessionId: SessionId; agent: AgentKind; cwd: string; active: boolean }) {
  const m = useMessages(M)
  const state = useGuiSessions((s) => s.states[sessionId]) ?? EMPTY
  const rootRef = useRef<HTMLDivElement>(null)
  const cardKeys = useRef<CardKeys | null>(null)
  const bindKeys = useCallback((keys: CardKeys | null) => {
    cardKeys.current = keys
  }, [])
  const [answering, setAnswering] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const prompt = state.prompts[0]
  const label = agent === 'shell' ? '' : shortAgentName(agentName(agent))

  // Files dropped on or pasted into the chat (PRD F19): attachments of the next message.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    return attachFileInput(root, sessionId)
  }, [sessionId])

  // An answer on its way disables that card's buttons; the next prompt (another id) starts usable.
  const answer = useCallback(
    (value: GuiAnswer) => {
      setAnswering(value.id)
      void window.tr.gui
        .answer(sessionId, value)
        .then((ok) => {
          if (!ok) setAnswering(null)
        })
        .catch(() => setAnswering(null))
    },
    [sessionId]
  )

  // The message just sent shows at once: the agent's own copy can come a second or more later (Claude replays it only
  // once it takes the message). A message that will wait in the queue shows there instead.
  const [pending, setPending] = useState<PendingSend | null>(null)
  const users = userCount(state.items)
  const willQueue = state.busy || state.queued.length > 0
  // Its copy arrived: drop it (state adjusted while rendering, React's pattern for state derived from props).
  if (pending && users > pending.users) setPending(null)
  const items = useMemo(() => withPendingSend(state.items, pending), [state.items, pending])
  // Figma 91: the run row comes with the message just sent, before main says the turn started.
  const run = useMemo(
    () => runRowOf({ items, live: state.live, busy: state.busy || pending !== null, prompts: state.prompts, busySince: state.busySince }),
    [items, state.live, state.busy, pending, state.prompts, state.busySince]
  )
  // Figma 59G / 65H: nothing said yet — the welcome over the composer, in the middle of the card.
  const empty = items.length === 0 && chatIsEmpty(state)
  const worktreeId = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId)?.worktreeId)
  const projects = useWorkspace((s) => s.projects)
  const worktrees = useWorkspace((s) => s.worktrees)
  // A project's own window (F20) shows only that project: the session stays in it.
  const scope = useSecondaryWindow()?.projectId ?? null
  const choices = useMemo(() => projectChoices(scope ? projects.filter((p) => p.id === scope) : projects, worktrees), [scope, projects, worktrees])
  const projectId = worktrees.find((w) => w.id === worktreeId)?.projectId
  const questionTray = prompt?.kind === 'question'
  const promptCard = prompt && <PromptCard key={prompt.id} sessionId={sessionId} prompt={prompt} agentLabel={label} answer={answer} pending={answering === prompt.id} bindKeys={bindKeys} />
  // Figma 59J: the agent's current task list, above the composer.
  const todos = useMemo(() => currentTodos(state.items), [state.items])
  // Figma 74: Claude's workflow runs, drawn at their Workflow calls; a Workflow ask is answered on that card.
  const workflows = useSessionMeta((s) => s.bySession[sessionId]?.workflows)
  const waitingTool = waitingToolId(state.items, state.prompts)
  const workflowPrompt = prompt?.kind === 'permission' && prompt.workflow && waitingTool ? prompt : null
  const workflowAsk = useMemo<WorkflowAsk | null>(
    () =>
      workflowPrompt?.workflow
        ? {
            id: workflowPrompt.id,
            name: workflowPrompt.workflow.name,
            phases: workflowPrompt.workflow.phases,
            pending: answering === workflowPrompt.id,
            answer: (allow) => answer({ kind: 'permission', id: workflowPrompt.id, optionId: allow ? 'allow_once' : 'reject_once' })
          }
        : null,
    [workflowPrompt, answering, answer]
  )
  const stopWorkflow = useCallback(
    (run: WorkflowRun) => {
      if (!run.taskId) return
      setSendError(null)
      void window.tr.gui
        .stopTask(sessionId, run.taskId)
        .catch(() => false)
        .then((ok) => {
          if (!ok) setSendError(m.stopFailed(run.name))
        })
    },
    [sessionId, m]
  )

  const send = useCallback(
    (text: string, attachments: readonly string[], from?: Point) => {
      setSendError(null)
      if (!willQueue) {
        setPending({ id: `pending-${Date.now()}`, text, users, at: Date.now(), attachments, ...(from ? { from } : {}) })
        clearComposer(sessionId)
      }
      const undo = (reason: string): void => {
        setPending(null)
        setSendError(reason)
        if (willQueue) return
        setDraft(sessionId, text)
        addAttachments(sessionId, attachments)
      }
      void window.tr.gui
        .send(sessionId, { text, attachments: [...attachments] })
        .then((result) => {
          if (!result.ok) return undo(result.reason)
          if (result.queued) setPending(null)
          clearComposer(sessionId)
        })
        .catch((error: unknown) => undo(error instanceof Error ? error.message : String(error)))
    },
    [sessionId, willQueue, users]
  )
  const interrupt = useCallback(() => void window.tr.gui.interrupt(sessionId).catch(() => {}), [sessionId])

  // Figma 90G′: edited messages' earlier versions, read from the transcript (main parses it whole): once when the chat
  // opens; after an edit or a rewind here, again at the end of every turn (the new version is written as it runs).
  const [branches, setBranches] = useState<GuiBranch[]>([])
  const [watchBranches, setWatchBranches] = useState(false)
  const branchesRead = useRef(false)
  const markBranchesStale = useCallback(() => setWatchBranches(true), [])
  const hasMessages = userCount(state.items) > 0
  // A turn can start and end within one batch of events (busy never seen true): what it added tells it ended.
  const itemCount = watchBranches ? state.items.length : 0
  useEffect(() => {
    if (state.busy || !guiCanEdit(agent) || !hasMessages || (branchesRead.current && !watchBranches)) return
    let live = true
    window.tr.gui.branches(sessionId).then(
      (found) => {
        branchesRead.current = true
        if (live) setBranches(found)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [sessionId, agent, state.busy, hasMessages, watchBranches, itemCount])

  // Figma 54C: ask again from an earlier message. The agent restarts on the conversation before it; the new text shows
  // at once, like a sent message, until the agent's own copy comes.
  const edit = useCallback(
    async (messageId: string, text: string): Promise<string | null> => {
      setSendError(null)
      const result = await window.tr.gui.edit(sessionId, messageId, text).catch((error: unknown) => ({ ok: false as const, reason: error instanceof Error ? error.message : String(error) }))
      if (!result.ok) {
        setSendError(result.reason)
        return result.reason
      }
      setGuiState(sessionId, result.state)
      setPending({ id: `pending-${Date.now()}`, text, users: userCount(result.state.items), at: Date.now() })
      markBranchesStale()
      return null
    },
    [sessionId, markBranchesStale]
  )
  // Figma 90G: back to before an earlier message — what the agent can take back (the code only when that message
  // changed files), chosen from a menu; with one thing to take back, no menu. The message goes back into the composer.
  const rewind = useCallback(
    async (messageId: string, text: string, anchor: HTMLElement): Promise<void> => {
      setSendError(null)
      let info: GuiRewindInfo
      try {
        info = await window.tr.gui.rewindInfo(sessionId, messageId)
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error))
        return
      }
      const files = info.files ?? 0
      const choices: { id: GuiRewindScope; label: string; detail?: string }[] = [
        ...(info.conversation && files > 0 ? [{ id: 'both' as const, label: m.rewindBoth, detail: m.files(files) }] : []),
        ...(info.conversation ? [{ id: 'conversation' as const, label: m.rewindConversation }] : []),
        ...(files > 0 ? [{ id: 'code' as const, label: m.rewindCode, detail: m.files(files) }] : [])
      ]
      if (choices.length === 0) {
        setSendError(m.nothingToRewind)
        return
      }
      const scope =
        choices.length === 1
          ? choices[0]!.id
          : ((await popupMenu(
              choices.map((c) => ({ type: 'item' as const, id: c.id, label: c.label, ...(c.detail ? { detail: c.detail } : {}) })),
              anchor
            )) as GuiRewindScope | null)
      if (!scope) return
      const result = await window.tr.gui.rewind(sessionId, messageId, scope).catch((error: unknown) => ({ ok: false as const, reason: error instanceof Error ? error.message : String(error) }))
      if (!result.ok) {
        setSendError(result.reason)
        return
      }
      setGuiState(sessionId, result.state)
      // As Claude Code does: the message is back in the composer, to send again or change.
      if (scope !== 'code') {
        insertIntoDraft(sessionId, text)
        markBranchesStale()
      }
    },
    [sessionId, m, markBranchesStale]
  )
  const setConfig = useCallback(
    (optionId: string, value: string) => {
      notePick(sessionId)
      return window.tr.gui.setConfig(sessionId, optionId, value).catch(() => false)
    },
    [sessionId]
  )
  // Figma 65B: another agent, with one of its models when it listed them before (its last picks hold the rest).
  const switchAgent = useCallback(
    (next: CliAgent, model: string | undefined) => {
      if (model) useWorkspace.getState().rememberGuiPicks(next, { model })
      void retargetGuiSession(sessionId, { kind: next })
    },
    [sessionId]
  )

  /**
   * A key for the waiting card: true when the card took it. From the empty composer (it asks first, Composer) digits
   * and arrows are the card's only for a question (Claude's TUI does the same).
   */
  const promptKind = prompt?.kind
  const routeCardKey = useCallback(
    (event: KeyboardEvent, inComposer: boolean): boolean => {
      if (!cardKeys.current) return false
      const { key, metaKey, ctrlKey, altKey } = event
      const action = cardKey({ key, metaKey, ctrlKey, altKey, isComposing: event.isComposing || event.keyCode === 229 }, false)
      if (!action) return false
      if (inComposer && (action.type === 'pick' || action.type === 'move') && promptKind !== 'question') return false
      return cardKeys.current(action)
    },
    [promptKind]
  )
  const composerCardKey = useCallback((event: KeyboardEvent) => routeCardKey(event, true), [routeCardKey])

  return (
    <div
      ref={rootRef}
      className={styles.chat}
      data-testid="gui-chat"
      data-gui-chat
      data-empty={empty || undefined}
      onKeyDown={(event) => {
        // A waiting card answers from the keyboard. The composer routes its own keys (Composer); typing elsewhere
        // (其他…, a queued message) keeps its keys.
        if (event.defaultPrevented) return
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' || target.closest('[data-gui-input]')) return
        if (routeCardKey(event.nativeEvent, false)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      {empty ? (
        <div className={styles.welcome} data-testid="gui-welcome">
          <span className={`${styles.agentAvatar} ${styles.welcomeMark}`} title={agent === 'shell' ? undefined : agentName(agent)}>
            <AgentIcon kind={agent} size={20} />
          </span>
          <span className={styles.welcomeLine}>
            {m.welcomeBefore}
            {projectId ? (
              <ProjectChip choices={choices} current={projectId} onPick={(choice) => void retargetGuiSession(sessionId, { worktreeId: choice.worktreeId })} />
            ) : (
              <span className={styles.projectChip}>
                <span className={styles.projectName}>{cwd.slice(cwd.lastIndexOf('/') + 1)}</span>
              </span>
            )}
            {m.welcomeAfter || null}
          </span>
        </div>
      ) : (
        <Feed
          sessionId={sessionId}
          agent={agent}
          items={items}
          live={state.live}
          run={run}
          waitingTool={waitingTool}
          busy={state.busy}
          canEdit={guiCanEdit(agent) && !prompt && state.queued.length === 0}
          onEdit={edit}
          onRewind={rewind}
          branches={branches}
          workflows={workflows}
          workflowAsk={workflowAsk}
          onStopWorkflow={stopWorkflow}
          launch={pending}
        />
      )}
      <div className={styles.dock}>
        {/* The session's strips (Figma 80B′): in the column, drawn like its other cards. */}
        <div className={styles.dockStrips}>
          <PaneStrips sessionId={sessionId} active={active} />
        </div>
        <DispatchStripGui parentId={sessionId} />
        {prompt && !workflowAsk && !questionTray && promptCard}
        {state.queued.map((queued) => (
          <QueuedBar key={queued.id} sessionId={sessionId} id={queued.id} text={queued.text} />
        ))}
        {(state.failure ?? sendError) && (
          <div className={styles.failure} role="alert">
            <StatusGlyph status="error" />
            <span className={styles.failureText}>{state.failure ?? sendError}</span>
          </div>
        )}
        {/* PRD v1.245: the question and the task list are trays on the composer's top edge — the question next to it,
            the tasks above it. */}
        {(todos || (prompt && questionTray && !workflowAsk)) && (
          <div className={styles.trays}>
            {todos && <TodoCard sessionId={sessionId} todos={todos} />}
            {prompt && questionTray && !workflowAsk && promptCard}
          </div>
        )}
        <Composer
          sessionId={sessionId}
          agent={agent}
          cwd={cwd}
          busy={state.busy}
          commands={state.commands}
          config={state.config}
          cardWaiting={!!prompt}
          cardKey={composerCardKey}
          send={send}
          interrupt={interrupt}
          setConfig={setConfig}
          switchable={empty}
          switchAgent={switchAgent}
        />
      </div>
    </div>
  )
})

/** 49″C: a message sent while the turn runs. Click to edit (⏎ saves, ⎋ cancels, empty removes); × removes. */
function QueuedBar({ sessionId, id, text }: { sessionId: SessionId; id: string; text: string }) {
  const m = useMessages(M)
  const [editing, setEditing] = useState<string | null>(null)
  const save = (value: string): void => {
    setEditing(null)
    if (value !== text) void window.tr.gui.editQueued(sessionId, id, value.trim()).catch(() => {})
  }
  return (
    <div className={styles.queued} data-testid="gui-queued">
      <span className={styles.queuedLabel}>{m.queued}</span>
      {editing === null ? (
        <button type="button" className={styles.queuedText} title={m.edit} onClick={() => setEditing(text)}>
          {text}
        </button>
      ) : (
        <input
          className={styles.queuedInput}
          aria-label={m.editQueued}
          value={editing}
          ref={(node) => node?.focus()}
          onChange={(e) => setEditing(e.currentTarget.value)}
          onBlur={() => save(editing)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              save(editing)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setEditing(null)
            }
          }}
        />
      )}
      <button type="button" className={styles.queuedRemove} aria-label={m.removeQueued} onClick={() => void window.tr.gui.editQueued(sessionId, id, '').catch(() => {})}>
        <X size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}
