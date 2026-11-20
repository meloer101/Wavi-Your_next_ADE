// 设置 · 自动化 · GitHub issue (PRD F26, Figma 102A / 102A′ light), after 定时任务: one row per project — its name, its
// repository in mono, the switch — with the project's options indented under it when the switch is on (领取范围 · label ·
// 智能体 · 界面 · 模型 · 权限 · 验收命令), then the three global bounds as selects. The controls are 新建会话's and 定时任务's
// own (SelectButton + SheetMenu, Segmented, Toggle); the CLIs that cannot report a turn are in the 智能体 menu, disabled,
// with 看不出一轮结束 at their right. Main owns the settings (`issue-watch.json`): every control sends the project's whole
// draft and shows what main stored.
import { useEffect, useState, type ReactNode } from 'react'
import { CLI_AGENTS, agentName, type CliAgent } from '@shared/agents'
import { cliPermissionHasDefault, cliPermissionLevels } from '@shared/agent-launch'
import { GUI_PERMISSION_LABELS, type GuiPermission } from '@shared/gui-chat'
import { guiPermissionLevels } from '@shared/gui-agents'
import { defineMessages } from '@shared/i18n'
import type { AgentAvailability } from '@shared/ipc'
import {
  DEFAULT_LABEL,
  MAX_ACCEPT_COMMAND,
  MAX_LABEL,
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
import { Check } from '../ui/icons'
import { useMessages } from '../ui/i18n'
import { Segmented } from '../ui/Segmented'
import { Row, Section, Toggle } from '../settings/controls'
import { SelectButton } from '../new-session/NewSessionSheet'
import { SheetMenu, type SheetMenuSection } from '../new-session/SheetMenu'
import { useWorkspace } from '../state/workspace'
import { useNow } from '../schedules/store'
import { followIssueWatch, useIssueWatch } from './store'
import styles from '../settings/AutomationPane.module.css'

const M = defineMessages({
  zh: {
    title: 'GitHub issue',
    repo: (repo: string) => repo,
    interval: '检查间隔',
    everyMinutes: (n: number) => `每 ${n} 分钟`,
    concurrent: '每个项目同时处理',
    perCount: (n: number) => `${n} 个`,
    daily: '每个项目每天最多领取',
    capReached: (n: number) => `今天已领 ${n} 个，明天继续`,
    noProjects: '还没有项目',
    notGitHub: '不在 GitHub 上',
    offGitHub: '这个项目不在 GitHub 上',
    scope: '领取范围',
    members: '自己人直接领，外人等 label',
    all: '全部直接领',
    label: 'label',
    agent: '智能体',
    interface: '界面',
    cli: '终端',
    gui: 'GUI',
    model: '模型',
    permission: '权限',
    defaultChoice: '默认',
    accept: '验收命令',
    acceptNone: '没有',
    cannotTell: '看不出一轮结束',
    labelField: 'label 名',
    acceptField: '验收命令',
    searchAgents: '搜索智能体',
    searchModels: '搜索模型',
    noAgents: '没有匹配的智能体',
    noModels: '没有模型',
    minutes: (n: number) => `${n} 分钟`,
    saveFailed: '没能保存'
  },
  en: {
    title: 'GitHub issues',
    repo: (repo: string) => repo,
    interval: 'Check every',
    everyMinutes: (n: number) => (n === 1 ? 'every minute' : `every ${n} min`),
    concurrent: 'Handled at once per project',
    perCount: (n: number) => String(n),
    daily: 'Claimed per project per day',
    capReached: (n: number) => `${n} claimed today; continues tomorrow`,
    noProjects: 'No projects yet',
    notGitHub: 'Not on GitHub',
    offGitHub: "This project isn't on GitHub",
    scope: 'Claim',
    members: 'Team members’ issues; others wait for the label',
    all: 'Every issue',
    label: 'Label',
    agent: 'Agent',
    interface: 'Interface',
    cli: 'Terminal',
    gui: 'GUI',
    model: 'Model',
    permission: 'Permission',
    defaultChoice: 'Default',
    accept: 'Acceptance command',
    acceptNone: 'None',
    cannotTell: "Can't tell when a turn ends",
    labelField: 'Label name',
    acceptField: 'Acceptance command',
    searchAgents: 'Search agents',
    searchModels: 'Search models',
    noAgents: 'No matching agent',
    noModels: 'No models',
    minutes: (n: number) => `${n} min`,
    saveFailed: "Couldn't save"
  }
})

const INTERVALS = [2, 5, 10, 15, 30, 60]
const CONCURRENTS = [1, 2, 3, 4, 5]
const DAILLIES = [5, 10, 20, 50]
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

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

/** The 权限 levels 定时任务's sheet offers: the GUI's, or what the agent's CLI can be launched with (默认 when none is its plain launch). */
const permissionsFor = (agent: CliAgent, ui: SessionUi): readonly (GuiPermission | 'default')[] =>
  ui === 'gui' ? guiPermissionLevels(agent) : [...(cliPermissionHasDefault(agent) ? (['default'] as const) : []), ...cliPermissionLevels(agent)]

/** A text field that shows main's value and commits on blur or Enter (a label, a command). */
function TextField({ value, label, placeholder, max, onCommit }: { value: string; label: string; placeholder?: string; max: number; onCommit: (text: string) => void }) {
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

type MenuKind = 'agent' | 'model' | 'interval' | 'concurrent' | 'daily'
interface OpenMenu {
  kind: MenuKind
  anchor: HTMLElement
  /** The project whose agent or model is being picked. */
  projectId?: string
}

export function IssueSettings() {
  const m = useMessages(M)
  const watch = useIssueWatch((s) => s.state)
  const workspaceProjects = useWorkspace((s) => s.projects)
  const rows = watch?.projects
  const projects = workspaceProjects.map((project) => ({ project, settings: rows?.find((p) => p.projectId === project.id) ?? defaultDraft(project.id) }))
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [, setModelsTick] = useState(0)
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => followIssueWatch(), [])
  useEffect(() => {
    let cancelled = false
    void window.tr.app.detectAgents().then((next) => !cancelled && setFound(next)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const closeMenu = (refocus: boolean): void => {
    const anchor = menu?.anchor
    setMenu(null)
    if (refocus) anchor?.focus()
  }
  const toggleMenu = (kind: MenuKind, anchor: HTMLElement, projectId?: string): void => {
    setMenu(menu?.kind === kind && menu.projectId === projectId ? null : { kind, anchor, ...(projectId ? { projectId } : {}) })
    // The 模型 menu lists what the agent last offered, as 定时任务's sheet does; a missing list is asked for once.
    if (kind === 'model' && projectId) {
      const agent = rows?.find((p) => p.projectId === projectId)?.agent ?? 'claude'
      if (!useWorkspace.getState().guiPicks[agent]?.models?.length) {
        void window.tr.gui
          .models(agent)
          .then((result) => {
            if (!result.ok || useWorkspace.getState().guiPicks[agent]?.modelsFrom === 'live') return
            useWorkspace.getState().rememberGuiPicks(agent, { models: result.catalog.models, modelsFrom: 'probe' })
          })
          .catch(() => {})
          .finally(() => setModelsTick((n) => n + 1))
      }
    }
  }

  const saveSettings = (patch: Partial<IssueWatchSettings>): void => {
    if (!watch) return
    void window.tr.issueWatch.saveSettings({ ...watch.settings, ...patch }).catch(() => setError(m.saveFailed))
  }
  const saveProject = (project: IssueWatchProjectSettings, patch: Partial<IssueWatchProjectDraft>): void => {
    void window.tr.issueWatch.saveProject(project.projectId, { ...draftOf(project), ...patch }).catch(() => setError(m.saveFailed))
  }

  const check = (on: boolean): ReactNode => (on ? <Check {...ICON} /> : null)
  const agentSections = (ui: SessionUi, selected: CliAgent): SheetMenuSection[] => {
    const items = CLI_AGENTS.filter((agent) => !found || found[agent] === true).map((agent) => {
      const eligible = agentCanReportTurn(agent, ui)
      return {
        value: agent,
        label: agentName(agent),
        icon: check(agent === selected),
        ...(eligible ? {} : { disabled: true, meta: m.cannotTell })
      }
    })
    return [{ items }]
  }
  const modelSections = (agent: CliAgent, selected: string | undefined): SheetMenuSection[] => {
    const models = useWorkspace.getState().guiPicks[agent]?.models ?? []
    return [
      {
        items: [
          { value: '', label: m.defaultChoice, icon: check(!selected) },
          ...models.map((model) => ({ value: model.value, label: model.label, icon: check(model.value === selected) }))
        ]
      }
    ]
  }
  const countSections = (values: number[], selected: number, format: (n: number) => string): SheetMenuSection[] => [
    { items: values.map((n) => ({ value: String(n), label: format(n), icon: check(n === selected) })) }
  ]

  const settings = watch?.settings
  return (
    <Section title={m.title}>
      {projects.length === 0 && <p className={styles.note}>{m.noProjects}</p>}
      {projects.map(({ project, settings: projectSettings }) => {
        const scan = watch?.scans[project.id]
        const offGitHub = scan?.state === 'not-github'
        const reason = scan?.state === 'error' ? scan.message : null
        const capped = watch && dailyCapReached(watch.issues, watch.settings, project.id, now) ? claimsToday(watch.issues, project.id, now) : null
        return (
          <div key={project.id} className={styles.project} data-testid="issue-watch-project">
            {/* 102A: the project's name and its repository on the left, the switch alone on the right. */}
            <div className={styles.projectRow} role="group" aria-label={project.name}>
              <span className={styles.projectName}>{project.name}</span>
              {scan?.state === 'ok' && <span className={styles.repo}>{m.repo(`${scan.repo.owner}/${scan.repo.name}`)}</span>}
              <span className={styles.spacer} />
              {offGitHub ? (
                <span className={styles.count}>{m.notGitHub}</span>
              ) : (
                <Toggle label={project.name} checked={projectSettings.enabled} onChange={(enabled) => saveProject(projectSettings, { enabled })} />
              )}
            </div>
            {reason && <p className={styles.note} data-tone="error">{reason}</p>}
            {capped !== null && <p className={styles.note}>{m.capReached(capped)}</p>}
            {projectSettings.enabled && !offGitHub && (
              <div className={styles.indent}>
                <Row label={m.scope}>
                  <Segmented
                    label={m.scope}
                    value={projectSettings.mode}
                    options={[
                      { value: 'members', label: m.members },
                      { value: 'all', label: m.all }
                    ]}
                    onChange={(mode) => saveProject(projectSettings, { mode: mode === 'all' ? 'all' : 'members' })}
                  />
                </Row>
                <Row label={m.label}>
                  <TextField value={projectSettings.label} label={m.labelField} max={MAX_LABEL} onCommit={(label) => label && saveProject(projectSettings, { label })} />
                </Row>
                <Row label={m.agent}>
                  <SelectButton
                    label={m.agent}
                    value={agentName(projectSettings.agent)}
                    expanded={menu?.kind === 'agent' && menu.projectId === project.id}
                    onClick={(anchor) => toggleMenu('agent', anchor, project.id)}
                  />
                </Row>
                <Row label={m.interface}>
                  <Segmented
                    label={m.interface}
                    value={projectSettings.ui}
                    options={[
                      { value: 'gui', label: m.gui },
                      { value: 'cli', label: m.cli }
                    ]}
                    onChange={(ui) => saveProject(projectSettings, { ui: ui as SessionUi })}
                  />
                </Row>
                <Row label={m.model}>
                  <SelectButton
                    label={m.model}
                    value={projectSettings.model || m.defaultChoice}
                    expanded={menu?.kind === 'model' && menu.projectId === project.id}
                    onClick={(anchor) => toggleMenu('model', anchor, project.id)}
                  />
                </Row>
                <Row label={m.permission}>
                  <Segmented
                    label={m.permission}
                    value={projectSettings.permission ?? 'default'}
                    options={permissionsFor(projectSettings.agent, projectSettings.ui).map((level) => ({
                      value: level,
                      label: level === 'default' ? m.defaultChoice : GUI_PERMISSION_LABELS[level as GuiPermission]
                    }))}
                    onChange={(permission) =>
                      saveProject(projectSettings, { permission: permission === 'default' ? undefined : (permission as GuiPermission) })
                    }
                  />
                </Row>
                <Row label={m.accept}>
                  <TextField
                    value={projectSettings.accept ?? ''}
                    label={m.acceptField}
                    placeholder={m.acceptNone}
                    max={MAX_ACCEPT_COMMAND}
                    onCommit={(accept) => saveProject(projectSettings, { accept })}
                  />
                </Row>
              </div>
            )}
          </div>
        )
      })}

      {/* The three bounds: one line each, the select compact and right-aligned (102A). */}
      <Row label={m.interval}>
        <span className={styles.compact}>
          <SelectButton
            label={m.interval}
            value={m.everyMinutes(settings?.intervalMinutes ?? 5)}
            expanded={menu?.kind === 'interval'}
            onClick={(anchor) => toggleMenu('interval', anchor)}
          />
        </span>
      </Row>
      <Row label={m.concurrent}>
        <span className={styles.compact}>
          <SelectButton
            label={m.concurrent}
            value={m.perCount(settings?.concurrent ?? 2)}
            expanded={menu?.kind === 'concurrent'}
            onClick={(anchor) => toggleMenu('concurrent', anchor)}
          />
        </span>
      </Row>
      <Row label={m.daily}>
        <span className={styles.compact}>
          <SelectButton
            label={m.daily}
            value={m.perCount(settings?.daily ?? 10)}
            expanded={menu?.kind === 'daily'}
            onClick={(anchor) => toggleMenu('daily', anchor)}
          />
        </span>
      </Row>
      {error && <p className={styles.error}>{error}</p>}

      {menu?.kind === 'agent' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.agent}
          sections={() => {
            const project = projects.find((p) => p.project.id === menu.projectId)
            return project ? agentSections(project.settings.ui, project.settings.agent) : []
          }}
          selected={projects.find((p) => p.project.id === menu.projectId)?.settings.agent ?? null}
          search={m.searchAgents}
          empty={m.noAgents}
          align="selected"
          onPick={(value) => {
            const project = projects.find((p) => p.project.id === menu.projectId)?.settings
            if (project && (CLI_AGENTS as readonly string[]).includes(value)) saveProject(project, { agent: value as CliAgent, model: undefined })
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'model' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.model}
          sections={() => {
            const project = projects.find((p) => p.project.id === menu.projectId)?.settings
            return project ? modelSections(project.agent, project.model) : []
          }}
          selected={projects.find((p) => p.project.id === menu.projectId)?.settings.model ?? ''}
          empty={m.noModels}
          onPick={(value) => {
            const project = projects.find((p) => p.project.id === menu.projectId)?.settings
            if (project) saveProject(project, { model: value || undefined })
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'interval' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.interval}
          sections={() => countSections(INTERVALS.filter((n) => n >= MIN_INTERVAL_MINUTES), settings?.intervalMinutes ?? 5, m.everyMinutes)}
          selected={String(settings?.intervalMinutes ?? 5)}
          onPick={(value) => {
            saveSettings({ intervalMinutes: Number(value) })
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'concurrent' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.concurrent}
          sections={() => countSections(CONCURRENTS, settings?.concurrent ?? 2, m.perCount)}
          selected={String(settings?.concurrent ?? 2)}
          onPick={(value) => {
            saveSettings({ concurrent: Number(value) })
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'daily' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.daily}
          sections={() => countSections(DAILLIES.filter((n) => n >= MIN_DAILY), settings?.daily ?? 10, m.perCount)}
          selected={String(settings?.daily ?? 10)}
          onPick={(value) => {
            saveSettings({ daily: Number(value) })
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
    </Section>
  )
}
