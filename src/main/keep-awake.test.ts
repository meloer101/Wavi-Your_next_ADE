import { describe, expect, it } from 'vitest'
import { createKeepAwake } from './keep-awake'

function fake() {
  const calls: string[] = []
  let next = 0
  return {
    calls,
    api: {
      start: () => {
        calls.push('start')
        return ++next
      },
      stop: (id: number) => calls.push(`stop ${id}`)
    }
  }
}

describe('createKeepAwake', () => {
  it('starts once however often it is turned on', () => {
    const { api, calls } = fake()
    const k = createKeepAwake(api)
    k.set(true)
    k.set(true)
    expect(calls).toEqual(['start'])
  })

  it('goes on → off → on with the right ids', () => {
    const { api, calls } = fake()
    const k = createKeepAwake(api)
    k.set(true)
    k.set(false)
    k.set(false)
    k.set(true)
    expect(calls).toEqual(['start', 'stop 1', 'start'])
  })

  it('does nothing when turned off without a blocker', () => {
    const { api, calls } = fake()
    createKeepAwake(api).set(false)
    expect(calls).toEqual([])
  })
})
