import { describe, expect, it } from 'vitest'
import { agentArgv, agentShellArgs, childPermission, CLI_PERMISSIONS, cliPermissionHasDefault, cliPermissionLevels, cliPlainPermission, CONTINUE_LATEST, dispatcherPermission, parseAgentMarker, shellQuote } from './agent-launch'
import { CLI_AGENTS } from './agents'

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded ones', () => {
    expect(shellQuote('a b $HOME "q"')).toBe(`'a b $HOME "q"'`)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('agentArgv', () => {
  it('gives claude the 定时任务 permission mode, but not when resuming (PRD F24)', () => {
    expect(agentArgv('claude', '/r', { permission: 'accept-edits', initialPrompt: 'go' })).toEqual(['claude', '--permission-mode', 'acceptEdits', '--', 'go'])
    expect(agentArgv('claude', '/r', { permission: 'full-access', initialPrompt: 'go' })).toEqual(['claude', '--permission-mode', 'bypassPermissions', '--', 'go'])
    expect(agentArgv('claude', '/r', { permission: 'ask' })).toEqual(['claude'])
    expect(agentArgv('claude', '/r', { permission: 'auto', resumeAgentSessionId: 'abc' })).not.toContain('--permission-mode')
  })

  it('gives every other CLI its own flag for the level, before the first message; a level it lacks passes none (PRD F24 v1.205)', () => {
    expect(agentArgv('codex', '/r', { permission: 'full-access', initialPrompt: 'go' }).slice(-3)).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--', 'go'])
    expect(agentArgv('gemini', '/r', { permission: 'accept-edits' })).toEqual(['gemini', '--approval-mode', 'auto_edit'])
    expect(agentArgv('kiro', '/r', { permission: 'full-access' })).toEqual(['kiro-cli', 'chat', '--tui', '--trust-all-tools'])
    expect(agentArgv('kimi', '/r', { permission: 'auto' })).toEqual(['kimi'])
    // Pi's 询问 loads Wavi's gate, and will not start without it (PRD F24 v1.205).
    expect(agentArgv('pi', '/r', { permission: 'accept-edits', piGatePath: '/r/wavi-pi-gate.js' })).toEqual(['pi', '-e', '/r/wavi-pi-gate.js'])
    expect(() => agentArgv('pi', '/r', { permission: 'ask' })).toThrow(/gate/)
    expect(agentArgv('pi', '/r', { permission: 'full-access' })).toEqual(['pi'])
    // A leader's read-only profile wins over a 定时任务's level.
    expect(agentArgv('codex', '/r', { permission: 'full-access', extraArgs: ['-c', 'default_permissions="wavi-leader"'] })).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('lists each CLI’s levels, and 默认 only where no level is its plain launch', () => {
    expect(cliPermissionLevels('claude')).toEqual(['ask', 'accept-edits', 'auto', 'full-access'])
    expect(cliPermissionHasDefault('claude')).toBe(false)
    expect(cliPermissionLevels('pi')).toEqual(['ask', 'accept-edits', 'full-access'])
    expect(cliPermissionHasDefault('pi')).toBe(false)
    expect(cliPermissionLevels('codex')).toEqual(['ask', 'accept-edits', 'auto', 'full-access'])
    expect(cliPermissionHasDefault('codex')).toBe(true)
    expect(cliPermissionLevels('amp')).toEqual(['full-access'])
    expect(cliPermissionHasDefault('amp')).toBe(false)
    expect(cliPlainPermission('pi')).toBe('full-access')
    expect(cliPlainPermission('codex')).toBeUndefined()
    expect(cliPermissionLevels('droid')).toEqual([])
    expect(cliPermissionHasDefault('droid')).toBe(true)
    // Every CLI has a row, and every level that never asks is the last one it lists.
    for (const kind of CLI_AGENTS) {
      expect(CLI_PERMISSIONS[kind]).toBeDefined()
      const levels = cliPermissionLevels(kind)
      if (levels.includes('full-access')) expect(levels.at(-1)).toBe('full-access')
    }
  })

  it('starts claude with no extra flags', () => {
    expect(agentArgv('claude', '/tmp/x')).toEqual(['claude'])
  })

  it('injects the hooks-only settings file for claude with --settings', () => {
    expect(agentArgv('claude', '/tmp/x', { claudeSettingsPath: '/tmp/tr-hooks-ab/claude-settings.json' })).toEqual([
      'claude',
      '--settings',
      '/tmp/tr-hooks-ab/claude-settings.json'
    ])
  })

  it('does not pass claude settings to codex', () => {
    expect(agentArgv('codex', '/tmp/x', { claudeSettingsPath: '/s.json' })).not.toContain('--settings')
  })

  it('pre-trusts the codex directory per launch and skips the update prompt', () => {
    expect(agentArgv('codex', '/Users/dev/code/acme')).toEqual([
      'codex',
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'projects={"/Users/dev/code/acme"={trust_level="trusted"}}'
    ])
  })

  it('adds the dispatch system prompt, a model and the first task after -- (PRD F21)', () => {
    expect(
      agentArgv('claude', '/tmp/x', { claudeSettingsPath: '/s.json', extraArgs: ['--append-system-prompt', 'use wavi'], model: 'opus', initialPrompt: '-p mcp do it' })
    ).toEqual(['claude', '--settings', '/s.json', '--append-system-prompt', 'use wavi', '--model', 'opus', '--', '-p mcp do it'])
    expect(agentArgv('codex', '/tmp/x', { extraArgs: ['-c', 'developer_instructions="w"'], model: 'gpt-5-codex', initialPrompt: 'do it' }).slice(-6)).toEqual([
      '-c',
      'developer_instructions="w"',
      '-m',
      'gpt-5-codex',
      '--',
      'do it'
    ])
  })

  it('puts the wavi folder first on PATH inside the script, after the rc files ran (PRD F21, §6.14 v1.104)', () => {
    const zsh = agentShellArgs('grok', '/tmp', '/bin/zsh', { pathPrefix: '/Users/a/Library/Application Support/Wavi/bin' })[3]!
    expect(zsh.startsWith(`PATH='/Users/a/Library/Application Support/Wavi/bin':"$PATH"; export PATH; if command -v grok`)).toBe(true)
    expect(agentShellArgs('grok', '/tmp', '/opt/homebrew/bin/fish', { pathPrefix: '/w/bin' })[3]!.startsWith(`set -gx PATH '/w/bin' $PATH; if command -v grok`)).toBe(true)
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh', { pathPrefix: '/w/bin' })).toEqual(['-l'])
  })

  it('never resends the first task when resuming, and drops a model that is not a name', () => {
    const id = '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b'
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id, initialPrompt: 'again', model: '--evil' })).toEqual(['claude', '--resume', id])
  })

  it('escapes quotes and backslashes in the TOML key', () => {
    expect(agentArgv('codex', '/a "b"\\c')[4]).toBe('projects={"/a \\"b\\"\\\\c"={trust_level="trusted"}}')
  })
})

/** The launch script around an agent command line (see agentShellArgs). */
const script = (kind: 'claude' | 'codex', line: string, shell = '/bin/zsh') =>
  `if command -v ${kind} >/dev/null 2>&1; then ${line}; printf '\\033]7771;exit;%s\\007' "$?"; ` +
  `else printf '\\033]7771;missing\\007'; fi; exec '${shell}' -l`

describe('resuming a conversation', () => {
  const id = '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b'

  it('claude: --resume <id> next to the hooks settings', () => {
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id })).toEqual(['claude', '--resume', id])
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id, claudeSettingsPath: '/s.json' })).toEqual([
      'claude',
      '--resume',
      id,
      '--settings',
      '/s.json'
    ])
  })

  it('codex: the resume subcommand comes first, then the per-launch -c overrides', () => {
    expect(agentArgv('codex', '/a', { resumeAgentSessionId: id, codexConfig: ['hooks.x=1'] })).toEqual([
      'codex',
      'resume',
      id,
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'projects={"/a"={trust_level="trusted"}}',
      '-c',
      'hooks.x=1'
    ])
  })

  it('does not resume without an id, or with an id that is not a plain token', () => {
    expect(agentArgv('claude', '/a', {})).toEqual(['claude'])
    expect(agentArgv('claude', '/a', { resumeAgentSessionId: '' })).toEqual(['claude'])
    expect(agentArgv('claude', '/a', { resumeAgentSessionId: '--dangerously-skip-permissions' })).toEqual(['claude'])
    expect(agentArgv('codex', '/a', { resumeAgentSessionId: '$(reboot)' })).not.toContain('resume')
  })

  it('shell-quotes the id as one word', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(script('claude', `'claude' '--resume' '${id}'`))
    expect(agentShellArgs('codex', '/a b', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(
      script('codex', `'codex' 'resume' '${id}' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'`)
    )
  })

  it('a plain shell session ignores the id', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh', { resumeAgentSessionId: id })).toEqual(['-l'])
  })
})

describe('agentShellArgs', () => {
  it('is a plain login shell for shell sessions', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh')).toEqual(['-l'])
  })

  it('runs `before` (the setup script) first, for agents and plain shells alike', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh', { before: 'make setup' })).toEqual(['-l', '-i', '-c', "make setup; exec '/bin/zsh' -l"])
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { before: 'make setup' })[3]).toBe(`make setup; ${script('claude', "'claude'")}`)
  })

  it('sets a level’s variables for this launch only, through env (Goose, Pi; PRD F24 v1.205)', () => {
    expect(agentShellArgs('goose', '/tmp', '/bin/zsh', { permission: 'auto' })[3]).toContain("'env' 'GOOSE_MODE=smart_approve' 'goose' 'session'")
    expect(agentShellArgs('pi', '/tmp', '/usr/local/bin/fish', { permission: 'ask', piGatePath: '/r/wavi-pi-gate.js' })[3]).toContain("'env' 'WAVI_PI_PERMISSION=ask' 'pi' '-e' '/r/wavi-pi-gate.js'")
    expect(agentShellArgs('pi', '/tmp', '/bin/zsh', { permission: 'full-access' })[3]).not.toContain("'env'")
    expect(agentShellArgs('goose', '/tmp', '/bin/zsh', { permission: 'auto', resumeAgentSessionId: CONTINUE_LATEST })[3]).not.toContain('GOOSE_MODE')
  })

  it('runs the agent, reports how it ended, then execs a login shell', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh')).toEqual(['-l', '-i', '-c', script('claude', "'claude'")])
  })

  it('checks that the CLI exists in the same login shell and reports a missing one', () => {
    const line = agentShellArgs('codex', '/tmp', '/bin/zsh')[3] ?? ''
    expect(line).toContain('command -v codex >/dev/null 2>&1')
    expect(line).toContain(`printf '\\033]7771;missing\\007'`)
  })

  it('uses fish syntax for fish login shells', () => {
    const line = agentShellArgs('claude', '/tmp', '/opt/homebrew/bin/fish')[3] ?? ''
    expect(line).toBe(
      `if command -v claude >/dev/null 2>&1; 'claude'; printf '\\033]7771;exit;%s\\007' $status; else; printf '\\033]7771;missing\\007'; end; exec '/opt/homebrew/bin/fish' -l`
    )
  })

  it('quotes the settings path as one shell word, spaces and quotes included', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { claudeSettingsPath: "/var/it's here/s.json" })[3]).toBe(
      script('claude', `'claude' '--settings' '/var/it'\\''s here/s.json'`)
    )
  })

  it('quotes every codex argument as one shell word', () => {
    expect(agentShellArgs('codex', '/a b', '/bin/zsh')[3]).toBe(
      script('codex', `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'`)
    )
  })

  it('keeps codex hook overrides intact through the shell (TOML quotes and the single-quoted script path)', () => {
    const override = `hooks.Stop=[{hooks=[{type="command",command="/bin/sh '/a b/tr-hook.sh' Stop codex"}]}]`
    expect(agentShellArgs('codex', '/a', '/bin/zsh', { codexConfig: [override] })[3]).toBe(
      script(
        'codex',
        `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a"={trust_level="trusted"}}' '-c' ` +
          `'hooks.Stop=[{hooks=[{type="command",command="/bin/sh '\\''/a b/tr-hook.sh'\\'' Stop codex"}]}]'`
      )
    )
  })
})

describe('parseAgentMarker', () => {
  it('reads exit codes and the missing marker', () => {
    expect(parseAgentMarker('exit;0')).toEqual({ type: 'exit', code: 0 })
    expect(parseAgentMarker('exit;130')).toEqual({ type: 'exit', code: 130 })
    expect(parseAgentMarker('missing')).toEqual({ type: 'missing' })
  })

  it('ignores anything else', () => {
    expect(parseAgentMarker('exit;')).toBeNull()
    expect(parseAgentMarker('exit;x')).toBeNull()
    expect(parseAgentMarker('')).toBeNull()
  })
})

describe('other agent CLIs (agents.ts rows)', () => {
  it('passes the first message the way each CLI keeps its TUI open', () => {
    expect(agentArgv('opencode', '/w', { initialPrompt: 'fix it' })).toEqual(['opencode', '--prompt', 'fix it'])
    expect(agentArgv('qwen', '/w', { initialPrompt: 'fix it' })).toEqual(['qwen', '--prompt-interactive', 'fix it'])
    expect(agentArgv('pi', '/w', { initialPrompt: 'fix it' })).toEqual(['pi', 'fix it'])
    expect(agentArgv('grok', '/w', { initialPrompt: '--help me' })).toEqual(['grok', '--', '--help me'])
    // Kimi takes no prompt argument: the message is not put on the command line.
    expect(agentArgv('kimi', '/w', { initialPrompt: 'fix it' })).toEqual(['kimi'])
  })

  it('adds the adapter arguments, the fixed subcommand and the model', () => {
    expect(agentArgv('gemini', '/w', { extraArgs: ['--skip-trust'], model: 'gemini-3-pro' })).toEqual(['gemini', '--skip-trust', '--model', 'gemini-3-pro'])
    expect(agentArgv('pi', '/w', { extraArgs: ['-e', '/r/wavi-pi.js'] })).toEqual(['pi', '-e', '/r/wavi-pi.js'])
    expect(agentArgv('kiro', '/w')).toEqual(['kiro-cli', 'chat', '--tui'])
    // OpenCode 2 has no root --model: the model is dropped rather than passed as a stray flag.
    expect(agentArgv('opencode', '/w', { model: 'x/y' })).toEqual(['opencode'])
  })

  it('resumes by id, or continues the latest conversation for a session without a real id', () => {
    expect(agentArgv('gemini', '/w', { resumeAgentSessionId: 'abc-1', initialPrompt: 'x' })).toEqual(['gemini', '--resume', 'abc-1'])
    expect(agentArgv('copilot', '/w', { resumeAgentSessionId: 'abc-1' })).toEqual(['copilot', '--resume=abc-1'])
    expect(agentArgv('opencode', '/w', { resumeAgentSessionId: CONTINUE_LATEST })).toEqual(['opencode', '--continue'])
    expect(agentArgv('goose', '/w', { resumeAgentSessionId: CONTINUE_LATEST })).toEqual(['goose', 'session'])
  })

  it('checks for the CLI by its binary, not its id', () => {
    const script = agentShellArgs('cursor', '/w', '/bin/zsh')[3] ?? ''
    expect(script).toContain('command -v cursor-agent >/dev/null 2>&1')
    expect(script).toContain(`'cursor-agent'`)
  })
})

describe('a child starts at its dispatcher\'s 权限 (PRD F21 v1.209)', () => {
  it('reads the dispatcher: a GUI session its picker, Claude in a terminal its reported mode, a leader 自动 until it reports', () => {
    expect(dispatcherPermission({ kind: 'claude', ui: 'gui', guiPermission: 'accept-edits' })).toBe('accept-edits')
    expect(dispatcherPermission({ kind: 'codex', ui: 'gui', guiPermission: 'full-access', guiPlan: true })).toBeUndefined()
    expect(dispatcherPermission({ kind: 'claude', ui: 'gui' })).toBeUndefined()
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', reported: 'bypassPermissions' })).toBe('full-access')
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', reported: 'default' })).toBe('ask')
    // Modes without a level of their own (dontAsk, a newer name) are 询问, as in the GUI.
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', reported: 'dontAsk' })).toBe('ask')
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', reported: 'acceptEdits', leaderLevel: 'auto' })).toBe('accept-edits')
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', reported: 'plan', leaderLevel: 'auto' })).toBeUndefined()
    expect(dispatcherPermission({ kind: 'claude', ui: 'cli', leaderLevel: 'auto' })).toBe('auto')
    // Codex in a terminal always reports "default" (measured), so only a leader's launch says what it runs at.
    expect(dispatcherPermission({ kind: 'codex', ui: 'cli', reported: 'default', leaderLevel: 'auto' })).toBe('auto')
    expect(dispatcherPermission({ kind: 'codex', ui: 'cli', reported: 'default' })).toBeUndefined()
    expect(dispatcherPermission({ kind: 'gemini', ui: 'cli' })).toBeUndefined()
  })

  it('gives the child that level when its agent has it there, 完全访问 for a 自动 it lacks, else its own default', () => {
    expect(childPermission('auto', 'claude', 'cli')).toBe('auto')
    expect(childPermission('auto', 'codex', 'gui')).toBe('auto')
    expect(childPermission('auto', 'pi', 'cli')).toBe('full-access')
    expect(childPermission('auto', 'gemini', 'cli')).toBe('full-access')
    expect(childPermission('auto', 'pi', 'gui')).toBe('full-access')
    expect(childPermission('accept-edits', 'pi', 'cli')).toBe('accept-edits')
    expect(childPermission('accept-edits', 'cursor', 'cli')).toBeUndefined()
    expect(childPermission('ask', 'opencode', 'cli')).toBeUndefined()
    expect(childPermission(undefined, 'claude', 'cli')).toBeUndefined()
    // No launch flag at all (Droid, Auggie): their default, whatever the dispatcher runs at.
    expect(childPermission('auto', 'droid', 'cli')).toBeUndefined()
  })
})

describe('agentArgv effort (PRD F9 v1.252)', () => {
  it('gives each CLI with a flag its own, next to the model and before the first message', () => {
    expect(agentArgv('claude', '/r', { model: 'opus', effort: 'high', initialPrompt: 'go' })).toEqual(['claude', '--model', 'opus', '--effort', 'high', '--', 'go'])
    expect(agentArgv('codex', '/r', { effort: 'xhigh', initialPrompt: 'go' }).slice(-4)).toEqual(['-c', 'model_reasoning_effort="xhigh"', '--', 'go'])
    expect(agentArgv('pi', '/r', { model: 'm', effort: 'off', initialPrompt: 'go' })).toEqual(['pi', '--model', 'm', '--thinking', 'off', 'go'])
    expect(agentArgv('grok', '/r', { effort: 'low' })).toEqual(['grok', '--effort', 'low'])
  })
  it('passes nothing for a CLI without the flag', () => {
    for (const kind of CLI_AGENTS.filter((id) => !['claude', 'codex', 'pi', 'grok'].includes(id))) {
      expect(agentArgv(kind, '/r', { effort: 'high' })).toEqual(agentArgv(kind, '/r'))
    }
    expect(agentArgv('cursor', '/r', { effort: 'high' })).toEqual(['cursor-agent'])
  })
  it('passes nothing when resuming, or for a value that is no level', () => {
    for (const kind of ['claude', 'codex', 'pi', 'grok'] as const) {
      expect(agentArgv(kind, '/r', { effort: 'high', resumeAgentSessionId: 'abc' })).toEqual(agentArgv(kind, '/r', { resumeAgentSessionId: 'abc' }))
      expect(agentArgv(kind, '/r', { effort: 'high" -c x="1' })).toEqual(agentArgv(kind, '/r'))
    }
  })
})
