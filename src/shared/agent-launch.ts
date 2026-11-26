// How a session's agent is started inside the user's login shell (PRD §6.2).
// Pure: the pty-host supplies the shell and the real cwd.
import { AGENT_SPECS, hasOwnAdapter, type ClaudeOrCodex, type CliAgent } from './agents'
import { CLAUDE_MODE_OF, claudeLevel, GUI_PERMISSIONS, type CliPermission, type GuiPermission } from './gui-chat'
import { guiPermissionLevels } from './gui-agents'
import type { AgentKind, SessionUi } from './types'
import { isSafeAgentSessionId } from './workspace-file'

/** Single-quotes a word for POSIX shells. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** TOML basic string. */
export function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** How a terminal session starts at one 权限 level: arguments after the binary, and variables for this launch only. */
export interface CliPermissionLaunch {
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
}

const mode = (flag: string, values: Partial<Record<GuiPermission, string>>): Partial<Record<GuiPermission, CliPermissionLaunch>> =>
  Object.fromEntries(Object.entries(values).map(([level, value]) => [level, { args: [flag, value] }]))

/** Stands for Wavi's Pi gate extension (resources/hooks/wavi-pi-gate.js) until a launch puts its path in. */
const PI_GATE = '{waviPiGate}'

/**
 * PRD F24 v1.205: the 权限 levels each CLI can be launched with, and how. A level is listed only where the CLI has a
 * per-launch flag or variable for it (never a write to its config); `{}` is the CLI's own default with nothing passed.
 * 自动 only where the CLI judges steps itself. Measured with `--help`: Claude 2.1.326, Codex 0.167, Cursor 2026.10.22,
 * Grok 1.0.77, Pi 1.5.2 (no flags: Wavi's gate extension asks, resources/hooks/wavi-pi-gate.js). From each CLI's docs or source
 * (2026-11-17, not run here): Qwen Code, Gemini CLI, OpenCode, Goose, Copilot CLI, Kimi Code, Kiro, Crush, Cline,
 * Antigravity, CodeBuddy, Amp. Droid's levels are `droid exec` flags and Auggie's need its tool names: neither yet.
 */
export const CLI_PERMISSIONS: Readonly<Record<CliAgent, Partial<Record<GuiPermission, CliPermissionLaunch>>>> = {
  claude: { ask: {}, ...mode('--permission-mode', { 'accept-edits': CLAUDE_MODE_OF['accept-edits'], auto: CLAUDE_MODE_OF.auto, 'full-access': CLAUDE_MODE_OF['full-access'] }) },
  codex: {
    ask: { args: ['-s', 'read-only', '-a', 'on-request'] },
    'accept-edits': { args: ['-s', 'workspace-write', '-a', 'on-request'] },
    auto: { args: ['--approve-for-me'] },
    'full-access': { args: ['--dangerously-bypass-approvals-and-sandbox'] }
  },
  // `opencode --auto` (1.x and 2.x); its default allows everything in 1.x, and 2.x's rules are not per launch.
  opencode: { 'full-access': { args: ['--auto'] } },
  gemini: mode('--approval-mode', { ask: 'default', 'accept-edits': 'auto_edit', 'full-access': 'yolo' }),
  qwen: mode('--approval-mode', { ask: 'default', 'accept-edits': 'auto-edit', auto: 'auto', 'full-access': 'yolo' }),
  pi: {
    ask: { args: ['-e', PI_GATE], env: { WAVI_PI_PERMISSION: 'ask' } },
    'accept-edits': { args: ['-e', PI_GATE], env: { WAVI_PI_PERMISSION: 'accept-edits' } },
    'full-access': {}
  },
  copilot: { ask: {}, 'accept-edits': { args: ['--allow-tool', 'write'] }, 'full-access': { args: ['--yolo'] } },
  cursor: { ask: {}, auto: { args: ['--auto-review'] }, 'full-access': { args: ['--yolo'] } },
  grok: mode('--permission-mode', { ask: 'default', 'accept-edits': 'acceptEdits', auto: 'auto', 'full-access': 'bypassPermissions' }),
  // Kimi Code's `--yolo` is "Ask When Needed" by fixed rules, not a judge of its own: not 自动.
  kimi: { ask: {}, 'full-access': { args: ['--auto'] } },
  droid: {},
  amp: { 'full-access': {} },
  kiro: { ask: {}, 'full-access': { args: ['--trust-all-tools'] } },
  crush: { ask: {}, 'full-access': { args: ['-y'] } },
  goose: {
    ask: { env: { GOOSE_MODE: 'approve' } },
    auto: { env: { GOOSE_MODE: 'smart_approve' } },
    'full-access': { env: { GOOSE_MODE: 'auto' } }
  },
  cline: { ask: { args: ['--auto-approve', 'false'] }, 'full-access': { args: ['--auto-approve', 'true'] } },
  antigravity: { ask: {}, 'accept-edits': { args: ['--mode', 'accept-edits'] }, auto: { args: ['--mode', 'auto'] }, 'full-access': { args: ['--dangerously-skip-permissions'] } },
  auggie: {},
  codebuddy: mode('--permission-mode', { ask: 'default', 'accept-edits': 'acceptEdits', auto: 'auto', 'full-access': 'bypassPermissions' })
}

/** The levels a terminal session of this CLI can be launched with, least to most access. */
export function cliPermissionLevels(kind: CliAgent): readonly GuiPermission[] {
  return GUI_PERMISSIONS.filter((level) => CLI_PERMISSIONS[kind][level] !== undefined)
}

/** The level that is the CLI's plain launch (nothing passed), if one is: what a 定时任务 without a 权限 runs at. */
export function cliPlainPermission(kind: CliAgent): GuiPermission | undefined {
  return cliPermissionLevels(kind).find((level) => {
    const launch = CLI_PERMISSIONS[kind][level]
    return !launch?.args?.length && !launch?.env
  })
}

/**
 * The 权限 a dispatching session runs at now, as far as Wavi knows it (PRD F21 v1.209): a GUI session's picker; a
 * terminal Claude's last reported `permission_mode` (its hooks, §6.16); else a leader's launch level (`leaderLevel`,
 * dispatch.ts `LEADER_PERMISSION`), which Codex never reports changing (measured). None while planning or otherwise:
 * its children start at their agent's default.
 */
export function dispatcherPermission(d: { kind: AgentKind; ui: SessionUi; guiPermission?: GuiPermission; guiPlan?: boolean; reported?: string; leaderLevel?: GuiPermission }): GuiPermission | undefined {
  if (d.ui === 'gui') return d.guiPlan ? undefined : d.guiPermission
  if (d.kind === 'claude' && d.reported !== undefined) return d.reported === 'plan' ? undefined : claudeLevel(d.reported, undefined)
  return d.leaderLevel
}

/**
 * The 权限 a dispatched session starts at (PRD F21 v1.209): its dispatcher's, when its agent has that level in its
 * 界面; 完全访问 for a 自动 it lacks (the author, 2026-11-18: no asking); its agent's default otherwise.
 */
export function childPermission(level: GuiPermission | undefined, agent: CliAgent, ui: SessionUi): GuiPermission | undefined {
  if (!level) return undefined
  const levels = ui === 'gui' ? guiPermissionLevels(agent) : cliPermissionLevels(agent)
  if (levels.includes(level)) return level
  return level === 'auto' && levels.includes('full-access') ? 'full-access' : undefined
}

/** Whether no level is the CLI's plain launch: the 定时任务 form then offers 默认 (nothing passed) first. */
export const cliPermissionHasDefault = (kind: CliAgent): boolean => cliPlainPermission(kind) === undefined

/**
 * The launch of a level for this CLI; none when it has no such level or the session resumes (its own default then).
 * A level that needs Wavi's Pi gate fails without its path rather than start Pi asking nothing.
 */
function permissionLaunch(kind: Exclude<AgentKind, 'shell'>, options: AgentLaunchOptions): CliPermissionLaunch {
  if (!options.permission || isSafeAgentSessionId(options.resumeAgentSessionId)) return {}
  const launch = CLI_PERMISSIONS[kind][options.permission] ?? {}
  if (!launch.args?.includes(PI_GATE)) return launch
  const gate = options.piGatePath
  if (!gate) throw new Error('the Pi permission gate (wavi-pi-gate.js) is missing')
  return { ...launch, args: launch.args.map((arg) => (arg === PI_GATE ? gate : arg)) }
}

/**
 * Argument vector for the agent CLI. Codex trust is granted per launch with `-c` overrides,
 * so nothing is written to `~/.codex`; the inline-table form is the one that works (spike §6).
 * Codex hooks are injected the same way: `-c hooks.<Event>=[…]` plus a `-c hooks.state={…trusted_hash…}`
 * that pins exactly those definitions as trusted (PRD §6.7), so no `~/.codex` write and no
 * `--dangerously-bypass-hook-trust`.
 * Claude has no such flag: its trust dialog is answered by the user in the terminal.
 * Claude's hooks are injected per launch with `--settings <file>` (PRD §6.2); the file holds hooks
 * only and Claude merges it with the user's own settings, so nothing global is written
 * (PRD §6.6). Note that a *second* `--settings` flag replaces this one, not merges.
 */
export interface AgentLaunchOptions {
  /** Hooks-only settings JSON for Claude (see src/main/hooks/settings.ts). */
  claudeSettingsPath?: string
  /** TOML `key=value` overrides for Codex, each passed as its own `-c` (see src/main/hooks/codex-config.ts). */
  codexConfig?: readonly string[]
  /**
   * Continue this earlier conversation instead of starting a new one: `claude --resume <id>` /
   * `codex resume <id>` (Codex 0.142.5 `codex resume [OPTIONS] [SESSION_ID]`). Ignored unless it is a safe id.
   */
  resumeAgentSessionId?: string
  /**
   * A command (sh / zsh / bash / fish syntax alike) to run first in the same login shell, e.g. the repository's setup
   * script (script-launch.ts `setupCommand`). The agent starts when it returns, whatever its exit code.
   */
  before?: string
  /**
   * A folder put first on PATH by the script itself, after the user's rc files ran (PRD F21: `<userData>/bin` with
   * `wavi`; set in the environment instead, `.zshrc` pushes it back, §6.14 v1.104).
   */
  pathPrefix?: string
  /** A model for this launch (`claude --model` / `codex -m`), e.g. what a dispatching agent asked for (PRD F21). */
  model?: string
  /** Reasoning effort for this launch, for the CLIs with such a flag (agents.ts `effort`, PRD F9 v1.252); ignored otherwise and when resuming. */
  effort?: string
  /**
   * A 定时任务's 权限 (PRD F24 v1.205): the CLI's flag or variable for it (CLI_PERMISSIONS); ignored for a level the
   * CLI does not have, when resuming, and when `extraArgs` name a mode of their own (a leader's, PRD F21 v1.198).
   */
  permission?: CliPermission
  /** Wavi's Pi gate extension (resources/hooks/wavi-pi-gate.js), loaded for Pi's 询问 / 接受编辑 whether or not hooks are. */
  piGatePath?: string
  /**
   * The first message, passed after `--` so the CLI submits it itself (PRD F21: nothing is typed into a starting TUI).
   * Ignored when resuming.
   */
  initialPrompt?: string
  /**
   * Arguments added after the binary: an agent's per-launch adapter (Pi's `-e <extension>`, src/main/hooks) and the
   * dispatch system prompt (`--append-system-prompt …`, Codex `-c developer_instructions=…`, PRD F21).
   */
  extraArgs?: readonly string[]
}

/**
 * The conversation id a session of a CLI without hooks saves once its agent has run: there is no real id to keep,
 * and each session has its own worktree, so resuming means “the most recent conversation in this directory”.
 */
export const CONTINUE_LATEST = 'wavi-continue-latest'

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,79}$/
const EFFORT = /^[a-z][a-z0-9-]{0,31}$/

/** Whether a model id / an effort level can go on a command line (main refuses a spawn that names anything else). */
export const isLaunchModel = (value: string): boolean => MODEL.test(value)
export const isLaunchEffort = (value: string): boolean => EFFORT.test(value)

/** The CLI's arguments for this effort, none for a CLI without the flag. */
function effortArgs(kind: Exclude<AgentKind, 'shell'>, effort: string | undefined): string[] {
  const spec = AGENT_SPECS[kind].effort
  return effort !== undefined && spec ? spec.args.map((arg) => arg.replaceAll('{effort}', effort)) : []
}

export function agentArgv(kind: Exclude<AgentKind, 'shell'>, realCwd: string, options: AgentLaunchOptions = {}): string[] {
  const resumeId = isSafeAgentSessionId(options.resumeAgentSessionId) ? options.resumeAgentSessionId : undefined
  const model = options.model !== undefined && MODEL.test(options.model) ? options.model : undefined
  const effort = !resumeId && options.effort !== undefined && isLaunchEffort(options.effort) ? options.effort : undefined
  const prompt = !resumeId && options.initialPrompt?.trim() ? ['--', options.initialPrompt] : []
  if (!hasOwnAdapter(kind)) return otherAgentArgv(kind, resumeId, model, effort, options)
  if (kind === 'claude') {
    // A leader's own `--permission-mode auto` (dispatch.ts `leaderLaunchArgs`) wins over a 定时任务's 权限.
    const ownMode = options.extraArgs?.includes('--permission-mode') === true
    return [
      'claude',
      ...(resumeId ? ['--resume', resumeId] : []),
      ...(options.claudeSettingsPath ? ['--settings', options.claudeSettingsPath] : []),
      ...(options.extraArgs ?? []),
      ...(model ? ['--model', model] : []),
      ...effortArgs(kind, effort),
      ...(ownMode ? [] : (permissionLaunch(kind, options).args ?? [])),
      ...prompt
    ]
  }
  return [
    'codex',
    ...(resumeId ? ['resume', resumeId] : []),
    '-c',
    'check_for_update_on_startup=false',
    '-c',
    `projects={${tomlString(realCwd)}={trust_level="trusted"}}`,
    ...(options.codexConfig ?? []).flatMap((override) => ['-c', override]),
    ...(options.extraArgs ?? []),
    // A leader's own permission profile (dispatch.ts `leaderLaunchArgs`) wins over a 定时任务's 权限.
    ...(options.extraArgs?.some((arg) => arg.startsWith('default_permissions=')) ? [] : (permissionLaunch(kind, options).args ?? [])),
    ...(model ? ['-m', model] : []),
    ...effortArgs(kind, effort),
    ...prompt
  ]
}

/** Every other CLI, from its row in agents.ts: binary, its own fixed arguments, the adapter's, resume, model, first prompt. */
function otherAgentArgv(kind: Exclude<AgentKind, 'shell' | ClaudeOrCodex>, resumeId: string | undefined, model: string | undefined, effort: string | undefined, options: AgentLaunchOptions): string[] {
  const spec = AGENT_SPECS[kind]
  const resume =
    resumeId === undefined
      ? []
      : resumeId === CONTINUE_LATEST
        ? [...(spec.continueLatest ?? [])]
        : (spec.resumeById ?? spec.continueLatest ?? []).map((arg) => arg.replaceAll('{id}', resumeId))
  const text = resume.length === 0 ? options.initialPrompt?.trim() : undefined
  const prompt =
    !text || spec.prompt.kind === 'type'
      ? []
      : spec.prompt.kind === 'flag'
        ? [spec.prompt.flag, options.initialPrompt ?? '']
        : spec.prompt.separator
          ? ['--', options.initialPrompt ?? '']
          : [options.initialPrompt ?? '']
  return [
    spec.binary,
    ...(spec.baseArgs ?? []),
    ...(options.extraArgs ?? []),
    ...(permissionLaunch(kind, options).args ?? []),
    ...resume,
    ...(model && spec.modelFlag ? [spec.modelFlag, model] : []),
    ...effortArgs(kind, effort),
    ...prompt
  ]
}

/** Whether a first message can ride on this CLI's command line; when not, it is sent once the TUI is up (§6.9). */
export function promptOnCommandLine(kind: Exclude<AgentKind, 'shell'>): boolean {
  return AGENT_SPECS[kind].prompt.kind !== 'type'
}

/** OSC number the launch script uses to tell the terminal what became of the agent process. */
export const AGENT_MARKER_OSC = 7771

export type AgentMarker =
  /** The agent process ended (its exit code); the PTY now holds a plain login shell. */
  | { type: 'exit'; code: number }
  /** The CLI is not on the login shell's PATH. */
  | { type: 'missing' }

export function parseAgentMarker(payload: string): AgentMarker | null {
  if (payload === 'missing') return { type: 'missing' }
  const match = /^exit;(-?\d{1,3})$/.exec(payload)
  return match ? { type: 'exit', code: Number(match[1]) } : null
}

/**
 * Shell arguments that run the agent and then stay in an interactive login shell, so the
 * session survives the agent exiting (the user can re-run it or inspect the directory).
 * `-i` loads the user's rc files so version managers put the CLI on PATH.
 *
 * The script also reports what happened as an OSC marker (AGENT_MARKER_OSC): `missing` when the CLI is
 * not installed (phase 2 · A8 preflight: `command -v` in the same login shell that would run it) and
 * `exit;<code>` once the agent process is gone, so the app knows the shell prompt is back (A3).
 */
export function agentShellArgs(kind: AgentKind, realCwd: string, shell: string, options: AgentLaunchOptions = {}): string[] {
  const fish = /(?:^|\/)fish$/.test(shell)
  const path = options.pathPrefix && kind !== 'shell' ? (fish ? `set -gx PATH ${shellQuote(options.pathPrefix)} $PATH; ` : `PATH=${shellQuote(options.pathPrefix)}:"$PATH"; export PATH; `) : ''
  const before = `${path}${options.before ? `${options.before}; ` : ''}`
  if (kind === 'shell') return before ? ['-l', '-i', '-c', `${before}exec ${shellQuote(shell)} -l`] : ['-l']
  // A level's variables (Goose `GOOSE_MODE`, Pi's `WAVI_PI_PERMISSION`) through `env`, for this launch only (sh and fish alike).
  const vars = Object.entries(permissionLaunch(kind, options).env ?? {}).map(([name, value]) => `${name}=${value}`)
  const line = [...(vars.length > 0 ? ['env', ...vars] : []), ...agentArgv(kind, realCwd, options)].map(shellQuote).join(' ')
  const marker = (payload: string) => `printf '\\033]${AGENT_MARKER_OSC};${payload}\\007'`
  const check = `command -v ${AGENT_SPECS[kind].binary} >/dev/null 2>&1`
  const script = fish
    ? `if ${check}; ${line}; ${marker('exit;%s')} $status; else; ${marker('missing')}; end`
    : `if ${check}; then ${line}; ${marker('exit;%s')} "$?"; else ${marker('missing')}; fi`
  return ['-l', '-i', '-c', `${before}${script}; exec ${shellQuote(shell)} -l`]
}
