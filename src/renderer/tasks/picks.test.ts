import { describe, expect, it } from 'vitest'
import { effortsOf, leaderAgents, modelsFor, parseLeaderPicks, usedPick } from './picks'

describe('leader picks', () => {
  it('lists the installed agents first, then the others, both in CLI_AGENTS order', () => {
    const { installed, missing } = leaderAgents({ claude: true, pi: true, codex: true })
    expect(installed).toEqual(['claude', 'codex', 'pi'])
    expect(missing[0]).toBe('opencode')
    expect(missing).toHaveLength(16)
  })
  it('offers models only to a CLI with a model flag, without its own "default" entry or ids no command line takes', () => {
    const probed = [{ value: 'default', label: 'Default' }, { value: 'opus', label: 'Opus' }, { value: 'bad id', label: 'x' }]
    expect(modelsFor('claude', probed)).toEqual([{ value: 'opus', label: 'Opus' }])
    expect(modelsFor('droid', probed)).toEqual([])
    expect(modelsFor('claude', undefined)).toEqual([])
  })
  it('offers effort levels per agent, none where there is no flag', () => {
    expect(effortsOf('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(effortsOf('codex')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(effortsOf('pi')).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(effortsOf('grok')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(effortsOf('cursor')).toEqual([])
  })
  it('passes a remembered value only while it is offered', () => {
    expect(usedPick('high', ['low', 'high'])).toBe('high')
    expect(usedPick('max', ['low'])).toBeUndefined()
    expect(usedPick(undefined, ['low'])).toBeUndefined()
  })
  it('reads back only what fits', () => {
    expect(parseLeaderPicks({ models: { claude: 'opus', nobody: 'x', codex: 'a b' }, efforts: { claude: 'high', codex: 'max', cursor: 'low' } })).toEqual({
      models: { claude: 'opus' },
      efforts: { claude: 'high' }
    })
    expect(parseLeaderPicks(null)).toEqual({ models: {}, efforts: {} })
  })
})
