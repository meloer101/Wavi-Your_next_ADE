// The conversation column of a GUI session (PRD F23, Figma 49″C `Feed`, 51A, 59J): the composer's width, user bubbles
// ending at its right edge with the user's picture outside it, the agent's part of each turn from its left edge with
// the mark outside it — its Markdown, runs of tool and thinking rows grouped 8 apart (a subagent's under its row) — 12 between blocks, 24 between
// turns, and the block being streamed. Each
// block is memoised on its items (applyGuiEvent keeps unchanged items by identity), so a streamed delta re-renders
// the live block only; blocks scrolled far out of view skip layout and paint (`content-visibility`).
// Figma 54: hovering a message shows its actions — yours: time · copy · edit; the agent's, after a finished turn: copy ·
// time. 编辑 turns your message into a text box in place and fades what came after it until it is sent or cancelled.
import { Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowDown, Bot, Brain, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, FilePlus, FileText, FolderSearch, Globe, Image as ImageMark, ListTodo, ArrowRight, Pencil, Search, Sparkles, Square, Terminal, ToggleLeft, Trash2, Undo2, Wrench, type IconComponent } from '../ui/icons'
import type { GuiBranch, GuiLive } from '@shared/gui-chat'
import { defineMessages } from '@shared/i18n'
import { formatClock } from '@shared/session-meta'
import { STATUS_LABEL } from '@shared/session-status'
import type { ChatItem, FileDiff } from '@shared/transcript-chat'
import type { AgentKind, SessionId } from '@shared/types'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ansiSpans } from './ansi'
import { ChatMarkdown } from './ChatMarkdown'
import { Attachment } from './Composer'
import { worktreeOf } from '../state/link-actions'
import { ComposerEditor, insertNewline, type CaretContext } from './ComposerEditor'
import { ImageGalleryProvider } from './ImagePreview'
import { ImageRow } from './ImageThumb'
import { CopyButton } from './CopyButton'
import { DispatchGraph, WaviMessageView } from './Dispatch'
import { DiffBlock, diffText } from './DiffBlock'
import { outputRuns, refPieces } from './file-refs'
import { FileRef, RefSession } from './FileRef'
import { PageTitles, SearchResults } from './WebLink'
import { TestResults } from './TestResults'
import { branchedChat, type BranchSwitch } from './branches'
import { testResults, type TestResults as TestRun } from './test-results'
import { pageTitles, shortUrl, siteOf } from './web-links'
import { TodoList } from './Todos'
import { WorkflowCard, type WorkflowAsk } from './WorkflowCard'
import type { WorkflowRun } from '@shared/workflow-run'
import {
  blockHas,
  composerKey,
  dispatchKey,
  dispatchRows,
  waviMessage,
  feedBlocks,
  flightOf,
  FOLD_ROWS,
  foldsMessage,
  galleryOf,
  groupView,
  imageKey,
  isSubagentTool,
  isWorkflowTool,
  liveStartsTurn,
  runClock,
  sentMessage,
  stepParts,
  subagentElapsed,
  thinkingLabel,
  toolView,
  turnEnds,
  turnStarts,
  userBubble,
  userMarkdown,
  type DispatchRow,
  type PendingSend,
  type Point,
  type FeedBlock,
  type NestedItem,
  type RunRow,
  type StepItem,
  type ToolIcon,
  type ToolView,
  type WaviMessage
} from './model'
import { useLang, useMessages } from '../ui/i18n'
import { setMessageExpanded, useGuiSessions } from './store'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: {
    pictures: '图片',
    edit: '编辑',
    rewind: '回退',
    previousVersion: '上一个版本',
    nextVersion: '下一个版本',
    editMessage: '编辑消息',
    cancel: '取消',
    send: '发送',
    failed: (count: number) => `${count} 个失败`,
    waiting: '等你确认',
    copyOutput: '复制输出',
    thinking: '思考中',
    dependencyFrames: (count: number) => `依赖里的 ${count} 帧`,
    results: (count: number) => `${count} 个结果`,
    testsFailed: (count: number) => `${count} 失败`,
    testsPassed: (count: number) => `${count} 通过`,
    jumpToLatest: '回到最新',
    showMore: '展开',
    showLess: '收起'
  },
  en: {
    pictures: 'Pictures',
    edit: 'Edit',
    rewind: 'Rewind',
    previousVersion: 'Previous version',
    nextVersion: 'Next version',
    editMessage: 'Edit message',
    cancel: 'Cancel',
    send: 'Send',
    failed: (count: number) => `${count} failed`,
    waiting: 'Needs you',
    copyOutput: 'Copy output',
    thinking: 'Thinking',
    dependencyFrames: (count: number) => `${count} frames in dependencies`,
    results: (count: number) => (count === 1 ? '1 result' : `${count} results`),
    testsFailed: (count: number) => `${count} failed`,
    testsPassed: (count: number) => `${count} passed`,
    jumpToLatest: 'Jump to latest',
    showMore: 'Show more',
    showLess: 'Show less'
  }
})

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** A tool row's icon key (model.ts `toolView`) → its icon (ui/icons). */
const TOOL_ICONS: Readonly<Record<ToolIcon, IconComponent>> = {
  'file-text': FileText,
  'file-plus': FilePlus,
  pencil: Pencil,
  terminal: Terminal,
  square: Square,
  search: Search,
  'folder-search': FolderSearch,
  globe: Globe,
  image: ImageMark,
  bot: Bot,
  'list-todo': ListTodo,
  sparkles: Sparkles,
  'clipboard-list': ClipboardList,
  trash: Trash2,
  'move-right': ArrowRight,
  brain: Brain,
  toggle: ToggleLeft,
  wrench: Wrench
}

/** Wavi's own message (a dispatch report or notice) in a user item, read once per item. */
const waviCache = new WeakMap<ChatItem, WaviMessage | null>()
function waviOf(item: Extract<ChatItem, { kind: 'user' }>): WaviMessage | null {
  let found = waviCache.get(item)
  if (found === undefined) waviCache.set(item, (found = waviMessage(item.text)))
  return found
}

const NO_BRANCHES: readonly GuiBranch[] = []
const NO_VIEWING: ReadonlyMap<string, number> = new Map()

/** Within this many px of the end the feed follows new content down. */
const STICK_PX = 48

interface FeedProps {
  sessionId: SessionId
  agent: AgentKind
  items: readonly ChatItem[]
  live: GuiLive | null
  /** Figma 91: the running turn's last row — what the agent does now and for how long (runRowOf). */
  run: RunRow | null
  waitingTool: string | null
  /** A turn runs: its reply has no actions yet, and nothing can be edited. */
  busy: boolean
  /** The agent can ask again from an earlier message (guiCanEdit) and nothing waits on the user. */
  canEdit: boolean
  /** Asks again from `messageId` with `text`; the reason when it did not. */
  onEdit(messageId: string, text: string): Promise<string | null>
  /** Figma 90G: back to before an earlier message (the menu hangs from `anchor`). */
  onRewind?(messageId: string, text: string, anchor: HTMLElement): Promise<void>
  /** Figma 90G′: edited messages and their earlier versions (ChatPane asks main for them). */
  branches?: readonly GuiBranch[]
  /** Claude's workflow runs (PRD F25): drawn as a card at their Workflow call. */
  workflows?: readonly WorkflowRun[]
  /** The Workflow call waiting on the user: its card is the ask (Figma 74A). */
  workflowAsk?: WorkflowAsk | null
  onStopWorkflow?(run: WorkflowRun): void
  /** Figma 98: the message just sent; drawn, it flies in from where it was in the composer. */
  launch?: PendingSend | null
}

/** What the run cards of the feed draw: by Workflow call, the ask, and 停止. */
interface WorkflowSlot {
  byTool: ReadonlyMap<string, WorkflowRun>
  ask: WorkflowAsk | null
  onStop?(run: WorkflowRun): void
}

/** A run's shape, once per run object (each list from main is new objects; renders in between reuse them). */
const runShapes = new WeakMap<WorkflowRun, string>()
function runShape(run: WorkflowRun): string {
  let shape = runShapes.get(run)
  if (shape === undefined) runShapes.set(run, (shape = JSON.stringify(run)))
  return shape
}

/** What a block draws of the runs: the memo compares this, not the map. */
function workflowKey(block: FeedBlock, slot: WorkflowSlot, waitingTool: string | null): string {
  if (block.kind !== 'steps') return ''
  const parts: string[] = []
  for (const item of block.items) {
    if (item.kind !== 'tool' || !isWorkflowTool(item.name)) continue
    const run = slot.byTool.get(item.id)
    if (run) parts.push(runShape(run))
    if (item.id === waitingTool && slot.ask) parts.push(`ask:${slot.ask.id}:${slot.ask.pending}`)
  }
  return parts.join('|')
}

export function Feed({ sessionId, agent, items: chatItems, live: liveBlock, run: runRow, waitingTool, busy, canEdit, onEdit, onRewind, branches = NO_BRANCHES, workflows, workflowAsk, onStopWorkflow, launch = null }: FeedProps) {
  // Figma 90G′: the version chosen per edited message; back to the current ones when a message is sent.
  const users = useMemo(() => chatItems.filter((item) => item.kind === 'user').length, [chatItems])
  const [chosen, setChosen] = useState<{ users: number; versions: ReadonlyMap<string, number> }>({ users, versions: NO_VIEWING })
  // A choice is kept while no message is added (sending one draws the current versions again).
  const viewing = chosen.users === users ? chosen.versions : NO_VIEWING
  const chat = useMemo(() => branchedChat(chatItems, branches, viewing), [chatItems, branches, viewing])
  const all = chat.items
  // An earlier version is drawn as it was: the reply being streamed and its run row belong to the current one.
  const live = chat.readOnlyFrom === null ? liveBlock : null
  const run = chat.readOnlyFrom === null ? runRow : null
  const readOnly = useMemo(() => new Set(chat.readOnlyFrom === null ? [] : all.slice(chat.readOnlyFrom).map((item) => item.id)), [chat.readOnlyFrom, all])
  const switchVersion = useCallback((messageId: string, index: number) => setChosen({ users, versions: new Map(viewing).set(messageId, index) }), [users, viewing])
  const slot = useMemo<WorkflowSlot>(
    () => ({ byTool: new Map((workflows ?? []).flatMap((run) => (run.toolUseId ? [[run.toolUseId, run] as const] : []))), ask: workflowAsk ?? null, onStop: onStopWorkflow }),
    [workflows, workflowAsk, onStopWorkflow]
  )
  // The step the run row carries is not drawn twice; it becomes a row when it is done.
  const running = run?.tool ?? null
  const items = useMemo(() => (running ? all.filter((item) => item !== running) : all), [all, running])
  const blocks = useMemo(() => feedBlocks(items), [items])
  const starts = useMemo(() => turnStarts(blocks), [blocks])
  const ends = useMemo(() => turnEnds(blocks, busy || live !== null), [blocks, busy, live])
  // Figma 68′: the turn's wavi run calls as one graph.
  const dispatch = useMemo(() => dispatchRows(items), [items])
  // Figma 90B: a fetched page or a link named by the title a search found.
  const titles = useMemo(() => pageTitles(items), [items])
  // Figma 112G: every picture of the session in order, for the preview its thumbnails open.
  const cwd = worktreeOf(sessionId)
  const gallery = useMemo(() => galleryOf(all, cwd), [all, cwd])
  const [editingId, setEditingId] = useState<string | null>(null)
  // The message being edited, while it is still there (an edit sent replaces the conversation after it).
  const editingAt = editingId === null ? -1 : blocks.findIndex((b) => b.kind === 'item' && b.item.id === editingId)
  const editing = editingAt >= 0 ? editingId : null
  const startEdit = useCallback((id: string) => setEditingId(id), [])
  const cancelEdit = useCallback(() => setEditingId(null), [])
  // A sent edit is done with: the message may come back (an earlier version, Figma 90G′) and must not reopen as a box.
  const saveEdit = useCallback(
    async (id: string, text: string): Promise<string | null> => {
      const reason = await onEdit(id, text)
      if (reason === null) setEditingId(null)
      return reason
    },
    [onEdit]
  )
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  // Figma 90F′: the user scrolled up and something new came below.
  const [behind, setBehind] = useState(false)
  // The blocks last drawn, to tell a message the user just sent.
  const seen = useRef<FeedBlock[] | null>(null)

  // The feed reads top down like any chat (Figma 50A): new blocks go below and the view follows the end while the
  // user is there; scrolling up leaves the view where it is, and sending a message brings it back to the end.
  const follow = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller && stuck.current) scroller.scrollTop = scroller.scrollHeight
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const onScroll = (): void => {
      stuck.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= STICK_PX
      if (stuck.current) setBehind(false)
    }
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    observer.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [follow])

  // Figma 98: the message in flight (its id), and how to end the flight at once.
  const landing = useRef<{ id: string; end: () => void } | null>(null)
  useEffect(() => () => landing.current?.end(), [])

  useLayoutEffect(() => {
    const sent = sentMessage(seen.current, blocks)
    if (sent) stuck.current = true
    seen.current = blocks
    if (!stuck.current) setBehind(true)
    const scroller = scrollerRef.current
    const content = contentRef.current
    const before = scroller?.scrollTop ?? 0
    follow()
    if (!scroller || !content) return
    if (sent && launch?.from && sent === launch.id && landing.current?.id !== launch.id) {
      landing.current?.end()
      const flight = { id: launch.id, end: () => {} }
      landing.current = flight
      flight.end = flyIn(scroller, content, launch.id, launch.from, scroller.scrollTop - before, () => {
        if (landing.current === flight) landing.current = null
      })
    } else if (landing.current) {
      // The agent's copy took the place of the one drawn at once: it stays hidden until the flight lands.
      lastUserRow(content)?.setAttribute('data-landing', '')
    }
  }, [blocks, live, run, follow, launch])

  const jumpToLatest = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    stuck.current = true
    setBehind(false)
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: instant ? 'auto' : 'smooth' })
  }, [])

  return (
    <RefSession.Provider value={sessionId}>
    <PageTitles.Provider value={titles}>
    <ImageGalleryProvider images={gallery}>
    <div className={styles.feedFrame}>
    <div ref={scrollerRef} className={styles.scroller} data-region="gui-feed">
      <div ref={contentRef} className={styles.feed}>
        {blocks.map((block, i) =>
          block.kind === 'item' && block.item.kind === 'user' && waviOf(block.item) ? (
            <WaviMessageView key={block.key} message={waviOf(block.item)!} time={timeOf(block.item.at)} />
          ) : block.kind === 'item' && block.item.kind === 'user' ? (
            <UserMessage
              key={block.key}
              sessionId={sessionId}
              item={block.item}
              faded={editingAt >= 0 && i > editingAt}
              editable={canEdit && !busy && !block.item.id.startsWith('pending-') && !readOnly.has(block.item.id)}
              {...(chat.switches.has(block.item.id) ? { branch: chat.switches.get(block.item.id)!, onSwitch: switchVersion } : {})}
              editing={editing === block.item.id && !readOnly.has(block.item.id)}
              onStartEdit={startEdit}
              onCancel={cancelEdit}
              onSave={saveEdit}
              {...(onRewind ? { onRewind } : {})}
            />
          ) : (
            <AgentTurn key={block.key} agent={agent} start={starts.has(block.key)} faded={editingAt >= 0 && i > editingAt} end={ends.get(block.key)}>
              <Block
                sessionId={sessionId}
                block={block}
                waitingTool={block.kind === 'steps' && waitingTool !== null && blockHas(block, waitingTool) ? waitingTool : null}
                dispatch={dispatch}
                dispatchShape={dispatchKey(block, dispatch)}
                workflow={slot}
                workflowShape={workflowKey(block, slot, waitingTool)}
              />
            </AgentTurn>
          )
        )}
        {live?.kind === 'text' && (
          <AgentTurn agent={agent} start={liveStartsTurn(blocks)} faded={editingAt >= 0}>
            <ChatMarkdown sessionId={sessionId} text={live.text} className={`${styles.block} ${styles.live}`} />
          </AgentTurn>
        )}
        {run && (
          <AgentTurn agent={agent} start={liveStartsTurn(blocks)} faded={editingAt >= 0}>
            <RunLine run={run} />
          </AgentTurn>
        )}
      </div>
    </div>
    {behind && <JumpToLatest onJump={jumpToLatest} />}
    </div>
    </ImageGalleryProvider>
    </PageTitles.Provider>
    </RefSession.Provider>
  )
}

/** Figma 90F′: 「↓ 回到最新」 over the foot of the feed; it never takes the composer's focus. */
function JumpToLatest({ onJump }: { onJump(): void }) {
  const m = useMessages(M)
  return (
    <button type="button" className={styles.jumpToLatest} onPointerDown={(e) => e.preventDefault()} onClick={onJump} data-testid="gui-jump-to-latest">
      <ArrowDown {...ICON} />
      {m.jumpToLatest}
    </button>
  )
}

const Block = memo(
  function Block({
    sessionId,
    block,
    waitingTool,
    dispatch,
    workflow
  }: {
    sessionId: SessionId
    block: FeedBlock
    waitingTool: string | null
    dispatch: ReadonlyMap<string, DispatchRow>
    /** What the block draws of `dispatch` (dispatchKey): the memo compares this, not the map. */
    dispatchShape: string
    workflow: WorkflowSlot
    /** What it draws of the runs (workflowKey). */
    workflowShape: string
  }) {
    // A memo: a language switch redraws its rows (their words come from model.ts) through this.
    useLang()
    if (block.kind === 'steps') {
      return (
        <div className={styles.steps}>
          {/* Figma 70′B: calls between two of the agent's words fold into one row; the dispatch graph and a call waiting on
              you stay out, and the calls the graph draws are not there to split a run. */}
          {stepParts(
            block.items.filter((item) => dispatch.get(item.id)?.kind !== 'merged'),
            (item) => dispatch.has(item.id) || item.id === waitingTool || (item.kind === 'tool' && isWorkflowTool(item.name))
          ).map((part) => {
            if (part.kind === 'group') return <ToolGroup key={part.key} items={part.items} nested={block.nested} />
            const { item } = part
            const row = dispatch.get(item.id)
            if (row?.kind === 'graph') return <DispatchGraph key={item.id} parentId={sessionId} ids={row.ids} />
            if (row?.kind === 'merged') return null
            // Figma 74: a Workflow call is its run's card — the ask before it runs, then the run.
            if (item.kind === 'tool' && isWorkflowTool(item.name)) {
              const run = workflow.byTool.get(item.id)
              const ask = item.id === waitingTool ? workflow.ask : null
              if (run || ask) return <WorkflowCard key={item.id} {...(run ? { run } : {})} {...(ask ? { ask } : {})} {...(workflow.onStop ? { onStop: workflow.onStop } : {})} />
            }
            return item.kind === 'thinking' ? <Thinking key={item.id} item={item} /> : <Tool key={item.id} item={item} nested={block.nested} waitingTool={waitingTool} />
          })}
        </div>
      )
    }
    const { item } = block
    switch (item.kind) {
      case 'user':
        return null
      case 'text':
        return (
          <>
            {item.text.trim() !== '' && <ChatMarkdown sessionId={sessionId} text={item.text} className={styles.block} itemId={item.id} />}
            {item.images && <ImageRow paths={item.images} itemId={item.id} />}
          </>
        )
      case 'system':
        return <p className={styles.system}>{item.text}</p>
      case 'unknown':
        return null
    }
  },
  (a, b) =>
    a.sessionId === b.sessionId &&
    a.waitingTool === b.waitingTool &&
    a.dispatchShape === b.dispatchShape &&
    a.workflowShape === b.workflowShape &&
    a.workflow.onStop === b.workflow.onStop &&
    sameBlock(a.block, b.block)
)

const sameList = <T,>(a: readonly T[], b: readonly T[] | undefined): boolean => !!b && a.length === b.length && a.every((item, i) => item === b[i])

/** Same block: the same items, by identity, and the same under each subagent row (a grown run of steps is a new block). */
function sameBlock(a: FeedBlock, b: FeedBlock): boolean {
  if (a.kind === 'item' || b.kind === 'item') return a.kind === b.kind && a.kind === 'item' && b.kind === 'item' && a.item === b.item
  return sameList(a.items, b.items) && a.nested.size === b.nested.size && [...a.nested].every(([id, list]) => sameList(list, b.nested.get(id)))
}

/** When a message was sent or a turn ended: `15:04`, with the date on another day. */
const timeOf = (at: number): string => (at > 0 ? formatClock(at, Date.now()) : '')

/**
 * 51A: the agent's part of a turn, after its mark; the mark beside the first block only. 54B: after the last block of
 * a finished turn, copy (the turn's Markdown) · time, shown on hover.
 */
function AgentTurn({ agent, start, faded, end, children }: { agent: AgentKind; start: boolean; faded: boolean; end?: { text: string; at: number }; children: ReactNode }) {
  return (
    <div className={styles.agentTurn} data-start={start || undefined} data-faded={faded || undefined}>
      {start && (
        <span className={styles.agentAvatar} data-agent-mark aria-hidden>
          <AgentIcon kind={agent} size={22} />
        </span>
      )}
      {children}
      {end && (
        <div className={styles.messageActions} data-testid="gui-turn-actions">
          <CopyButton text={end.text} />
          <span className={styles.messageTime}>{timeOf(end.at)}</span>
        </div>
      )}
    </div>
  )
}

interface UserMessageProps {
  sessionId: SessionId
  item: Extract<ChatItem, { kind: 'user' }>
  faded: boolean
  editable: boolean
  editing: boolean
  onStartEdit(id: string): void
  onCancel(): void
  onSave(id: string, text: string): Promise<string | null>
  onRewind?(id: string, text: string, anchor: HTMLElement): Promise<void>
  branch?: BranchSwitch
  onSwitch?(messageId: string, index: number): void
}

/**
 * 51A: what the user sent, as Markdown, with their picture beside it when they set one (设置 · 外观 · 对话). 54A: time ·
 * copy · edit under it on hover; 54C: editing, a text box in its place. 71A: the pictures sent with it over the bubble
 * (71C: no bubble when it had no words; 71D: a file that is gone shows its name).
 */
const UserMessage = memo(function UserMessage({ sessionId, item, faded, editable, editing, onStartEdit, onCancel, onSave, onRewind, branch, onSwitch }: UserMessageProps) {
  const m = useMessages(M)
  const { header, body } = userBubble(item.text)
  const markdown = useMemo(() => userMarkdown(body), [body])
  const pictures = item.attachments ?? []
  return (
    <div className={styles.userRow} data-item={item.id} data-faded={faded || undefined}>
      <div className={styles.userColumn}>
        {editing ? (
          <InlineEdit text={item.text} onCancel={onCancel} onSave={(text) => onSave(item.id, text)} />
        ) : (
          <>
            {pictures.length > 0 && (
              <ul className={`${styles.attachments} ${styles.sentPictures}`} aria-label={m.pictures} data-testid="gui-message-pictures">
                {pictures.map((path, i) => (
                  <Attachment key={`${i}:${path}`} path={path} galleryKey={imageKey(item.id, i)} />
                ))}
              </ul>
            )}
            {(item.text.trim() || pictures.length === 0) && (
              <div className={styles.bubble}>
                {header && <span className={styles.bubbleHeader}>{header}</span>}
                <BubbleBody sessionId={sessionId} messageId={item.id} markdown={markdown} />
              </div>
            )}
            {branch && onSwitch && <VersionSwitch branch={branch} onSwitch={onSwitch} />}
            <div className={styles.messageActions} data-testid="gui-message-actions">
              <span className={styles.messageTime}>{timeOf(item.at)}</span>
              <CopyButton text={item.text} />
              {editable && (
                <button type="button" className={styles.actionIcon} aria-label={m.edit} title={m.edit} onClick={() => onStartEdit(item.id)}>
                  <Pencil {...ICON} />
                </button>
              )}
              {editable && onRewind && (
                <button
                  type="button"
                  className={styles.actionIcon}
                  aria-label={m.rewind}
                  title={m.rewind}
                  data-testid="gui-rewind"
                  onClick={(event) => void onRewind(item.id, item.text, event.currentTarget)}
                >
                  <Undo2 {...ICON} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <span className={styles.userAvatar} aria-hidden />
    </div>
  )
})

const lastUserRow = (content: HTMLElement): HTMLElement | null => {
  const rows = content.querySelectorAll<HTMLElement>(`.${styles.userRow}`)
  return rows[rows.length - 1] ?? null
}

/**
 * Figma 98 / 98D: the message `id` just sent, laid out where it lands, comes in from `from` (its first line in the
 * composer). A copy of its bubble flies there on --motion-spring while the bubble itself stays hidden; the copy's fill
 * and the user's picture fade in from 60 ms; the feed above, scrolled `shift` to make room, rides the same spring
 * instead of jumping. A long message, one with only pictures, or reduced motion fades in where it lands instead.
 * Returns what ends the flight at once; `done` runs when it ends.
 */
function flyIn(scroller: HTMLElement, content: HTMLElement, id: string, from: Point, shift: number, done: () => void): () => void {
  const row = content.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`)
  const host = scroller.closest<HTMLElement>('[data-gui-chat]')
  if (!row || !host) {
    done()
    return () => {}
  }
  const css = getComputedStyle(document.documentElement)
  const slide = parseFloat(css.getPropertyValue('--motion-duration-slide')) || 380
  const spring = css.getPropertyValue('--motion-spring').trim() || 'ease-out'
  const easeOut = css.getPropertyValue('--ease-out').trim() || 'ease-out'
  const bubble = row.querySelector<HTMLElement>(`.${styles.bubble}`)
  const words = bubble?.querySelector<HTMLElement>(`.${styles.bubbleText}`)
  const first = (words?.firstElementChild ?? words)?.getBoundingClientRect()
  const flight = flightOf(
    from,
    { x: first?.left ?? 0, y: first?.top ?? 0 },
    words?.offsetHeight ?? 0,
    words ? parseFloat(getComputedStyle(words).lineHeight) : 0,
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  if (flight.kind === 'fade' || !bubble) {
    row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: easeOut })
    done()
    return () => {}
  }
  const at = bubble.getBoundingClientRect()
  const box = host.getBoundingClientRect()
  const copy = bubble.cloneNode(true) as HTMLElement
  copy.className = `${bubble.className} ${styles.flyer}`
  for (const el of copy.querySelectorAll('[data-testid]')) el.removeAttribute('data-testid')
  copy.setAttribute('data-testid', 'gui-message-flight')
  copy.setAttribute('aria-hidden', 'true')
  copy.inert = true
  let top = at.top - box.top
  let dy = flight.dy
  let scrolled = scroller.scrollTop
  copy.style.left = `${at.left - box.left}px`
  copy.style.top = `${top}px`
  copy.style.width = `${at.width}px`
  host.append(copy)
  row.setAttribute('data-landing', '')
  const fadeIn = { duration: 200, delay: 60, easing: easeOut, fill: 'backwards' } as const
  const path = (): Keyframe[] => [{ transform: `translate(${flight.dx}px, ${dy}px)` }, { transform: 'none' }]
  const slideIn = copy.animate(path(), { duration: slide, easing: spring })
  const animations = [
    slideIn,
    // To the bubble's own fill, so it follows a theme changed on the way.
    copy.animate([{ backgroundColor: 'transparent', offset: 0 }], fadeIn),
    ...[...row.querySelectorAll<HTMLElement>(`.${styles.userAvatar}, .${styles.sentPictures}`)].map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], fadeIn)),
    ...(shift ? [content.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: slide, easing: spring })] : []),
  ]
  // The feed may scroll again while it flies (the run row, the reply): the landing place moves with it, where it left
  // from stays.
  const follow = (): void => {
    const delta = scroller.scrollTop - scrolled
    if (!delta) return
    scrolled = scroller.scrollTop
    top -= delta
    dy += delta
    copy.style.top = `${top}px`
    ;(slideIn.effect as KeyframeEffect | null)?.setKeyframes(path())
  }
  scroller.addEventListener('scroll', follow, { passive: true })
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    scroller.removeEventListener('scroll', follow)
    for (const animation of animations) animation.cancel()
    copy.remove()
    for (const el of content.querySelectorAll('[data-landing]')) el.removeAttribute('data-landing')
    done()
  }
  void slideIn.finished.then(end, end)
  return end
}

const FOLD_STYLE = { '--fold-rows': FOLD_ROWS } as CSSProperties

/**
 * Figma 96A: the words of a message of yours. A long one opens folded to its first lines, the last two fading, over
 * 「展开」; opened, 「收起」 at its foot folds it again. Whether it is open is kept in the store by message id (a block
 * scrolled away or a session switched away from keeps it). The button stays where it was on screen: the feed scrolls by
 * however far it moved.
 */
function BubbleBody({ sessionId, messageId, markdown }: { sessionId: SessionId; messageId: string; markdown: string }) {
  const m = useMessages(M)
  const expanded = useGuiSessions((s) => s.expanded[sessionId]?.has(messageId) ?? false)
  const [foldable, setFoldable] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Where the button was before a click, to put it back there once the bubble has its new height.
  const anchor = useRef<number | null>(null)

  // Measured before the first paint, so a long message never shows whole for a frame; again whenever its words reflow
  // (the feed's width, 对话 · 字号). The words' own height is not cut by the fold around them.
  useLayoutEffect(() => {
    const words = bodyRef.current?.firstElementChild
    if (!(words instanceof HTMLElement)) return
    const measure = (): void => {
      const height = words.offsetHeight
      // 0: not laid out (a hidden panel); it says nothing about the message.
      if (height > 0) setFoldable(foldsMessage(height, parseFloat(getComputedStyle(words).lineHeight), FOLD_ROWS))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(words)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const was = anchor.current
    anchor.current = null
    const button = toggleRef.current
    const scroller = button?.closest<HTMLElement>('[data-region="gui-feed"]')
    if (was !== null && button && scroller) scroller.scrollTop += button.getBoundingClientRect().top - was
  }, [expanded])

  const toggle = (): void => {
    anchor.current = toggleRef.current?.getBoundingClientRect().top ?? null
    setMessageExpanded(sessionId, messageId, !expanded)
  }
  const folded = foldable && !expanded
  return (
    <>
      <div ref={bodyRef} className={styles.bubbleBody} style={FOLD_STYLE} data-folded={folded || undefined}>
        <ChatMarkdown sessionId={sessionId} text={markdown} className={styles.bubbleText} />
      </div>
      {foldable && (
        <button ref={toggleRef} type="button" className={styles.foldToggle} aria-expanded={expanded} onClick={toggle} data-testid="gui-message-fold">
          {expanded ? m.showLess : m.showMore}
          {expanded ? <ChevronUp size={12} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={12} strokeWidth={1.75} aria-hidden />}
        </button>
      )}
    </>
  )
}

/** Figma 90G′: ‹ 1 / 2 › under an edited message, always shown. */
function VersionSwitch({ branch, onSwitch }: { branch: BranchSwitch; onSwitch(messageId: string, index: number): void }) {
  const m = useMessages(M)
  return (
    <div className={styles.versionSwitch} data-testid="gui-version-switch">
      <button type="button" className={styles.actionIcon} aria-label={m.previousVersion} disabled={branch.index === 0} onClick={() => onSwitch(branch.messageId, branch.index - 1)}>
        <ChevronLeft {...ICON} />
      </button>
      <span className={styles.versionCount}>
        {branch.index + 1} / {branch.count}
      </span>
      <button type="button" className={styles.actionIcon} aria-label={m.nextVersion} disabled={branch.index === branch.count - 1} onClick={() => onSwitch(branch.messageId, branch.index + 1)}>
        <ChevronRight {...ICON} />
      </button>
    </div>
  )
}

/** 54C: the message as text to change; ⏎ sends it in the original's place (the rest is dropped), ⎋ cancels. */
function InlineEdit({ text, onCancel, onSave }: { text: string; onCancel(): void; onSave(text: string): Promise<string | null> }) {
  const m = useMessages(M)
  const [draft, setDraft] = useState(text)
  const [sending, setSending] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const submit = (): void => {
    if (!draft.trim() || sending) return
    setSending(true)
    void onSave(draft).then((reason) => {
      if (reason) setSending(false)
    })
  }
  const onKeyDown = (event: KeyboardEvent, caret: CaretContext): boolean => {
    if (event.key === 'Escape' && !event.isComposing) {
      onCancel()
      return true
    }
    const { key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing } = event
    const action = composerKey({ key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing }, { menuOpen: false, busy: false, inCode: caret.inCode })
    if (action === 'send') {
      submit()
      return true
    }
    // ⏎ in a code block is the editor's (three in a row leave it).
    if (action !== 'newline' || (caret.inCode && !shiftKey) || !editorRef.current) return false
    insertNewline(editorRef.current, caret)
    return true
  }
  return (
    <div
      className={styles.editBox}
      data-testid="gui-edit"
      // ⎋ from its buttons too.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <ComposerEditor draft={draft} onChange={setDraft} onKeyDown={onKeyDown} editorRef={editorRef} label={m.editMessage} autoFocus />
      <div className={styles.editButtons}>
        <button type="button" className={styles.button} disabled={sending} onClick={onCancel}>
          {m.cancel}
        </button>
        <button type="button" className={styles.button} data-primary="true" disabled={sending || !draft.trim()} onClick={submit}>
          {m.send}
        </button>
      </div>
    </div>
  )
}

function ToolIconMark({ icon }: { icon: ToolIcon }) {
  const Icon = TOOL_ICONS[icon]
  return <Icon {...ICON} />
}

/**
 * A step row's mark (Figma 59J, 94′): the tool's icon, or its status while it waits on you or failed. `label` names a
 * state the icon does not show (运行中, its words swept instead) for screen readers.
 */
function StepMark({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span className={styles.stepMark} role={label ? 'img' : undefined} aria-label={label}>
      {children}
    </span>
  )
}

/** One sweep of `.shimmer` and its pause (its only definition: the stylesheet gets it inline). */
const SHIMMER_MS = 2000

/**
 * Figma 94′: words for what is still happening (思考中, 运行 pnpm test), a band of light sweeping them left to right.
 * Its phase comes from the wall clock, so every row on screen sweeps together; `on` false leaves the words as they are.
 */
function Shimmer({ on = true, className, role, children }: { on?: boolean; className?: string; role?: string; children: ReactNode }) {
  const [delay] = useState(() => `${-(Date.now() % SHIMMER_MS)}ms`)
  if (!on) return <>{children}</>
  return (
    <span className={`${styles.shimmer} ${className ?? styles.shimmerGroup}`} style={{ animationDuration: `${SHIMMER_MS}ms`, animationDelay: delay }} role={role}>
      {children}
    </span>
  )
}

function Thinking({ item }: { item: Extract<StepItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.thinking}>
      <button type="button" className={styles.thinkingRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepMark>
          <Brain {...ICON} />
        </StepMark>
        <span>{thinkingLabel(item.ms)}</span>
        {open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}
      </button>
      {open && item.text && <p className={styles.thinkingText}>{item.text}</p>}
    </div>
  )
}

/**
 * Figma 70′B / 70C: a run of calls as one row — › · what they did (读取了 2 个文件，运行了 1 条命令) · +N −M · N 个失败; while
 * one runs, the mark turns and the call follows the summary (· 运行 pnpm test). Opened, its rows are listed right of a
 * line as under a subagent's row, up to 320 high.
 */
function ToolGroup({ items, nested }: { items: readonly StepItem[]; nested: ReadonlyMap<string, readonly NestedItem[]> }) {
  const m = useMessages(M)
  const [open, setOpen] = useState(false)
  const view = groupView(items)
  return (
    <div className={styles.tool} data-testid="gui-tool-group">
      <button type="button" className={styles.toolRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepMark label={view.live ? STATUS_LABEL.running : undefined}>{view.live ? <ToolIconMark icon={view.live.icon} /> : open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}</StepMark>
        <span className={styles.groupText}>{view.text}</span>
        {view.live && (
          <Shimmer>
            <span className={styles.toolVerb}>· {view.live.verb}</span>
            <span className={styles.groupArg}>{view.live.arg}</span>
          </Shimmer>
        )}
        <span className={styles.groupFill} />
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.failed > 0 && <span className={styles.failed}>{m.failed(view.failed)}</span>}
      </button>
      {/* Figma 112F: closed, the group still shows the pictures of its calls (open, each row shows its own). */}
      {!open && items.map((item) => (item.kind === 'tool' && item.images ? <ImageRow key={item.id} paths={item.images} itemId={item.id} indent /> : null))}
      {open && (
        <div className={`${styles.subagentSteps} ${styles.groupSteps}`} data-testid="gui-tool-group-steps">
          {items.map((item) => (item.kind === 'thinking' ? <Thinking key={item.id} item={item} /> : <Tool key={item.id} item={item} nested={nested} waitingTool={null} />))}
        </div>
      )}
    </div>
  )
}

/** Calls that read one web page (Claude WebFetch, an ACP agent's fetch). */
const isFetch = (name: string): boolean => name === 'WebFetch' || name === 'Fetch'

const NO_NESTED: ReadonlyMap<string, readonly NestedItem[]> = new Map()
const NO_CHILDREN: readonly NestedItem[] = []

/**
 * A tool row. Figma 59J: a subagent's row (Agent / Task, a Codex collab call) reads 子 agent · its task · ⌄ with how long
 * it ran at the end; what the subagent did is listed under it, after a line — open while it runs, closed once done.
 */
function Tool({
  item,
  waitingTool,
  nested = NO_NESTED
}: {
  item: Extract<ChatItem, { kind: 'tool' }>
  waitingTool: string | null
  nested?: ReadonlyMap<string, readonly NestedItem[]>
}) {
  const m = useMessages(M)
  const subagent = isSubagentTool(item.name)
  const children = (subagent && nested.get(item.id)) || NO_CHILDREN
  // null: as the row's state says (a subagent's open while it runs); a click decides from then on.
  const [chosen, setOpen] = useState<boolean | null>(null)
  const open = chosen ?? (subagent && item.state === 'running')
  const view = toolView(item, item.id === waitingTool)
  // Figma 59J: one block per file; a single file's path is on the row already.
  const files = item.files ?? (item.diff ? [item.diff] : [])
  const hasChildren = children.length > 0
  const expandable = view.expandable || hasChildren
  // Figma 90D: a test command's results, read from what it printed.
  const tests = useMemo(() => (view.icon === 'terminal' && item.state !== 'running' && view.output ? testResults(view.output) : null), [view.icon, view.output, item.state])
  // Figma 90B: a fetched page by its title (when a search found it) and site, not its whole URL.
  const titles = useContext(PageTitles)
  const fetched = isFetch(item.name) && /^https?:\/\//i.test(item.arg) ? { title: titles.get(item.arg) ?? shortUrl(item.arg), site: titles.has(item.arg) ? siteOf(item.arg) : '' } : null
  return (
    <div className={styles.tool} data-subagent={subagent || undefined}>
      <button type="button" className={styles.toolRow} aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => setOpen(!open)}>
        <StepMark label={view.status === 'running' ? STATUS_LABEL.running : undefined}>{view.status === 'done_unread' || view.status === 'running' ? <ToolIconMark icon={view.icon} /> : <StatusGlyph status={view.status} />}</StepMark>
        <Shimmer on={view.status === 'running'}>
          <span className={styles.toolVerb} title={view.name}>
            {view.verb}
          </span>
          {fetched ? (
            <>
              <span className={styles.pageTitle}>{fetched.title}</span>
              <span className={styles.toolArg}>{fetched.site}</span>
            </>
          ) : (
            <span className={subagent ? styles.subagentArg : styles.toolArg}>{view.arg}</span>
          )}
        </Shimmer>
        {subagent && expandable && <span className={styles.chevron}>{open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}</span>}
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.waiting && <span className={styles.waiting}>{m.waiting}</span>}
        {tests ? (
          <>
            {tests.failed > 0 && <span className={styles.testCountFailed}>{m.testsFailed(tests.failed)}</span>}
            <span className={tests.failed > 0 ? styles.testCount : styles.toolMeta}>{m.testsPassed(tests.passed)}</span>
            {tests.duration && <span className={styles.testDuration}>{tests.duration}</span>}
          </>
        ) : (
          view.exit !== undefined && <span className={styles.exit}>exit {view.exit}</span>
        )}
        {subagent && <Elapsed item={item} />}
        {item.links && item.links.length > 0 && <span className={styles.toolMeta}>{m.results(item.links.length)}</span>}
      </button>
      {/* Figma 112F: the pictures it returned, under the row, closed or open. */}
      {item.images && <ImageRow paths={item.images} itemId={item.id} indent />}
      {hasChildren ? (
        open && (
          <div className={styles.subagentSteps} data-testid="gui-subagent-steps">
            {children.map((child) =>
              child.kind === 'text' ? (
                <p key={child.id} className={styles.subagentText}>
                  {child.text}
                </p>
              ) : child.kind === 'thinking' ? (
                <Thinking key={child.id} item={child} />
              ) : (
                <Tool key={child.id} item={child} nested={nested} waitingTool={waitingTool} />
              )
            )}
          </div>
        )
      ) : (
        <ToolBody item={item} open={open} files={files} view={view} tests={tests} />
      )}
    </div>
  )
}

/** Under a row: its summary while closed; open, its task list, its files' changes or its output. */
function ToolBody({ item, open, files, view, tests }: { item: Extract<ChatItem, { kind: 'tool' }>; open: boolean; files: FileDiff[]; view: ToolView; tests: TestRun | null }) {
  const m = useMessages(M)
  const sessionId = useContext(RefSession)
  return (
    <>
      {view.summary && !open && !tests && <p className={styles.toolSummary}>{view.summary}</p>}
      {open && tests && (
        <TestResults
          results={tests}
          output={
            <div className={styles.codeWrap}>
              <Output raw={item.output ?? ''} command={view.command} />
              <CopyButton text={() => view.output ?? ''} label={m.copyOutput} className={styles.cornerCopy} />
            </div>
          }
        />
      )}
      {open && item.todos && item.todos.length > 0 && <TodoList todos={item.todos} className={styles.todosInFeed} />}
      {open && item.links && item.links.length > 0 && sessionId && <SearchResults sessionId={sessionId} links={item.links} />}
      {open && !tests && !item.todos && !item.links?.length && (files.length > 0 || view.output || view.command) && (
        <div className={styles.codeWrap}>
          {files.length > 0 ? (
            <div className={styles.fileBlocks}>
              {files.map((file, i) => (
                <DiffBlock key={i} diff={file} header={files.length > 1} />
              ))}
            </div>
          ) : (
            <Output raw={item.output ?? ''} command={view.command} />
          )}
          <CopyButton
            text={() => (files.length > 0 ? diffText(files) : view.output?.trim() ? view.output : (view.command ?? ''))}
            label={m.copyOutput}
            className={styles.cornerCopy}
          />
        </div>
      )}
    </>
  )
}

/**
 * A subagent row's time at its end: since it started while it runs (counted each second, only while the row is on
 * screen), its own duration once done.
 */
function Elapsed({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const running = item.state === 'running'
  const ref = useRef<HTMLSpanElement>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const el = ref.current
    if (!running || !el) return
    let timer: number | undefined
    const stop = (): void => {
      window.clearInterval(timer)
      timer = undefined
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return stop()
      setNow(Date.now())
      timer ??= window.setInterval(() => setNow(Date.now()), 1000)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [running])
  const label = subagentElapsed(item, now)
  return (
    <span ref={ref} className={styles.elapsed} data-testid="gui-subagent-time">
      {label}
    </span>
  )
}

/**
 * What a command printed, in its colors (the --term-* ones), under `$ <command>` when the agent gave its whole text
 * (Figma 59J); the copy button copies the text alone. Figma 90E: file locations in it are links (FileRef), and two or
 * more stack frames in dependencies in a row fold into one row that opens them.
 */
function Output({ raw, command }: { raw: string; command?: string }) {
  const runs = useMemo(() => outputRuns(raw), [raw])
  return (
    <pre className={styles.output}>
      {command !== undefined && (
        <span className={styles.outputCommand} data-testid="gui-output-command">
          $ {command}
          {raw ? '\n' : ''}
        </span>
      )}
      {runs.map((run, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {run.kind === 'frames' ? <FoldedFrames text={run.text} count={run.count} /> : <OutputText raw={run.text} />}
        </Fragment>
      ))}
    </pre>
  )
}

/** Output text in its colors, its file locations as links. */
const OutputText = memo(function OutputText({ raw }: { raw: string }) {
  const spans = useMemo(() => ansiSpans(raw), [raw])
  return (
    <>
      {spans.map((span, i) => {
        const text = refPieces(span.text).map((piece, j) =>
          typeof piece === 'string' ? (
            piece
          ) : (
            <FileRef key={j} target={piece.target}>
              {piece.text}
            </FileRef>
          )
        )
        return span.fg || span.bold || span.dim ? (
          <span key={i} className={styles.ansi} data-fg={span.fg} data-bold={span.bold} data-dim={span.dim}>
            {text}
          </span>
        ) : (
          <Fragment key={i}>{text}</Fragment>
        )
      })}
    </>
  )
})

/** Figma 90E: 「› node_modules 里的 7 帧」; opened, the frames themselves. */
function FoldedFrames({ text, count }: { text: string; count: number }) {
  const m = useMessages(M)
  const [open, setOpen] = useState(false)
  if (open) return <OutputText raw={text} />
  return (
    <button type="button" className={styles.foldedFrames} onClick={() => setOpen(true)} data-testid="gui-folded-frames">
      <ChevronRight {...ICON} className={styles.rowChevron} />
      {m.dependencyFrames(count)}
    </button>
  )
}

/**
 * Figma 91 / 94′: the running turn's last row, there from the moment the message is sent — the step running now (its
 * icon, verb and target) or 思考中 with the brain, the words swept by light, and the turn's clock.
 */
function RunLine({ run }: { run: RunRow }) {
  const m = useMessages(M)
  const view = run.tool ? toolView(run.tool, false) : null
  return (
    <div className={styles.runRow} data-testid="gui-run-row">
      <StepMark>{view ? <ToolIconMark icon={view.icon} /> : <Brain {...ICON} />}</StepMark>
      <Shimmer className={styles.runLabel} role="status">
        {view ? `${view.verb} ${view.arg}` : m.thinking}
      </Shimmer>
      <RunClock since={run.since} />
    </div>
  )
}

/**
 * Figma 91D: how long the turn has run, to the tenth under a minute; a digit that changes rolls up into place. It ticks
 * only while on screen.
 */
function RunClock({ since }: { since: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    const stop = (): void => {
      window.clearTimeout(timer)
      timer = undefined
    }
    // Next tick on the clock's own edge: every tenth under a minute, every second after.
    const tick = (): void => {
      const at = Date.now()
      setNow(at)
      const ran = Math.max(0, at - since)
      timer = window.setTimeout(tick, ran < 60_000 ? 100 - (ran % 100) : 1000 - (ran % 1000))
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return stop()
      if (timer === undefined) tick()
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [since])
  const text = runClock(now - since)
  // The text drawn before this one: which digits roll (state adjusted while rendering, as in ChatPane).
  const [shown, setShown] = useState({ text, before: text })
  if (shown.text !== text) setShown({ text, before: shown.text })
  const before = shown.text === text ? shown.before : shown.text
  const same = before.length === text.length
  return (
    <span ref={ref} className={styles.runClock} aria-hidden data-testid="gui-run-clock">
      {[...text].map((char, i) =>
        same && before[i] !== char && /\d/.test(char) ? (
          <span key={`${i}:${before[i]}${char}`} className={styles.runDigit}>
            <span className={styles.runRoll}>
              <span>{before[i]}</span>
              <span>{char}</span>
            </span>
          </span>
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </span>
  )
}
