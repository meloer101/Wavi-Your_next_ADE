// The auto-claimed issue's report at the top of Git · 变更 (PRD F26, Figma 102B1 / 102B2 验收没过 / 102B3 批准后 / 102B4
// 完成): the issue (number, title, open on GitHub), 验收 (the command, pass / fail, how many fixes, the output when it
// failed), the agent's last reply and the change's size, then the one primary — 批准 — which runs 合并 (closing the
// issue) and 推送 of the base through the merge chain. A claim that could not assign or add 👀 says so here too.
import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from '../ui/icons'
import { issueStateLabel } from '@shared/issue-watch'
import { defineMessages } from '@shared/i18n'
import type { SessionId, Worktree } from '@shared/types'
import { useMessages } from '../ui/i18n'
import { useGit } from '../panels/git/store'
import { useShips } from '../pull-requests/ship-runner'
import { useWorkspace } from '../state/workspace'
import { approveIssue } from './approve'
import { useRecordForSession } from './store'
import styles from './IssueWatch.module.css'

const M = defineMessages({
  zh: {
    issue: (n: number) => `#${n}`,
    open: '在 GitHub 上打开',
    acceptance: '验收',
    notChecked: '未验收：没有设置验收命令',
    running: '正在跑验收命令…',
    passed: '通过',
    failed: '失败',
    timedOut: '超时',
    fixes: (n: number) => `修了 ${n} 轮`,
    showOutput: '看输出',
    hideOutput: '收起输出',
    reply: '回复',
    replyTitle: 'agent 的最后一段回复',
    files: (n: number) => `${n} 个文件`,
    approve: '批准',
    approving: '正在合并并推送…',
    acceptFailed: '验收没过',
    claimNote: (note: string) => `领取时：${note}`,
    merged: '已合并并推送',
    dropped: '已放弃'
  },
  en: {
    issue: (n: number) => `#${n}`,
    open: 'Open on GitHub',
    acceptance: 'Acceptance',
    notChecked: 'Not checked: no acceptance command set',
    running: 'Running the acceptance command…',
    passed: 'Passed',
    failed: 'Failed',
    timedOut: 'Timed out',
    fixes: (n: number) => (n === 1 ? 'fixed once' : `fixed ${n} times`),
    showOutput: 'Show output',
    hideOutput: 'Hide output',
    reply: 'Reply',
    replyTitle: 'The agent’s last reply',
    files: (n: number) => (n === 1 ? '1 file' : `${n} files`),
    approve: 'Approve',
    approving: 'Merging and pushing…',
    acceptFailed: 'Acceptance failed',
    claimNote: (note: string) => `When claimed: ${note}`,
    merged: 'Merged and pushed',
    dropped: 'Abandoned'
  }
})

const openOnGitHub = (url: string): void => {
  if (/^https:\/\//i.test(url)) window.open(url, '_blank')
}

/** The change's size as the diff list counts it: committed first, then uncommitted files the commits do not have. */
function changeSize(changes: { committed: { path: string; added: number | null; removed: number | null }[]; uncommitted: { path: string; added: number | null; removed: number | null }[] } | null): {
  files: number
  added: number
  removed: number
} {
  const seen = new Set<string>()
  let files = 0
  let added = 0
  let removed = 0
  for (const file of [...(changes?.committed ?? []), ...(changes?.uncommitted ?? [])]) {
    if (seen.has(file.path)) continue
    seen.add(file.path)
    files += 1
    added += file.added ?? 0
    removed += file.removed ?? 0
  }
  return { files, added, removed }
}

export function IssueReport({ worktree, sessionId }: { worktree: Worktree; sessionId: SessionId | null }) {
  const m = useMessages(M)
  const record = useRecordForSession(sessionId ?? undefined)
  const changes = useGit((s) => s.roots[worktree.path]?.changes ?? null)
  const reply = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId)?.lastReply)
  const runActive = useShips((s) => s.byWorktree[worktree.path] !== undefined)
  const [showOutput, setShowOutput] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The item ends once it was abandoned (its issue closed on GitHub, or its session archived): nothing to report then.
  if (!record || !sessionId || record.state === 'dropped') return null
  const acceptance = record.acceptance
  const size = changeSize(changes)
  const failed = acceptance !== undefined && !acceptance.passed
  const awaiting = record.state === 'awaiting'
  const approve = (): void => {
    if (busy || runActive) return
    setBusy(true)
    setError(null)
    void approveIssue(record, worktree.path, sessionId)
      .then((result) => {
        if (!result.ok) setError(result.message)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <section className={styles.block} data-testid="issue-report" data-state={record.state}>
      <div className={styles.head}>
        <span className={styles.number}>{m.issue(record.number)}</span>
        <span className={styles.title}>{record.title}</span>
        <span className={styles.state}>{issueStateLabel[record.state]}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.linkButton} title={m.open} aria-label={m.open} onClick={() => openOnGitHub(record.url)}>
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <p className={styles.row} data-testid="issue-report-acceptance">
        <span className={styles.label}>{m.acceptance}</span>
        {record.state === 'accepting' ? (
          <span className={styles.value}>{m.running}</span>
        ) : acceptance ? (
          <>
            <span className={styles.command}>{acceptance.command}</span>
            <span className={styles.value} data-tone={acceptance.passed ? undefined : 'error'}>
              {acceptance.passed ? m.passed : acceptance.timedOut ? m.timedOut : m.failed}
            </span>
            {record.rounds > 0 && <span className={styles.muted}>{m.fixes(record.rounds)}</span>}
            {!acceptance.passed && (
              <button type="button" className={styles.linkButton} onClick={() => setShowOutput(!showOutput)} aria-expanded={showOutput}>
                {showOutput ? <ChevronDown size={12} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={12} strokeWidth={1.75} aria-hidden />}
                {showOutput ? m.hideOutput : m.showOutput}
              </button>
            )}
          </>
        ) : (
          <span className={styles.muted}>{record.reason ?? m.notChecked}</span>
        )}
      </p>
      {showOutput && acceptance?.output && <pre className={styles.output}>{acceptance.output}</pre>}

      <p className={styles.row}>
        <span className={styles.label} title={m.replyTitle}>
          {m.reply}
        </span>
        <span className={styles.reply} title={reply ?? undefined}>
          {reply ?? ''}
        </span>
      </p>

      <p className={styles.row}>
        <span className={styles.muted}>
          {`+${size.added} −${size.removed} · ${m.files(size.files)}`}
        </span>
        {record.note && (
          <>
            <span className={styles.spacer} />
            <span className={styles.note} title={record.note}>
              {m.claimNote(record.note)}
            </span>
          </>
        )}
      </p>

      {awaiting && (
        <div className={styles.footer}>
          {error && <span className={styles.error}>{error}</span>}
          <span className={styles.spacer} />
          {failed && <span className={styles.muted}>{m.acceptFailed}</span>}
          <button type="button" className={styles.primary} disabled={busy || runActive} onClick={approve} data-testid="issue-approve">
            {busy || runActive ? m.approving : m.approve}
          </button>
        </div>
      )}
    </section>
  )
}
