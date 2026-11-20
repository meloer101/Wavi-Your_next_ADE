// 批准's three steps in the exit zone (PRD F26, Figma 102B3 批准后 / 102B4 完成): 合并到 main → 推送前审阅 → 推送 main, each
// with a status glyph and its detail on the right (the squash commit and the branch's commits, whether the pre-push
// review ran). Once the push is in, the issue is closed on GitHub and the line says so; the chain then offers 归档.
import { CircleCheck } from '../ui/icons'
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
    reviewed: '通过',
    notReviewed: '没有审阅',
    closed: (n: number) => `issue #${n} 已关闭`,
    running: '进行中'
  },
  en: {
    merge: 'Merged into main',
    review: 'Review before push',
    push: 'Push main',
    commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
    reviewed: 'Passed',
    notReviewed: 'Not reviewed',
    closed: (n: number) => `issue #${n} closed`,
    running: 'Running'
  }
})

type Step = { label: string; status: SessionStatus; detail: string }

const short = (sha: string): string => sha.slice(0, 7)

export function IssueApproval({ record, run }: { record: IssueRecord; run: ShipState | null }) {
  const m = useMessages(M)
  const approval = record.approval
  const merged = record.state === 'merged'
  // The live run says what is under way before the record catches up (合并, then 推送 of the base).
  const merging = !approval && run?.kind === 'main' && run.error === null
  const pushing = approval !== undefined && !merged && run?.kind === 'push-base' && run.error === null
  const steps: Step[] = [
    {
      label: m.merge,
      status: approval ? 'done_unread' : merging ? 'running' : 'idle',
      detail: approval ? `${short(approval.merge)} · ${m.commits(approval.commits)}` : merging ? m.running : ''
    },
    {
      label: m.review,
      status: approval ? (approval.review ? 'done_unread' : 'idle') : pushing ? 'running' : 'idle',
      detail: approval ? (approval.review ? m.reviewed : m.notReviewed) : pushing ? m.running : ''
    },
    {
      label: m.push,
      status: merged ? 'done_unread' : pushing ? 'running' : 'idle',
      detail: merged && approval ? short(approval.merge) : pushing ? m.running : ''
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
        <p className={styles.closed} data-testid="issue-closed">
          <CircleCheck size={14} strokeWidth={1.75} aria-hidden />
          {m.closed(record.number)}
        </p>
      )}
    </div>
  )
}
