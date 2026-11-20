// 批准's three steps in the exit zone (PRD F26, Figma 102B3 批准后 / 102B4 完成): 合并到 main → 推送前审阅 → 推送 main, each
// with a status glyph and its detail on the right — the squash commit, the review's range or its result, and on the last
// one 「issue #N 已关闭」 once the push closed it. When all are done the 归档 primary sits under them (102B4).
import type { IssueRecord } from '@shared/issue-watch'
import { defineMessages } from '@shared/i18n'
import type { ShipState } from '@shared/ship'
import type { SessionStatus } from '@shared/types'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './IssueWatch.module.css'

const M = defineMessages({
  zh: {
    merge: '合并到 main',
    review: '推送前审阅',
    push: '推送 main',
    commits: (n: number) => `${n} 个提交`,
    noP1: '没有 P1',
    notReviewed: '没有审阅',
    closed: (n: number) => `issue #${n} 已关闭`,
    running: '进行中',
    archive: '归档'
  },
  en: {
    merge: 'Merged into main',
    review: 'Review before push',
    push: 'Push main',
    commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
    noP1: 'No P1',
    notReviewed: 'Not reviewed',
    closed: (n: number) => `issue #${n} closed`,
    running: 'Running',
    archive: 'Archive'
  }
})

type Step = { label: string; status: SessionStatus; detail: string }

const short = (sha: string): string => sha.slice(0, 7)

export function IssueApproval({ record, run, onArchive }: { record: IssueRecord; run: ShipState | null; onArchive: () => void }) {
  const m = useMessages(M)
  const approval = record.approval
  const merged = record.state === 'merged'
  const merging = !approval && run?.kind === 'main' && run.error === null
  const pushing = approval !== undefined && !merged && run?.kind === 'push-base' && run.error === null
  const commits = approval?.commits ?? 0
  const steps: Step[] = [
    {
      label: m.merge,
      status: approval ? 'done_unread' : merging ? 'running' : 'idle',
      detail: approval ? short(approval.merge) : merging ? m.running : ''
    },
    {
      label: m.review,
      status: approval ? (approval.review ? 'done_unread' : 'idle') : pushing ? 'running' : 'idle',
      detail: approval
        ? approval.review
          ? merged
            ? m.noP1
            : m.commits(approval.commits)
          : m.notReviewed
        : pushing
          ? m.commits(commits)
          : ''
    },
    {
      label: m.push,
      status: merged ? 'done_unread' : pushing ? 'running' : 'idle',
      detail: merged ? m.closed(record.number) : pushing ? m.running : ''
    }
  ]
  return (
    <div className={styles.approval} data-testid="issue-approval" data-state={record.state}>
      {steps.map((step) => (
        <div key={step.label} className={styles.approvalStep}>
          <StatusGlyph status={step.status} />
          <span className={styles.approvalLabel} data-done={step.status === 'done_unread'}>
            {step.label}
          </span>
          <span className={styles.spacer} />
          <span className={styles.approvalDetail}>{step.detail}</span>
        </div>
      ))}
      {merged && (
        <div className={styles.approvalFooter}>
          <button type="button" className={styles.archiveButton} data-move="archive" data-testid="issue-archive" onClick={onArchive}>
            {m.archive}
          </button>
        </div>
      )}
    </div>
  )
}
