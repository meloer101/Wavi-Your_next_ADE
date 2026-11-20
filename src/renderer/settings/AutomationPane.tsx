// 设置 · 自动化 · 代码审阅 (PRD F13), PR (PRD F16 v1.63; AI 写 v1.68) and 派活 (PRD F21); 额度提醒 moved to 设置 · 额度. Every automatic review is off until the user turns it on: a review spends their
// own Claude / Codex quota. Copy and layout follow Figma 16C (457:21367): section titles, then label · control rows, no explanatory lines.
import { useState } from 'react'
import { DEFAULT_REVIEW_RULES } from '@shared/background-review'
import type { DispatchSettings, PrSettings, ReviewSettings, ScheduleSettings } from '@shared/settings'
import { SHORTCUTS } from '@shared/shortcuts'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import { formatAccelerator } from '../ui/menu-model'
import { openSchedules } from '../schedules/store'
import { IssueSettings } from '../issue-watch/IssueSettings'
import { Segmented } from '../ui/Segmented'
import { Button, Row, Section, Toggle } from './controls'
import styles from './AutomationPane.module.css'

const M = defineMessages({
  zh: {
    title: '自动化',
    times: (n: string) => `${n} 次`,
    openSchedules: '打开定时任务…',
    codeReview: '代码审阅',
    beforePush: '推送前审阅',
    afterTurn: '每轮结束且有新提交时审阅',
    reviewMode: '审阅方式',
    builtin: 'Wavi 内置',
    agentCommand: '终端命令',
    reviewRules: '审阅规则',
    defaultRules: '默认',
    customRules: '自定义',
    reviewer: '由谁审',
    sameVendor: '同一家',
    otherVendor: '另一家',
    claudeReviewModel: 'Claude 审阅模型',
    codexReviewModel: 'Codex 审阅模型',
    evidence: 'PR 正文附上检查和审阅结果',
    autoFix: '新 PR 默认自动修复',
    mergeWhenGreen: '新 PR 默认检查通过后自动合并',
    maxAutoFixes: '自动修复最多',
    bots: '也处理这些机器人的评论',
    writer: '写提交和 PR 的工具',
    sameSession: '同一会话',
    claudeWriterModel: 'Claude 写作模型',
    codexWriterModel: 'Codex 写作模型',
    writeOnOpen: '打开 PR 面板时自动写',
    dispatch: '派活',
    dispatchTools: '允许 agent 开新会话',
    autoApprove: '开新会话时不再确认',
    leader: 'leader 会话',
    schedules: '定时任务',
    pauseAll: '全部暂停',
    whileClosed: 'Wavi 关着时也运行',
    openAtLogin: '登录时在后台打开 Wavi',
    agentSchedules: '让 agent 建定时任务',
    allSchedules: '所有定时任务',
    customRulesField: '自定义审阅规则',
    followCli: '跟随 CLI',
    none: '无'
  },
  en: {
    title: 'Automation',
    times: (n: string) => (n === '1' ? '1 time' : `${n} times`),
    openSchedules: 'Open scheduled tasks…',
    codeReview: 'Code review',
    beforePush: 'Review before push',
    afterTurn: 'Review after a turn with new commits',
    reviewMode: 'Review with',
    builtin: 'Wavi built-in',
    agentCommand: 'Terminal command',
    reviewRules: 'Review rules',
    defaultRules: 'Default',
    customRules: 'Custom',
    reviewer: 'Reviewer',
    sameVendor: 'Same vendor',
    otherVendor: 'Other vendor',
    claudeReviewModel: 'Claude review model',
    codexReviewModel: 'Codex review model',
    evidence: 'Add checks and review results to the PR body',
    autoFix: 'Auto-fix new PRs by default',
    mergeWhenGreen: 'Merge new PRs when checks pass by default',
    maxAutoFixes: 'Auto-fix at most',
    bots: 'Also handle comments from these bots',
    writer: 'Writes commits and PRs',
    sameSession: 'Same session',
    claudeWriterModel: 'Claude writing model',
    codexWriterModel: 'Codex writing model',
    writeOnOpen: 'Write when the PR panel opens',
    dispatch: 'Dispatch',
    dispatchTools: 'Let agents open new sessions',
    autoApprove: 'Open new sessions without asking',
    leader: 'Leader session',
    schedules: 'Scheduled tasks',
    pauseAll: 'Pause all',
    whileClosed: 'Run while Wavi is closed',
    openAtLogin: 'Open Wavi in the background at login',
    agentSchedules: 'Let agents create scheduled tasks',
    allSchedules: 'All scheduled tasks',
    customRulesField: 'Custom review rules',
    followCli: 'CLI default',
    none: 'None'
  }
})

const MODEL = /^[A-Za-z0-9._:@/-]{0,64}$/

export function AutomationPane({
  review,
  update,
  pr,
  updatePr,
  dispatch,
  updateDispatch,
  schedules,
  updateSchedules
}: {
  review: ReviewSettings
  update: (patch: Partial<ReviewSettings>) => void
  pr: PrSettings
  updatePr: (patch: Partial<PrSettings>) => void
  dispatch: DispatchSettings
  updateDispatch: (patch: Partial<DispatchSettings>) => void
  schedules: ScheduleSettings
  updateSchedules: (patch: Partial<ScheduleSettings>) => void
}) {
  const builtin = review.mode === 'builtin'
  const m = useMessages(M)
  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>{m.title}</h1>
        <Section title={m.codeReview}>
          <Row label={m.beforePush}>
            <Toggle label={m.beforePush} checked={review.beforePush} onChange={(beforePush) => update({ beforePush })} />
          </Row>
          <Row label={m.afterTurn}>
            <Toggle label={m.afterTurn} checked={review.afterTurnWithCommits} onChange={(afterTurnWithCommits) => update({ afterTurnWithCommits })} />
          </Row>
          <Row label={m.reviewMode}>
            <Segmented
              label={m.reviewMode}
              value={review.mode}
              options={[
                { value: 'builtin', label: m.builtin },
                { value: 'agent-command', label: m.agentCommand }
              ]}
              onChange={(mode) => update({ mode })}
            />
          </Row>
          {builtin && (
            <>
              <Row label={m.reviewRules}>
                <Segmented
                  label={m.reviewRules}
                  value={review.rules}
                  options={[
                    { value: 'default', label: m.defaultRules },
                    { value: 'custom', label: m.customRules }
                  ]}
                  onChange={(rules) => update({ rules })}
                />
              </Row>
              {review.rules === 'custom' && <RulesField value={review.customRules} onCommit={(customRules) => update({ customRules })} />}
              <Row label={m.reviewer}>
                <Segmented
                  label={m.reviewer}
                  value={review.reviewer}
                  options={[
                    { value: 'same', label: m.sameVendor },
                    { value: 'other', label: m.otherVendor }
                  ]}
                  onChange={(reviewer) => update({ reviewer })}
                />
              </Row>
              <Row label={m.claudeReviewModel}>
                <ModelField label={m.claudeReviewModel} value={review.model} onCommit={(model) => update({ model })} />
              </Row>
              <Row label={m.codexReviewModel}>
                <ModelField label={m.codexReviewModel} value={review.codexModel} onCommit={(codexModel) => update({ codexModel })} />
              </Row>
            </>
          )}
        </Section>
        <Section title="PR">
          <Row label={m.evidence}>
            <Toggle label={m.evidence} checked={pr.evidence} onChange={(evidence) => updatePr({ evidence })} />
          </Row>
          <Row label={m.autoFix}>
            <Toggle label={m.autoFix} checked={pr.autoFix} onChange={(autoFix) => updatePr({ autoFix })} />
          </Row>
          <Row label={m.mergeWhenGreen}>
            <Toggle label={m.mergeWhenGreen} checked={pr.mergeWhenGreen} onChange={(mergeWhenGreen) => updatePr({ mergeWhenGreen })} />
          </Row>
          <Row label={m.maxAutoFixes}>
            <Segmented
              label={m.maxAutoFixes}
              value={String(pr.maxAutoFixes)}
              options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: m.times(n) }))}
              onChange={(n) => updatePr({ maxAutoFixes: Number(n) })}
            />
          </Row>
          <Row label={m.bots}>
            <BotsField value={pr.bots} onCommit={(bots) => updatePr({ bots })} />
          </Row>
          <Row label={m.writer}>
            <Segmented
              label={m.writer}
              value={pr.writer}
              options={[
                { value: 'session', label: m.sameSession },
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' }
              ]}
              onChange={(writer) => updatePr({ writer })}
            />
          </Row>
          <Row label={m.claudeWriterModel}>
            <ModelField label={m.claudeWriterModel} value={pr.writerClaudeModel} onCommit={(writerClaudeModel) => updatePr({ writerClaudeModel })} />
          </Row>
          <Row label={m.codexWriterModel}>
            <ModelField label={m.codexWriterModel} value={pr.writerCodexModel} onCommit={(writerCodexModel) => updatePr({ writerCodexModel })} />
          </Row>
          <Row label={m.writeOnOpen}>
            <Toggle label={m.writeOnOpen} checked={pr.writeOnOpen} onChange={(writeOnOpen) => updatePr({ writeOnOpen })} />
          </Row>
        </Section>
        <Section title={m.dispatch}>
          <Row label={m.dispatchTools}>
            <Toggle label={m.dispatchTools} checked={dispatch.tools} onChange={(tools) => updateDispatch({ tools })} />
          </Row>
          <Row label={m.autoApprove}>
            <Toggle
              label={m.autoApprove}
              checked={dispatch.autoApprove}
              disabled={!dispatch.tools}
              onChange={(autoApprove) => updateDispatch({ autoApprove })}
            />
          </Row>
          {/* PRD F21 v1.198, Figma 81D: offers 作为 leader in 新建会话 and 新建 leader… in a project's ⋯ menu. */}
          <Row label={m.leader}>
            <Toggle label={m.leader} checked={dispatch.leader} onChange={(leader) => updateDispatch({ leader })} />
          </Row>
        </Section>
        <Section title={m.schedules}>
          <Row label={m.pauseAll}>
            <Toggle label={m.pauseAll} checked={schedules.paused} onChange={(paused) => updateSchedules({ paused })} />
          </Row>
          <Row label={m.whileClosed}>
            <Toggle label={m.whileClosed} checked={schedules.whileClosed} onChange={(whileClosed) => updateSchedules({ whileClosed })} />
          </Row>
          <Row label={m.openAtLogin}>
            <Toggle label={m.openAtLogin} checked={schedules.openAtLogin} onChange={(openAtLogin) => updateSchedules({ openAtLogin })} />
          </Row>
          <Row label={m.agentSchedules}>
            <Toggle label={m.agentSchedules} checked={schedules.agents} onChange={(agents) => updateSchedules({ agents })} />
          </Row>
          <Row label={m.allSchedules}>
            {/* Over the settings: closing it comes back here. */}
            <Button onClick={() => openSchedules()}>
              {m.openSchedules} <span data-shortcut-hint className={styles.shortcut}>{formatAccelerator(SHORTCUTS['open-schedules'])}</span>
            </Button>
          </Row>
        </Section>
        {/* 自动领取 GitHub issue (PRD F26): its own section after 定时任务. */}
        <IssueSettings />
      </div>
    </div>
  )
}

function RulesField({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const m = useMessages(M)
  return (
    <textarea
      className={styles.rules}
      aria-label={m.customRulesField}
      spellCheck={false}
      placeholder={DEFAULT_REVIEW_RULES}
      value={draft ?? value}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft)
        setDraft(null)
      }}
    />
  )
}

function ModelField({ label, value, onCommit }: { label: string; value: string; onCommit: (model: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const m = useMessages(M)
  const shown = draft ?? value
  const valid = MODEL.test(shown.trim())
  return (
    <input
      className={styles.model}
      aria-label={label}
      aria-invalid={!valid || undefined}
      autoComplete="off"
      spellCheck={false}
      placeholder={m.followCli}
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = shown.trim()
        if (valid && next !== value) onCommit(next)
        setDraft(null)
      }}
      onKeyDown={(event) => {
        // Enter / Esc while an input method composes confirm / cancel the composition.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** Bot logins, separated by commas or spaces; committed on blur or Enter. */
function BotsField({ value, onCommit }: { value: string[]; onCommit: (bots: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const m = useMessages(M)
  const shown = draft ?? value.join(', ')
  return (
    <input
      className={styles.model}
      aria-label={m.bots}
      autoComplete="off"
      spellCheck={false}
      placeholder={m.none}
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        // eslint-disable-next-line no-restricted-syntax -- splits typed logins on a full-width comma too, not UI text
        onCommit(shown.split(/[\s,，]+/).filter(Boolean))
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
