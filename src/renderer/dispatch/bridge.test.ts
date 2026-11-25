import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { noteInput } from '../terminal/typing'
import { startDispatchBridge } from './bridge'
import { setTell, setWoken, useDispatch } from './store'

vi.mock('./handler', () => ({ handleWaviRequest: async () => ({ ok: true, text: '' }), resumeConfirmTimers: () => {}, setDispatchSettings: () => {} }))
vi.mock('./reports', () => ({ resumeReports: () => {}, startReports: () => () => {} }))
vi.mock('./task-deliver', () => ({ startTaskDelivery: () => () => {} }))
vi.mock('../attempts/report', () => ({ startAttemptReports: () => () => {} }))
const workspace = vi.hoisted(() => ({ store: null as null | { setState: (s: { leaderSessions: Record<string, string> }) => void } }))
vi.mock('../state/workspace', async () => {
  const { create } = await import('zustand')
  const useWorkspace = create<{ leaderSessions?: Record<string, string> }>()(() => ({}))
  workspace.store = useWorkspace
  return { useWorkspace }
})
vi.mock('../state/persistence', () => ({ addSnapshotPart: () => () => {}, initialWorkspaceFile: () => null, requestSave: () => {} }))

describe('a leader’s wavi tell (PRD F21 v1.198 · 交给用户)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stays until the user sends a line in the leader’s terminal, not another one’s', () => {
    vi.stubGlobal('window', {
      tr: {
        settings: { get: async () => DEFAULT_SETTINGS, onChange: () => () => {} },
        dispatch: { onRequest: () => () => {}, reply: () => {} }
      }
    })
    const stop = startDispatchBridge()
    try {
      setTell('lead', 'Merge A or B first?')
      noteInput('other', 'hello\r')
      noteInput('lead', '\r')
      expect(useDispatch.getState().tells.lead).toBe('Merge A or B first?')
      noteInput('lead', 'A first\r')
      expect(useDispatch.getState().tells.lead).toBeUndefined()
    } finally {
      stop()
    }
  })
})

describe('a leader that is closed or no longer the leader (PRD F21 v1.198)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('leaves no tell or wake time behind, and the other leaders keep theirs', () => {
    vi.stubGlobal('window', {
      tr: {
        settings: { get: async () => DEFAULT_SETTINGS, onChange: () => () => {} },
        dispatch: { onRequest: () => () => {}, reply: () => {} }
      }
    })
    const stop = startDispatchBridge()
    try {
      workspace.store!.setState({ leaderSessions: { p1: 'lead', p2: 'other' } })
      setTell('lead', 'Merge A or B first?')
      setWoken('lead', 5)
      setTell('other', 'Ship it?')
      setWoken('other', 7)
      workspace.store!.setState({ leaderSessions: { p2: 'other' } })
      const { tells, woken } = useDispatch.getState()
      expect('lead' in tells || 'lead' in woken).toBe(false)
      expect(tells.other).toBe('Ship it?')
      expect(woken.other).toBe(7)
    } finally {
      stop()
    }
  })
})
