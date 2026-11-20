// What the window does with main's 自动领取 records (PRD F26), kept out of React so the rules are testable: which record
// belongs to a session (or to a 看板 row), what a record's session means right now (a turn ended, or it is gone), and the
// worktree the acceptance runs in. The runner (runner.ts) turns these answers into IPC calls.
import type { GitHubLink } from '@shared/types'
import type { Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import type { IssueRecord } from '@shared/issue-watch'

/** A turn ended here: the record goes on to 验收 (as 定时任务's auto-archive reads it). */
const TURN_ENDED: ReadonlySet<SessionStatus> = new Set(['done_unread', 'idle'])

export const issueLink = (record: Pick<IssueRecord, 'repo' | 'number'>): GitHubLink => ({ repo: record.repo, kind: 'issue', number: record.number })

/** The record a session works on (main stores the session id). */
export const recordForSession = (records: readonly IssueRecord[], sessionId: SessionId | undefined): IssueRecord | undefined =>
  sessionId === undefined ? undefined : records.find((r) => r.sessionId === sessionId)

/** The newest record for an issue (`host/owner/repo#n`), for 看板 · GitHub's row. */
export const recordFor = (records: readonly IssueRecord[], repo: string, number: number): IssueRecord | undefined =>
  records.find((r) => r.repo.toLowerCase() === repo.toLowerCase() && r.number === number)

export type ReconcileStep =
  /** Not this runner's: 待批准 / 已合并 / 已放弃, or the acceptance main runs right now. */
  | { type: 'ignore' }
  /** Its session is gone, or its worktree was archived: this one ends. */
  | { type: 'drop'; reason: 'session-gone' | 'archived' }
  /** No turn has ended since the record got where it is. */
  | { type: 'wait' }
  /** A turn ended (also while the window was away): no changes, the acceptance, or the next fix. */
  | { type: 'run' }

/**
 * What to do with one active record now. `session` is its session from the workspace (undefined once it was closed);
 * `archived`: its worktree was archived. A turn counts when it ended after the record got to where it is — for 处理中
 * the claim, for 修复中 the acceptance that asked for the fix — so a reload or a restart picks a finished turn up again
 * without treating the session's idle moment *before* its first turn as one.
 */
export function reconcileStep(
  record: Pick<IssueRecord, 'state' | 'claimedAt' | 'acceptance'>,
  session: Pick<Session, 'status' | 'finishedAt'> | undefined,
  archived: boolean
): ReconcileStep {
  if (record.state !== 'working' && record.state !== 'fixing' && record.state !== 'accepting') return { type: 'ignore' }
  // 验收中: main runs the command; nothing here until it answers.
  if (record.state === 'accepting') return { type: 'ignore' }
  if (archived) return { type: 'drop', reason: 'archived' }
  if (!session) return { type: 'drop', reason: 'session-gone' }
  if (!TURN_ENDED.has(session.status)) return { type: 'wait' }
  const since = record.state === 'fixing' ? (record.acceptance?.at ?? record.claimedAt) : record.claimedAt
  return (session.finishedAt ?? 0) > since ? { type: 'run' } : { type: 'wait' }
}

/** The worktree a session is in (its `worktreeId`); undefined once it is gone. */
export const worktreeOfSession = (worktrees: readonly Worktree[], session: Pick<Session, 'worktreeId'> | undefined): Worktree | undefined =>
  session === undefined ? undefined : worktrees.find((w) => w.id === session.worktreeId)

/** The record's session and worktree, or what became of them (the runner's drop reasons name them). */
export function sessionOf(
  sessions: readonly Session[],
  worktrees: readonly Worktree[],
  record: Pick<IssueRecord, 'sessionId'>
): { session: Session | undefined; worktree: Worktree | undefined } {
  const session = record.sessionId === undefined ? undefined : sessions.find((s) => s.id === record.sessionId)
  return { session, worktree: worktreeOfSession(worktrees, session) }
}
