import { describe, expect, it } from 'vitest'
import { GLOW, REDUCED_MS, TIMING, dotLight, dotSize, easeTo, glowBox, glowIntensity, gridStep, lightBucket, newGlow, stepGlow, type GlowState } from './dot-field'

const FRAME = 1000 / 60

/** Runs frames of 16.7 ms for `ms` and returns the state. */
function run(state: GlowState, input: { active: boolean; x: number; y: number }, ms: number, reduced = false, from = 0): { state: GlowState; now: number } {
  let now = from
  for (let t = 0; t < ms; t += FRAME) {
    now += FRAME
    stepGlow(state, input, now, FRAME, reduced)
  }
  return { state, now }
}

describe('glowIntensity', () => {
  it('is peak × strength at the centre', () => {
    expect(glowIntensity(0, 1)).toBeCloseTo(GLOW.peak)
    expect(glowIntensity(0, 0.5)).toBeCloseTo(GLOW.peak / 2)
  })

  it('falls to 0 at the radius and stays 0 beyond it', () => {
    expect(glowIntensity(GLOW.radius, 1)).toBe(0)
    expect(glowIntensity(GLOW.radius + 40, 1)).toBe(0)
  })

  it('never rises with distance', () => {
    let last = Infinity
    for (let d = 0; d <= GLOW.radius; d += 5) {
      const v = glowIntensity(d, 1)
      expect(v).toBeLessThanOrEqual(last)
      last = v
    }
  })

  it('is 0 when the glow is off', () => {
    expect(glowIntensity(0, 0)).toBe(0)
  })
})

describe('easeTo', () => {
  it('is 95 % of the way after the settle time', () => {
    expect(easeTo(0, 1, 120, 120)).toBeCloseTo(0.95, 2)
    expect(easeTo(1, 0, 400, 400)).toBeCloseTo(0.05, 2)
  })

  it('does not jump: one frame covers only part of the way', () => {
    expect(easeTo(0, 1, FRAME, TIMING.inMs)).toBeLessThan(0.5)
    expect(easeTo(1, 0, FRAME, TIMING.outMs)).toBeGreaterThan(0.85)
  })

  it('takes the same path however the time is cut into frames', () => {
    const once = easeTo(0, 1, 100, 200)
    const twice = easeTo(easeTo(0, 1, 50, 200), 1, 50, 200)
    expect(twice).toBeCloseTo(once, 6)
  })
})

describe('stepGlow', () => {
  it('eases in over about 120 ms and not instantly', () => {
    const state = newGlow()
    const after1 = run(state, { active: true, x: 100, y: 100 }, FRAME)
    expect(after1.state.strength).toBeGreaterThan(0)
    expect(after1.state.strength).toBeLessThan(0.5)
    const full = run(newGlow(), { active: true, x: 100, y: 100 }, 130)
    expect(full.state.strength).toBeGreaterThan(0.94)
  })

  it('eases out over about 400 ms: still lit after 100 ms, gone after 450 ms', () => {
    const lit = run(newGlow(), { active: true, x: 100, y: 100 }, 200)
    const leaving = { active: false, x: 100, y: 100 }
    const soon = run(lit.state, leaving, 100, false, lit.now)
    expect(soon.state.strength).toBeGreaterThan(0.4)
    const later = run(soon.state, leaving, 350, false, soon.now)
    expect(later.state.strength).toBeLessThan(0.05)
  })

  it('starts at the pointer, then follows it with a lag instead of jumping', () => {
    const { state, now } = run(newGlow(), { active: true, x: 100, y: 100 }, 200)
    expect(state.x).toBeCloseTo(100, 0)
    stepGlow(state, { active: true, x: 300, y: 100 }, now + FRAME, FRAME, false)
    expect(state.x).toBeGreaterThan(100)
    expect(state.x).toBeLessThan(300)
  })

  it('leaves a short trail that is gone about 400 ms after the pointer stops', () => {
    let now = 0
    const state = newGlow()
    for (let i = 0; i < 30; i++) {
      now += FRAME
      stepGlow(state, { active: true, x: 100 + i * 12, y: 100 }, now, FRAME, false)
    }
    expect(state.trail.length).toBeGreaterThan(2)
    expect(state.trail.length).toBeLessThanOrEqual(10)
    const gone = run(state, { active: false, x: 0, y: 0 }, TIMING.trailMs + 50, false, now)
    expect(gone.state.trail).toHaveLength(0)
  })

  it('reports that it still moves, and that it came to rest', () => {
    const state = newGlow()
    let now = 0
    let moving = true
    for (let i = 0; i < 400 && moving; i++) {
      now += FRAME
      moving = stepGlow(state, { active: true, x: 50, y: 50 }, now, FRAME, false)
    }
    expect(moving).toBe(false)
    const leaving = { active: false, x: 50, y: 50 }
    for (let i = 0; i < 400 && !moving; i++) {
      now += FRAME
      moving = stepGlow(state, leaving, now, FRAME, false)
    }
    // Now it runs out: after the fade the last call says there is nothing left to draw.
    for (let i = 0; i < 400 && moving; i++) {
      now += FRAME
      moving = stepGlow(state, leaving, now, FRAME, false)
    }
    expect(moving).toBe(false)
    expect(state.strength).toBe(0)
  })

  describe('reduced motion', () => {
    it('lights at the pointer with no trail', () => {
      const { state } = run(newGlow(), { active: true, x: 10, y: 10 }, 400, true)
      expect(state.trail).toHaveLength(0)
      const moved = { active: true, x: 200, y: 90 }
      stepGlow(state, moved, 1000, FRAME, true)
      expect(state.x).toBe(200)
      expect(state.y).toBe(90)
    })

    it('eases for no longer than 80 ms either way', () => {
      expect(REDUCED_MS).toBeLessThanOrEqual(80)
      const lit = run(newGlow(), { active: true, x: 0, y: 0 }, REDUCED_MS + 10, true)
      expect(lit.state.strength).toBeGreaterThan(0.94)
      const off = run(lit.state, { active: false, x: 0, y: 0 }, REDUCED_MS + 10, true, lit.now)
      expect(off.state.strength).toBeLessThan(0.06)
    })
  })
})

describe('dotLight', () => {
  it('lights dots near the glow and not far ones', () => {
    const { state, now } = run(newGlow(), { active: true, x: 100, y: 100 }, 300)
    expect(dotLight(state, 100, 100, now)).toBeGreaterThan(0.5)
    expect(dotLight(state, 100 + GLOW.radius + 5, 100, now)).toBe(0)
  })

  it('lights a dot on the trail after the glow left', () => {
    let now = 0
    const state = newGlow()
    for (let i = 0; i < 20; i++) {
      now += FRAME
      stepGlow(state, { active: true, x: 100 + i * 10, y: 100 }, now, FRAME, false)
    }
    state.strength = 0
    const last = state.trail[state.trail.length - 1]!
    expect(dotLight(state, last.x, last.y, now)).toBeGreaterThan(0)
  })
})

describe('glowBox', () => {
  it('is null when nothing is lit and covers the glow otherwise', () => {
    expect(glowBox(newGlow())).toBeNull()
    const { state } = run(newGlow(), { active: true, x: 200, y: 150 }, 300)
    expect(glowBox(state)).toMatchObject({ x1: 200 - GLOW.radius, y1: 150 - GLOW.radius, x2: 200 + GLOW.radius, y2: 150 + GLOW.radius })
  })
})

describe('grid', () => {
  it('keeps the 10 px grid at 100 % and thins it when zoomed far out', () => {
    expect(gridStep(1)).toBe(10)
    expect(gridStep(0.5)).toBe(20)
    expect(gridStep(0.25)).toBe(40)
  })

  it('holds the dot between 1 and 2 px on screen', () => {
    expect(dotSize(1)).toBeCloseTo(1.3)
    expect(dotSize(0.25)).toBe(1)
    expect(dotSize(4)).toBe(2)
  })

  it('buckets the light and ignores almost-dark dots', () => {
    expect(lightBucket(0.01, 8)).toBe(0)
    expect(lightBucket(GLOW.peak, 8)).toBe(8)
    expect(lightBucket(0.3, 8)).toBeGreaterThan(0)
    expect(lightBucket(0.3, 8)).toBeLessThan(8)
  })
})
