// 自动领取's report at the top of Git · 变更 (PRD F26, Figma 102B1 / 102B2 验收没过): on the panel itself — the issue's
// state glyph, number and title with a link to GitHub, 自动领取 · author · when, the acceptance (a check or an alert, 验收通过
// / 验收没过, the command, how many fix rounds, the output when it failed), and the agent's last reply. 批准 is not here:
// it is the exit zone's primary while the issue waits (Figma 102B3 / 102B4). A claim that could not assign or add 👀 says
// so on the meta line.
import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, CircleCheck, CircleDot, ExternalLink } from '../ui/icons'
import { issueStateLabel } from '@shared/issue-watch'
import { defineMessages } from '@shared/i18n'
import type { SessionId } from '@shared/types'
import { useMessages } from '../ui/i18n'
import { formatElapsed } from '../sidebar/format-elapsed'
import { useNow } from '../schedules/store'
import { useWorkspace } from '../state/workspace'
import { useRecordForSession } from './store'
import styles from './IssueWatch.module.css'

const M = defineMessages({
  zh: {
    claimed: '自动领取',
    ago: (elapsed: string) => `${elapsed} 前`,
    open: '在 GitHub 上打开',
    passed: '验收通过',
    failed: '验收没过',
    timedOut: '验收超时',
    fixing: '验收没过，正在修…',
    running: '正在跑验收命令…',
    fixes: (n: number) => `修了 ${n} 轮`,
    showOutput: '看输出',
    hideOutput: '收起输出',
    claimFailed: (note: string) => `领取时：${note}`
  },
  en: {
    claimed: 'Auto-claimed',
    ago: (elapsed: string) => `${elapsed} ago`,
    open: 'Open on GitHub',
    passed: 'Acceptance passed',
    failed: 'Acceptance failed',
    timedOut: 'Acceptance timed out',
    fixing: 'Failed; fixing it…',
    running: 'Running the acceptance command…',
    fixes: (n: number) => (n === 1 ? 'fixed once' : `fixed ${n} times`),
    showOutput: 'Show output',
    hideOutput: 'Hide output',
    claimFailed: (note: string) => `When claimed: ${note}`
  }
})

const openOnGitHub = (url: string): void => {
  if (/^https:\/\//i.test(url)) window.open(url, '_blank')
}

export function IssueReport({ sessionId }: { sessionId: SessionId | null }) {
  const m = useMessages(M)
  const now = useNow()
  const record = useRecordForSession(sessionId ?? undefined)
  const reply = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId)?.lastReply)
  const [showOutput, setShowOutput] = useState(false)
  // Abandoned: its issue closed on GitHub or its session went, so there is nothing left to read (PRD F26 批准).
  if (!record || record.state === 'dropped') return null
  const acceptance = record.acceptance
  const failed = acceptance !== undefined && !acceptance.passed
  const stateWord = issueStateLabel[record.state]
  return (
    <section className={styles.report} data-testid="issue-report" data-state={record.state} aria-label={`#${record.number} ${stateWord}`}>
      <div className={styles.head}>
        {/* The issue's own state (Figma 102B1 / 102B4): open, or closed once the merge closed it — never the acceptance's. */}
        {record.state === 'merged' ? <CircleCheck size={16} strokeWidth={1.75} aria-hidden className={styles.issueGlyph} /> : <CircleDot size={16} strokeWidth={1.75} aria-hidden className={styles.issueGlyph} />}
        <span className={styles.number}>#{record.number}</span>
        <span className={styles.title}>{record.title}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.linkButton} title={m.open} aria-label={m.open} onClick={() => openOnGitHub(record.url)}>
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <p className={styles.meta}>
        {m.claimed} · {record.author} · {m.ago(formatElapsed(now - record.claimedAt))}
        {record.note && (
          <>
            {' · '}
            <span className={styles.note}>{m.claimFailed(record.note)}</span>
          </>
        )}
      </p>
      {(record.state === 'accepting' || record.state === 'fixing' || acceptance || record.reason) && (
      <p className={styles.acceptance} data-testid="issue-report-acceptance" data-tone={failed ? 'error' : undefined}>
        {record.state === 'accepting' ? (
          <span className={styles.muted}>{m.running}</span>
        ) : acceptance ? (
          <>
            {acceptance.passed ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden /> : <AlertCircle size={14} strokeWidth={1.75} aria-hidden />}
            <span className={styles.verdict}>{acceptance.passed ? m.passed : acceptance.timedOut ? m.timedOut : m.failed}</span>
            <span className={styles.command}>{acceptance.command}</span>
            {record.rounds > 0 && <span className={styles.muted}>{m.fixes(record.rounds)}</span>}
            {!acceptance.passed && (
              <button type="button" className={styles.linkButton} onClick={() => setShowOutput(!showOutput)} aria-expanded={showOutput}>
                {showOutput ? <ChevronDown size={12} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={12} strokeWidth={1.75} aria-hidden />}
                {showOutput ? m.hideOutput : m.showOutput}
              </button>
            )}
          </>
        ) : (
          <>
            {record.state === 'fixing' ? <AlertCircle size={14} strokeWidth={1.75} aria-hidden /> : <CircleCheck size={14} strokeWidth={1.75} aria-hidden />}
            <span className={styles.verdict}>{record.state === 'fixing' ? m.fixing : record.reason}</span>
          </>
        )}
      </p>
      )}
      {showOutput && acceptance?.output && <pre className={styles.output}>{acceptance.output}</pre>}
      {reply && <p className={styles.reply}>{reply}</p>}
    </section>
  )
}
