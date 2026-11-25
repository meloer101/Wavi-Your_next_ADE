import { describe, expect, it } from 'vitest'
import { canPan, clampOffset, clampScale, fitScale, MAX_SCALE, MIN_SCALE, ratioLabel, zoomOffset } from './image-zoom'

describe('image view math', () => {
  it('fits the whole picture in the stage and never scales it up past 100%', () => {
    expect(fitScale({ w: 2000, h: 1000 }, { w: 1000, h: 800 })).toBe(0.5)
    expect(fitScale({ w: 1000, h: 3000 }, { w: 1000, h: 750 })).toBe(0.25)
    expect(fitScale({ w: 200, h: 100 }, { w: 1000, h: 800 })).toBe(1)
    expect(fitScale({ w: 0, h: 0 }, { w: 1000, h: 800 })).toBe(1)
  })

  it('keeps the point under the cursor fixed when it zooms', () => {
    const at = { x: 100, y: -50 }
    const offset = { x: 30, y: 10 }
    const next = zoomOffset(offset, 0.5, 1, at)
    // The picture point under the cursor before and after.
    const before = { x: (at.x - offset.x) / 0.5, y: (at.y - offset.y) / 0.5 }
    const after = { x: (at.x - next.x) / 1, y: (at.y - next.y) / 1 }
    expect(after).toEqual(before)
    // From the centre the offset only scales.
    expect(zoomOffset({ x: 40, y: -20 }, 1, 2, { x: 0, y: 0 })).toEqual({ x: 80, y: -40 })
  })

  it('stops a larger picture at the stage’s edges and centres a smaller one', () => {
    const stage = { w: 1000, h: 600 }
    expect(clampOffset({ x: 900, y: 900 }, { w: 2000, h: 1000 }, 1, stage)).toEqual({ x: 500, y: 200 })
    expect(clampOffset({ x: -900, y: 0 }, { w: 2000, h: 1000 }, 1, stage)).toEqual({ x: -500, y: 0 })
    expect(clampOffset({ x: 80, y: 80 }, { w: 400, h: 300 }, 1, stage)).toEqual({ x: 0, y: 0 })
  })

  it('pans only a picture larger than the stage, and bounds the scale', () => {
    const stage = { w: 1000, h: 600 }
    expect(canPan({ w: 2000, h: 500 }, 1, stage)).toBe(true)
    expect(canPan({ w: 2000, h: 500 }, 0.5, stage)).toBe(false)
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(ratioLabel(0.624)).toBe('62%')
    expect(ratioLabel(2)).toBe('200%')
  })
})
