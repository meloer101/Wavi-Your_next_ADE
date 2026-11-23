// 新建会话 (PRD F4, Figma 15 Section 170:7853): one row per choice, each with a default, so ⌘↵ alone starts a session.
// 项目 · 工作目录 (新 worktree / 当前目录, remembered per project) · 基于 · 智能体 · 高级 (分支名 · 文件夹 · 准备).
// No task description: the user types the first message in the terminal — except when 看板 · GitHub hands an issue or
// PR over (Figma 77E): then the project is fixed, a 任务 row holds the first message (editable), the branch is named
// after the item and 创建并发送 sends it. Text appears only when something is limited or wrong (15E, 15F). Glass
// material from PRD §5; solid under "reduce transparency".
// 智能体 (Figma 24A, PRD F4 v1.68): a pop-up menu — 已安装 (Claude Code and Codex always, the other CLIs when found, each
// with its version) and 其他 (终端); remembered per project; the hint says how many are not installed. Several agents
// on one task start from a session instead (同任务多解, attempts/SameTaskSheet).
// 作为 leader (PRD F21 v1.198, Figma 81C / 81C′): a toggle under 项目 while 设置 · 派活 · leader 会话 is on and the project
// has no leader. On, the session opens in the main checkout (当前目录, 基于 dimmed), CLI only, with no 高级; the agent
// menu lists the agents that can lead, one that cannot here dimmed with `<version> · <reason>` on its right.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, AlertCircle, GitBranch, GitFork, Globe } from '../ui/icons'
import {
  defaultBase,
  generateBranchName,
  groupBranches,
  initialUi,
  initialWorkdir,
  type NewSessionInfo,
  type Workdir
} from '@shared/new-session'
import { AGENT_SPECS, agentName, CLI_AGENTS } from '@shared/agents'
import { canLead, leaderBlock, type LeaderCheck } from '@shared/dispatch'
import { startBranch } from '@shared/github-board'
import type { AgentAvailability, AgentVersions } from '@shared/ipc'
import type { AgentKind, ProjectId, SessionUi } from '@shared/types'
import { defineMessages, pick } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import { Toggle } from '../settings/controls'
import { Segmented } from '../ui/Segmented'
import { useWorkspace } from '../state/workspace'
import { leaderOf } from '../state/workspace-model'
import { runCreatePlan } from './creation'
import { handTask } from './hand-task'
import { binaryInstalled, branchProblemText, folderFor, isElsewhere, listedAgents, planCreate, prepareText, selectedBase, tilde, uiRow, type UiRow } from './model'
import { closeNewSessionSheet, useNewSessionSheet, type SheetTask } from './sheet-store'
import { SheetMenu, type SheetMenuSection } from './SheetMenu'
import styles from './NewSessionSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

const isKindChoice = (value: string): value is AgentKind => value === 'shell' || (CLI_AGENTS as readonly string[]).includes(value)

/** The agents a leader can be (`canLead`), in the menu's order. */
const LEADER_KINDS: readonly AgentKind[] = CLI_AGENTS.filter((id) => canLead(id))

/** A leader is a terminal session: 界面 stays on CLI with GUI dimmed (Figma 81C′). */
const LEADER_UI: UiRow = { value: 'cli', guiDisabled: true, forced: true }

const UIS: ReadonlyArray<{ value: SessionUi; label: string }> = [
  { value: 'gui', label: 'GUI' },
  { value: 'cli', label: 'CLI' }
]

const M = defineMessages({
  zh: {
    newWorktree: '新 worktree',
    currentDir: '当前目录',
    missing: '没装',
    terminal: '终端',
    installed: '已安装',
    others: '其他',
    localBranches: '本地分支',
    inWorktree: '已在 worktree 里',
    projectDefault: '项目默认',
    remoteBranches: '远程分支',
    title: '新建会话',
    project: '项目',
    workdir: '工作目录',
    base: '基于',
    elsewhere: (path: string) => `已在 worktree 里：会在 ${path} 里再开一个会话`,
    currentBranch: (branch: string) => `${branch}（当前分支）`,
    noBranch: '没有分支',
    agent: '智能体',
    ui: '界面',
    adapter: 'GUI 适配器',
    adapterNeeded: (binary: string) => `GUI 要先装 ${binary}`,
    copied: '已复制',
    copyInstall: '复制安装命令',
    task: '任务',
    advanced: '高级',
    branchName: '分支名',
    folder: '文件夹',
    prepare: '准备',
    nothingToPrepare: '没有 .worktreeinclude 要复制的文件，也没有 setup 脚本',
    prepareToggle: '准备：复制被忽略的文件、运行 setup 脚本',
    cancel: '取消',
    createAndSend: '创建并发送',
    create: '创建',
    noProjects: '没有项目',
    searchAgents: '搜索智能体',
    noAgents: '没有匹配的智能体',
    agentHintMissing: (n: number) => `还有 ${n} 家没装：在设置 · 智能体里看怎么装 · 按项目记住上次的选择`,
    agentHint: '按项目记住上次的选择',
    asLeader: '作为 leader',
    searchBranches: '搜索分支',
    elsewhereHint: '已在 worktree 里的分支：会改为在那个 worktree 里再开一个会话',
    unreadable: '读不出这个文件夹的 git 状态，只能在当前目录里开',
    notRepo: '这个文件夹不是 git 仓库，只能在当前目录里开'
  },
  en: {
    newWorktree: 'New worktree',
    currentDir: 'Current folder',
    missing: 'Not installed',
    terminal: 'Terminal',
    installed: 'Installed',
    others: 'Other',
    localBranches: 'Local branches',
    inWorktree: 'In a worktree',
    projectDefault: 'Project default',
    remoteBranches: 'Remote branches',
    title: 'New session',
    project: 'Project',
    workdir: 'Folder',
    base: 'Based on',
    elsewhere: (path: string) => `Already in a worktree: another session opens in ${path}`,
    currentBranch: (branch: string) => `${branch} (current branch)`,
    noBranch: 'No branches',
    agent: 'Agent',
    ui: 'Interface',
    adapter: 'GUI adapter',
    adapterNeeded: (binary: string) => `GUI needs ${binary} first`,
    copied: 'Copied',
    copyInstall: 'Copy install command',
    task: 'Task',
    advanced: 'Advanced',
    branchName: 'Branch name',
    folder: 'Folder',
    prepare: 'Prepare',
    nothingToPrepare: 'No .worktreeinclude files to copy and no setup script',
    prepareToggle: 'Prepare: copy ignored files, run the setup script',
    cancel: 'Cancel',
    createAndSend: 'Create and send',
    create: 'Create',
    noProjects: 'No projects',
    searchAgents: 'Search agents',
    noAgents: 'No matching agents',
    agentHintMissing: (n: number) => `${n} more not installed: see Settings · Agents for how to install · remembered per project`,
    agentHint: 'Remembered per project',
    asLeader: 'As leader',
    searchBranches: 'Search branches',
    elsewhereHint: 'Branches already in a worktree: another session opens in that worktree instead',
    unreadable: "Couldn't read this folder's git state; it can only open in the current folder",
    notRepo: 'This folder is not a git repository; it can only open in the current folder'
  }
})

const workdirs = (m: (typeof M)['zh']): ReadonlyArray<{ value: Workdir; label: string }> => [
  { value: 'worktree', label: m.newWorktree },
  { value: 'current', label: m.currentDir }
]

/** A project's git state as main read it; 'error' when it could not be read at all. */
type LoadedInfo = NewSessionInfo | 'error'

export function NewSessionSheet() {
  const open = useNewSessionSheet((s) => s.open)
  const generation = useNewSessionSheet((s) => s.generation)
  return open ? <Sheet key={generation} /> : null
}

function Sheet() {
  const m = useMessages(M)
  const projects = useWorkspace((s) => s.projects)
  // Read once: a sheet opened from 看板 · GitHub keeps its item while it is open.
  const [task] = useState<SheetTask | null>(() => useNewSessionSheet.getState().task)
  const [taskText, setTaskText] = useState(() => task?.prompt ?? '')
  const remembered = useWorkspace((s) => s.newSessionWorkdir)
  const [projectId, setProjectId] = useState<ProjectId | null>(() => useNewSessionSheet.getState().projectId ?? projects[0]?.id ?? null)
  const project = projects.find((p) => p.id === projectId) ?? null

  const [infos, setInfos] = useState<Record<ProjectId, LoadedInfo>>({})
  const loaded = projectId ? infos[projectId] : undefined
  const info = loaded && loaded !== 'error' ? loaded : null
  const notRepo = loaded === 'error' || info?.repo === false

  const [workdirChoice, setWorkdirChoice] = useState<Workdir | null>(null)
  const [baseChoice, setBaseChoice] = useState<string | null>(null)
  const [branchInput, setBranchInput] = useState<string | null>(null)
  const rememberedAgents = useWorkspace((s) => s.newSessionAgent)
  const [kindChoice, setKindChoice] = useState<AgentKind | null>(null)
  const kind: AgentKind = kindChoice ?? (projectId ? rememberedAgents[projectId] : undefined) ?? 'claude'
  const setKind = setKindChoice
  const rememberedUis = useWorkspace((s) => s.newSessionUi)
  const [uiChoice, setUiChoice] = useState<SessionUi | null>(null)
  const [copiedInstall, setCopiedInstall] = useState(false)
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [versions, setVersions] = useState<AgentVersions>({})
  const [prepareChoice, setPrepareChoice] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [menu, setMenu] = useState<{ kind: 'project' | 'base' | 'agent'; anchor: HTMLElement } | null>(null)
  // 新建 leader… opens the sheet with the toggle on, and only while the setting is (no wait for it then).
  const [leaderOn, setLeaderOn] = useState(() => useNewSessionSheet.getState().leader)
  const [leaderSetting, setLeaderSetting] = useState(leaderOn)
  const [leaderCheck, setLeaderCheck] = useState<LeaderCheck | null>(null)
  const projectLeader = useWorkspace((s) => (projectId ? leaderOf(s, projectId) : null))

  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!project || infos[project.id]) return
    let cancelled = false
    window.tr.gitWorktrees
      .newSessionInfo(project.rootPath)
      .then((next) => !cancelled && setInfos((all) => ({ ...all, [project.id]: next })))
      .catch(() => !cancelled && setInfos((all) => ({ ...all, [project.id]: 'error' })))
    return () => {
      cancelled = true
    }
  }, [project, infos])

  useEffect(() => sheetRef.current?.focus(), [])

  useEffect(() => {
    let cancelled = false
    void window.tr.app
      .detectAgents()
      .then((next) => !cancelled && setFound(next))
      .catch(() => {})
    void window.tr.app
      .agentVersions()
      .then((next) => !cancelled && setVersions(next))
      .catch(() => {})
    void window.tr.settings
      .get()
      .then((next) => !cancelled && setLeaderSetting(next.dispatch.leader))
      .catch(() => {})
    void window.tr.dispatch
      .leaderCheck()
      .then((next) => !cancelled && setLeaderCheck(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // A generated name per project, made once its branches are known (and kept while the sheet is open).
  // A PR whose branch is already here: checked out in a worktree, the session opens there; otherwise the new branch gets
  // the item's name and still starts at, and tracks, the PR head (WorktreeCreateRequest.startAt).
  const localPrBranch = task?.branch && info ? (info.branches.find((b) => !b.remote && b.name === task.branch) ?? null) : null
  const generated = useMemo(() => {
    if (!info?.repo) return ''
    const taken = new Set(info.branches.filter((b) => !b.remote).map((b) => b.name))
    if (task) return startBranch(info.prefix, task.branchFrom, task.branch, taken)
    return generateBranchName(info.prefix, taken)
  }, [info, task])

  // A sheet that hands a GitHub item to a new session (`task`) makes a worktree session, not a leader.
  const offerLeader = leaderSetting && projectLeader === null && task === null
  const leader = offerLeader && leaderOn
  // A leader runs in the main checkout as an agent that can lead here: the chosen one, else the first that can.
  const leaderKind = leaderBlock(kind, 'cli', leaderCheck) === null ? kind : (LEADER_KINDS.find((id) => leaderBlock(id, 'cli', leaderCheck) === null) ?? null)
  const workdir: Workdir = notRepo || leader ? 'current' : (workdirChoice ?? (task ? 'worktree' : initialWorkdir(remembered, projectId ?? '', true)))
  const base = baseChoice ?? (isElsewhere(localPrBranch) ? localPrBranch.name : task?.base) ?? (info ? defaultBase(info) : null)
  const branch = branchInput ?? generated
  const prepare = prepareChoice && ((info?.includeCount ?? 0) > 0 || info?.hasSetup === true)
  const form = { workdir, base, branch, prepare }
  const result = project ? planCreate(project.rootPath, info, form) : null
  const baseBranch = info ? selectedBase(info, form) : null
  const elsewhere = workdir === 'worktree' && isElsewhere(baseBranch) ? baseBranch : null
  const problem = result?.problem ?? null
  const branchProblem = problem === 'exists' || problem === 'invalid' || problem === 'empty' ? problem : null
  const showAdvanced = !!info?.repo && workdir === 'worktree' && !elsewhere
  const canCreate = leader ? !!project && leaderKind !== null : !!result?.plan
  const advancedOpen = advanced || branchProblem !== null
  const shownKind = leader ? (leaderKind ?? kind) : kind
  const ui: UiRow | null = leader ? LEADER_UI : uiRow(kind, uiChoice ?? initialUi(rememberedUis, projectId ?? ''), binaryInstalled(found))

  const chooseProject = (id: ProjectId): void => {
    setProjectId(id)
    setWorkdirChoice(null)
    setBaseChoice(null)
    setBranchInput(null)
    setPrepareChoice(true)
    setKindChoice(null)
    setUiChoice(null)
  }

  const sends = task !== null && kind !== 'shell' && taskText.trim() !== ''

  const create = (): void => {
    if (leader) {
      if (!project || !leaderKind) return
      closeNewSessionSheet(false)
      const id = useWorkspace.getState().addLeaderSession(project.id, leaderKind)
      if (id) useWorkspace.getState().setActiveSession(id)
      return
    }
    if (!project || !result?.plan) return
    closeNewSessionSheet(false)
    // A PR's worktree starts at the PR head main fetched; the chosen base stays what it merges into.
    const plan = task?.startAt && result.plan.type === 'worktree' ? { ...result.plan, request: { ...result.plan.request, startAt: task.startAt } } : result.plan
    // A choice made before the git state arrived still counts; only a folder known not to be a repo is not remembered.
    const id = runCreatePlan(project.id, plan, kind, workdir, !notRepo, ui?.value ?? 'cli', ui?.forced ?? false)
    if (id && task) handTask(id, task, kind, ui?.value ?? 'cli', sends ? taskText : null)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // The menus handle (and stop) their own Esc / Enter first; an input method composing (分支名) owns them too.
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeNewSessionSheet(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      create()
    }
  }

  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) closeNewSessionSheet(true)
  }

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu((open) => {
      if (refocus) open?.anchor.focus()
      return null
    })
  }, [])

  const toggleMenu = (kind: 'project' | 'base' | 'agent', anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })

  const agentSections = useCallback(
    (query: string): SheetMenuSection[] => {
      const q = query.trim().toLowerCase()
      const matches = (label: string): boolean => q === '' || label.toLowerCase().includes(q)
      const check = (value: AgentKind) => (value === shownKind ? <Check {...ICON} /> : null)
      const version = (id: AgentKind): string | undefined =>
        id !== 'shell' && found && found[id] === false ? m.missing : id !== 'shell' ? (versions[id] ?? undefined) : undefined
      if (leader) {
        return [
          {
            items: LEADER_KINDS.map((id) => {
              const blocked = leaderBlock(id, 'cli', leaderCheck)
              const meta = version(id)
              return { value: id, label: agentName(id), icon: check(id), meta: blocked ? (meta ? `${meta} · ${blocked}` : blocked) : meta, ...(blocked ? { disabled: true } : {}) }
            })
          }
        ]
      }
      const installed = listedAgents(found)
        .filter((id) => matches(agentName(id)) || (id !== 'shell' && matches(AGENT_SPECS[id].binary)))
        .map((id) => ({
          value: id,
          label: agentName(id),
          icon: check(id),
          meta: version(id)
        }))
      const others = [{ value: 'shell', label: m.terminal, icon: check('shell') }].filter((item) => matches(item.label))
      return [
        { title: m.installed, items: installed },
        { title: m.others, items: others }
      ]
    },
    [found, versions, shownKind, leader, leaderCheck, m]
  )
  const missingAgents = found ? CLI_AGENTS.filter((id) => !found[id]).length : 0

  const projectSections = useCallback(
    (): SheetMenuSection[] => [
      { items: projects.map((p) => ({ value: p.id, label: p.name, icon: p.id === projectId ? <Check {...ICON} /> : null })) }
    ],
    [projects, projectId]
  )

  const branchSections = useCallback(
    (query: string): SheetMenuSection[] => {
      if (!info) return []
      const groups = groupBranches(info.branches, info.defaultBranch, query)
      const icon = (name: string, remote: boolean, other: boolean) =>
        name === base ? <Check {...ICON} /> : remote ? <Globe {...ICON} /> : other ? <GitFork {...ICON} /> : <GitBranch {...ICON} />
      return [
        {
          title: m.localBranches,
          items: groups.local.map((b) => ({
            value: b.name,
            label: b.name,
            icon: icon(b.name, false, isElsewhere(b)),
            meta: isElsewhere(b) ? m.inWorktree : b.name === info.defaultBranch ? m.projectDefault : undefined
          }))
        },
        { title: m.remoteBranches, items: groups.remote.map((b) => ({ value: b.name, label: b.name, icon: icon(b.name, true, false) })) }
      ]
    },
    [info, base, m]
  )

  const hasElsewhere = info?.branches.some(isElsewhere) ?? false
  const home = window.tr.homeDir
  const prepText = info ? prepareText(info) : null
  const folderPath = info ? `${info.worktreesDir}/${folderFor(info, branch)}` : ''

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="new-session">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="new-session-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            {m.title}
          </h2>
          {task && <span className={styles.subtitle}>{task.title}</span>}
        </header>

        <div className={styles.fields}>
          <Field label={m.project}>
            <SelectButton
              label={m.project}
              value={project?.name ?? '—'}
              disabled={task !== null}
              expanded={menu?.kind === 'project'}
              onClick={(anchor) => toggleMenu('project', anchor)}
            />
          </Field>

          {offerLeader && (
            <div className={styles.field} role="group" aria-label={m.asLeader}>
              <span className={styles.labelSpacer} />
              <span className={styles.leader}>
                <Toggle checked={leaderOn} onChange={setLeaderOn} label={m.asLeader} />
                <span className={styles.leaderText} aria-hidden>
                  {m.asLeader}
                </span>
              </span>
            </div>
          )}

          <Field label={m.workdir} note={notRepo ? notRepoText(loaded) : null}>
            <Segmented
              label={m.workdir}
              value={workdir}
              options={workdirs(m).map((o) => ({ ...o, disabled: o.value === 'worktree' && (notRepo || leader) }))}
              onChange={setWorkdirChoice}
            />
          </Field>

          {!notRepo && (
            <Field
              label={m.base}
              disabled={workdir === 'current'}
              note={elsewhere ? m.elsewhere(tilde(elsewhere.worktreePath, home)) : null}
            >
              <SelectButton
                label={m.base}
                value={workdir === 'current' ? m.currentBranch(info?.currentBranch ?? 'HEAD') : (base ?? (info ? m.noBranch : '…'))}
                disabled={workdir === 'current' || !info}
                expanded={menu?.kind === 'base'}
                onClick={(anchor) => toggleMenu('base', anchor)}
              />
            </Field>
          )}

          <Field label={m.agent}>
            <SelectButton label={m.agent} value={agentName(shownKind)} expanded={menu?.kind === 'agent'} onClick={(anchor) => toggleMenu('agent', anchor)} />
          </Field>

          {ui && (
            <Field label={m.ui}>
              <Segmented
                label={m.ui}
                value={ui.value}
                options={UIS.map((o) => (o.value === 'gui' ? { ...o, disabled: ui.guiDisabled, title: ui.guiTitle } : o))}
                onChange={setUiChoice}
              />
            </Field>
          )}

          {ui?.adapter && (
            <div className={styles.adapter} role="group" aria-label={m.adapter}>
              <span className={styles.labelSpacer} />
              <span className={styles.adapterText}>{m.adapterNeeded(ui.adapter.binary)}</span>
              <button
                type="button"
                className={styles.adapterCopy}
                onClick={() => {
                  const command = ui.adapter?.install ?? ''
                  void navigator.clipboard
                    .writeText(command)
                    .then(() => setCopiedInstall(true))
                    .catch(() => {})
                }}
              >
                {copiedInstall ? m.copied : m.copyInstall}
              </button>
            </div>
          )}

          {task && (
            <Field label={m.task}>
              <textarea
                className={styles.task}
                aria-label={m.task}
                value={taskText}
                spellCheck={false}
                rows={9}
                onChange={(event) => setTaskText(event.currentTarget.value)}
              />
            </Field>
          )}

          {showAdvanced && (
            <button
              type="button"
              className={styles.advanced}
              aria-expanded={advancedOpen}
              onClick={() => setAdvanced(!advancedOpen)}
              disabled={branchProblem !== null}
            >
              <span className={styles.label}>{m.advanced}</span>
              {!advancedOpen && <span className={styles.advancedBranch}>{branch}</span>}
              <span className={styles.spacer} />
              {advancedOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
            </button>
          )}

          {showAdvanced && advancedOpen && (
            <>
              <Field
                label={m.branchName}
                error={branchProblemText(branchProblem, branch)}
              >
                <input
                  className={styles.input}
                  data-invalid={branchProblem !== null}
                  aria-invalid={branchProblem !== null}
                  aria-label={m.branchName}
                  value={branch}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setBranchInput(event.currentTarget.value)}
                />
              </Field>
              <Field label={m.folder}>
                <span className={styles.path} title={folderPath}>
                  {tilde(folderPath, home)}
                </span>
              </Field>
              <Field label={m.prepare}>
                <div className={styles.prep}>
                  <span className={styles.prepText}>{prepText ?? m.nothingToPrepare}</span>
                  {prepText && <Toggle checked={prepare} onChange={setPrepareChoice} label={m.prepareToggle} />}
                </div>
              </Field>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => closeNewSessionSheet(true)}>
            {m.cancel}
          </button>
          <button type="button" className={styles.primary} disabled={!canCreate} onClick={create}>
            {sends ? m.createAndSend : m.create}
            <span data-shortcut-hint className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>

      {menu?.kind === 'project' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.project}
          sections={projectSections}
          selected={projectId}
          empty={m.noProjects}
          onPick={(id) => {
            chooseProject(id)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'agent' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.agent}
          sections={agentSections}
          selected={shownKind}
          {...(leader ? {} : { search: m.searchAgents })}
          empty={m.noAgents}
          align="selected"
          hint={leader ? null : missingAgents > 0 ? m.agentHintMissing(missingAgents) : m.agentHint}
          onPick={(value) => {
            if (!isKindChoice(value)) return
            setKind(value)
            setCopiedInstall(false)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'base' && (
        <SheetMenu
          anchor={menu.anchor}
          label={m.base}
          sections={branchSections}
          selected={base}
          search={m.searchBranches}
          hint={hasElsewhere ? m.elsewhereHint : null}
          onPick={(name) => {
            setBaseChoice(name)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

function notRepoText(loaded: LoadedInfo | undefined): string {
  const m = pick(M)
  return loaded === 'error' ? m.unreadable : m.notRepo
}

export function Field({
  label,
  children,
  note,
  error,
  disabled = false
}: {
  label: string
  children: ReactNode
  note?: string | null
  error?: string | null
  disabled?: boolean
}) {
  return (
    <div className={styles.field} role="group" aria-label={label} data-disabled={disabled}>
      <span className={styles.labelBox}>
        <span className={styles.label}>{label}</span>
      </span>
      <div className={styles.control}>
        {children}
        {error && (
          <p className={styles.error} role="alert">
            <AlertCircle size={14} strokeWidth={1.75} aria-hidden />
            {error}
          </p>
        )}
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  )
}

export function SelectButton({
  label,
  value,
  expanded,
  disabled = false,
  onClick
}: {
  label: string
  value: string
  expanded: boolean
  disabled?: boolean
  onClick: (anchor: HTMLElement) => void
}) {
  return (
    <button
      type="button"
      className={styles.select}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
      onKeyDown={(event) => {
        if (!expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          onClick(event.currentTarget)
        }
      }}
    >
      <span className={styles.selectValue}>{value}</span>
      <ChevronDown {...ICON} />
    </button>
  )
}
