// 设置 · 自动化 · GitHub issue (PRD F26, Figma 102A / 102A′ light), after 定时任务: one switch per project, and the
// project's 领取范围 · label · 智能体 · 界面 · 模型 · 权限 · 验收命令 when it is on; the global 检查间隔 and caps above.
// Main owns the settings (`issue-watch.json`): every control sends the project's whole draft and shows what main stored.
import { useEffect, useState } from 'react'
import { AGENT_SPECS, CLI_AGENTS, type CliAgent } from '@shared/agents'
import { cliPermissionLevels } from '@shared/agent-launch'
import { GUI_PERMISSION_LABELS, type GuiPermission } from '@shared/gui-chat'
import { defineMessages } from '@shared/i18n'
import {
  DEFAULT_LABEL,
  MAX_ACCEPT_COMMAND,
  MAX_CONCURRENT,
  MAX_DAILY,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL,
  MAX_MODEL,
  MIN_CONCURRENT,
  MIN_DAILY,
  MIN_INTERVAL_MINUTES,
  agentCanReportTurn,
  claimsToday,
  dailyCapReached,
  type IssueWatchProjectDraft,
  type IssueWatchProjectSettings,
  type IssueWatchSettings
} from '@shared/issue-watch'
import type { SessionUi } from '@shared/types'
import { useMessages } from '../ui/i18n'
import { Segmented } from '../ui/Segmented'
import { Row, Section, Select, Toggle } from '../settings/controls'
import { useWorkspace } from '../state/workspace'
import { useNow } from '../schedules/store'
import { followIssueWatch, useIssueWatch } from './store'
import styles from '../settings/AutomationPane.module.css'

const M = defineMessages({
  zh: {
    title: 'GitHub issue',
    interval: '检查间隔',
    minutes: '分钟',
    concurrent: '每个项目同时处理',
    daily: '每个项目每天最多领取',
    capReached: (n: number) => `今天已领 ${n} 个，明天继续`,
    projects: '项目',
    noProjects: '还没有项目',
    notGitHub: '不在 GitHub 上',
    scope: '领取范围',
    members: '自己人直接领，外人等 label',
    all: '全部直接领',
    label: 'label',
    agent: '智能体',
    uiInterface: '界面',
    cli: '终端',
    gui: 'GUI',
    model: '模型',
    permission: '权限',
    permissionDefault: '默认',
    accept: '验收命令',
    acceptNone: '没有',
    noTurnEnd: (agents: string) => `看不出一轮结束的 CLI 不在列表里：${agents}`,
    labelField: 'label 名',
    modelField: '模型',
    acceptField: '验收命令',
    intervalField: '检查间隔（分钟）',
    concurrentField: '每个项目同时处理',
    dailyField: '每个项目每天最多领取',
    saveFailed: '没能保存'
  },
  en: {
    title: 'GitHub issues',
    interval: 'Check every',
    minutes: 'min',
    concurrent: 'Handled at once per project',
    daily: 'Claimed per project per day',
    capReached: (n: number) => `${n} claimed today; continues tomorrow`,
    projects: 'Projects',
    noProjects: 'No projects yet',
    notGitHub: "This project isn't on GitHub",
    scope: 'Claim',
    members: 'Team members’ issues; others wait for the label',
    all: 'Every issue',
    label: 'Label',
    agent: 'Agent',
    uiInterface: 'Interface',
    cli: 'Terminal',
    gui: 'GUI',
    model: 'Model',
    permission: 'Permission',
    permissionDefault: 'Default',
    accept: 'Acceptance command',
    acceptNone: 'None',
    noTurnEnd: (agents: string) => `CLIs that can't report a turn's end aren't listed: ${agents}`,
    labelField: 'Label name',
    modelField: 'Model',
    acceptField: 'Acceptance command',
    intervalField: 'Check every (minutes)',
    concurrentField: 'Handled at once per project',
    dailyField: 'Claimed per project per day',
    saveFailed: "Couldn't save"
  }
})

const defaultDraft = (projectId: string): IssueWatchProjectSettings => ({
  projectId,
  enabled: false,
  enabledAt: null,
  mode: 'members',
  label: DEFAULT_LABEL,
  agent: 'claude',
  ui: 'cli'
})

const draftOf = (project: IssueWatchProjectSettings): IssueWatchProjectDraft => {
  const { projectId: _projectId, enabledAt: _enabledAt, ...draft } = project
  return draft
}

/** A whole-number field that commits on blur or Enter; out-of-range values are not sent. */
function NumberField({ value, min, max, label, suffix, onCommit }: { value: number; min: number; max: number; label: string; suffix?: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)
  const commit = (): void => {
    const parsed = Number(shown)
    if (draft !== null && Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value) onCommit(parsed)
    setDraft(null)
  }
  return (
    <span className={styles.inline}>
      <input
        className={styles.number}
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={shown}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      {suffix && <span className={styles.count}>{suffix}</span>}
    </span>
  )
}

/** A text field that shows main's value and commits on blur or Enter (a label, a model name, a command). */
function TextField({
  value,
  label,
  placeholder,
  max,
  onCommit
}: {
  value: string
  label: string
  placeholder?: string
  max: number
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value
  return (
    <input
      className={styles.model}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      maxLength={max}
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = shown.trim()
        if (draft !== null && next !== value) onCommit(next)
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

export function IssueSettings() {
  const m = useMessages(M)
  const watch = useIssueWatch((s) => s.state)
  const workspaceProjects = useWorkspace((s) => s.projects)
  const rows = watch?.projects
  const projects = workspaceProjects.map((project) => ({ project, settings: rows?.find((p) => p.projectId === project.id) ?? defaultDraft(project.id) }))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => followIssueWatch(), [])

  const saveSettings = (patch: Partial<IssueWatchSettings>): void => {
    const current = watch?.settings
    if (!current) return
    void window.tr.issueWatch.saveSettings({ ...current, ...patch }).catch(() => setError(m.saveFailed))
  }
  const saveProject = (project: IssueWatchProjectSettings, patch: Partial<IssueWatchProjectDraft>): void => {
    void window.tr.issueWatch.saveProject(project.projectId, { ...draftOf(project), ...patch }).catch(() => setError(m.saveFailed))
  }

  const now = useNow()
  return (
    <Section title={m.title}>
      <Row label={m.interval}>
        <NumberField
          value={watch?.settings.intervalMinutes ?? 5}
          min={MIN_INTERVAL_MINUTES}
          max={MAX_INTERVAL_MINUTES}
          label={m.intervalField}
          suffix={m.minutes}
          onCommit={(intervalMinutes) => saveSettings({ intervalMinutes })}
        />
      </Row>
      <Row label={m.concurrent}>
        <NumberField
          value={watch?.settings.concurrent ?? 2}
          min={MIN_CONCURRENT}
          max={MAX_CONCURRENT}
          label={m.concurrentField}
          onCommit={(concurrent) => saveSettings({ concurrent })}
        />
      </Row>
      <Row label={m.daily}>
        <NumberField
          value={watch?.settings.daily ?? 10}
          min={MIN_DAILY}
          max={MAX_DAILY}
          label={m.dailyField}
          onCommit={(daily) => saveSettings({ daily })}
        />
      </Row>
      {error && <p className={styles.error}>{error}</p>}
      {projects.length === 0 && <p className={styles.note}>{m.noProjects}</p>}
      {projects.map(({ project, settings }) => {
        const scan = watch?.scans[project.id]
        const reason =
          scan?.state === 'not-github' ? m.notGitHub : scan?.state === 'error' ? scan.message : null
        const capped = watch && dailyCapReached(watch.issues, watch.settings, project.id, now) ? claimsToday(watch.issues, project.id, now) : null
        return (
          <div key={project.id} className={styles.project} data-testid="issue-watch-project">
            <Row label={project.name}>
              <Toggle label={project.name} checked={settings.enabled} onChange={(enabled) => saveProject(settings, { enabled })} />
            </Row>
            {reason && <p className={styles.note} data-tone={scan?.state === 'error' ? 'error' : undefined}>{reason}</p>}
            {capped !== null && <p className={styles.note}>{m.capReached(capped)}</p>}
            {settings.enabled && <ProjectFields settings={settings} onSave={(patch) => saveProject(settings, patch)} />}
          </div>
        )
      })}
    </Section>
  )
}

/** The project's settings when its switch is on (Figma 102A): 领取范围, label, agent, interface, model, permission, the command. */
function ProjectFields({ settings, onSave }: { settings: IssueWatchProjectSettings; onSave: (patch: Partial<IssueWatchProjectDraft>) => void }) {
  const m = useMessages(M)
  const ui = settings.ui
  const agents = CLI_AGENTS.filter((agent) => agentCanReportTurn(agent, ui))
  const excluded = CLI_AGENTS.filter((agent) => !agentCanReportTurn(agent, ui)).map((agent) => AGENT_SPECS[agent].label)
  const levels: readonly GuiPermission[] = cliPermissionLevels(settings.agent)
  const permissionOptions = [{ value: '', label: m.permissionDefault }, ...levels.map((level) => ({ value: level, label: GUI_PERMISSION_LABELS[level] }))]
  return (
    <>
      <Row label={m.scope}>
        <Segmented
          label={m.scope}
          value={settings.mode}
          options={[
            { value: 'members', label: m.members },
            { value: 'all', label: m.all }
          ]}
          onChange={(mode) => onSave({ mode: mode === 'all' ? 'all' : 'members' })}
        />
      </Row>
      <Row label={m.label}>
        <TextField value={settings.label} label={m.labelField} max={MAX_LABEL} onCommit={(label) => label && onSave({ label })} />
      </Row>
      <Row label={m.agent}>
        <Select
          value={settings.agent}
          label={m.agent}
          options={agents.map((agent) => ({ value: agent, label: AGENT_SPECS[agent].label }))}
          onChange={(agent) => onSave({ agent: agent as CliAgent })}
        />
      </Row>
      {ui === 'cli' && excluded.length > 0 && <p className={styles.note}>{m.noTurnEnd(excluded.join(' · '))}</p>}
      <Row label={m.uiInterface}>
        <Segmented
          label={m.uiInterface}
          value={ui}
          options={[
            { value: 'cli', label: m.cli },
            { value: 'gui', label: m.gui }
          ]}
          onChange={(next) => onSave({ ui: next as SessionUi })}
        />
      </Row>
      <Row label={m.model}>
        <TextField value={settings.model ?? ''} label={m.modelField} max={MAX_MODEL} onCommit={(model) => onSave({ model })} />
      </Row>
      <Row label={m.permission}>
        <Segmented label={m.permission} value={settings.permission ?? ''} options={permissionOptions} onChange={(permission) => onSave({ permission: (permission || undefined) as GuiPermission | undefined })} />
      </Row>
      <Row label={m.accept}>
        <TextField
          value={settings.accept ?? ''}
          label={m.acceptField}
          placeholder={m.acceptNone}
          max={MAX_ACCEPT_COMMAND}
          onCommit={(accept) => onSave({ accept })}
        />
      </Row>
    </>
  )
}
