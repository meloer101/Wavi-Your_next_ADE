import { describe, expect, it, vi } from 'vitest'
import { setLeaderFor } from './leader-action'

const flow = (enabled: boolean | Error) => ({
  leaderEnabled: vi.fn(async () => {
    if (enabled instanceof Error) throw enabled
    return enabled
  }),
  openSheet: vi.fn(),
  openSettings: vi.fn()
})

describe('setLeaderFor', () => {
  it('opens the new-session panel as a leader for the project while 「leader 会话」 is on', async () => {
    const f = flow(true)
    expect(await setLeaderFor('p1', f)).toBe('sheet')
    expect(f.openSheet).toHaveBeenCalledWith('p1', { leader: true })
    expect(f.openSettings).not.toHaveBeenCalled()
  })

  it('opens the settings at the item when it is off', async () => {
    const f = flow(false)
    expect(await setLeaderFor('p1', f)).toBe('settings')
    expect(f.openSettings).toHaveBeenCalledOnce()
    expect(f.openSheet).not.toHaveBeenCalled()
  })

  it('treats an unreadable setting as off', async () => {
    const f = flow(new Error('no settings'))
    expect(await setLeaderFor('p1', f)).toBe('settings')
  })
})
