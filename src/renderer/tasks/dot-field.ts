// The dot grid's hover glow (PRD F9 v1.246 · Figma 115A4): the maths, apart from the canvas that draws it.
//
// The author's complaint was that the glow had no transition (「鼠标交互不是很有过渡」). So nothing here switches: the glow's
// strength moves toward 0 or 1 by exponential smoothing every frame (in ≈ 120 ms, out ≈ 400 ms), its centre follows
// the pointer by the same smoothing, and the short trail is a few past positions that fade over ≈ 400 ms.

export const GLOW = {
  /** Screen px from the glow's centre to where it ends. */
  radius: 55,
  /** Opacity added to a dot at the centre at full strength. */
  peak: 0.55,
  trailRadius: 36,
  trailPeak: 0.3,
  /** Opacity of a dot nothing lights. */
  base: 0.1
} as const

/** Time for a change to be 95 % done. */
export const TIMING = { inMs: 120, outMs: 400, trailMs: 400, followMs: 100 } as const
/** `prefers-reduced-motion`: the glow sits at the pointer and nothing eases for longer than this. */
export const REDUCED_MS = 80

const TRAIL_MAX = 10
/** A trail point is left once the glow has moved this far (px). */
const TRAIL_STEP = 7
const REST = 0.003

/** How much a dot `distance` px from a glow centre is lit: 0 at and beyond the radius, `peak × strength` at the centre. */
export function glowIntensity(distance: number, strength: number, radius: number = GLOW.radius, peak: number = GLOW.peak): number {
  if (distance >= radius || strength <= 0) return 0
  const t = 1 - distance / radius
  return peak * strength * t * t
}

/** One frame of exponential smoothing: `settleMs` is when the value is 95 % of the way (e^-3) to `target`. */
export function easeTo(current: number, target: number, dtMs: number, settleMs: number): number {
  if (settleMs <= 0) return target
  return target + (current - target) * Math.exp((-3 * dtMs) / settleMs)
}

export interface TrailPoint {
  x: number
  y: number
  born: number
}

export interface GlowState {
  /** 0–1: how much of the glow is shown. */
  strength: number
  x: number
  y: number
  /** Whether `x` / `y` were ever set: the first touch starts at the pointer instead of sliding in from the corner. */
  placed: boolean
  trail: TrailPoint[]
}

export interface PointerInput {
  /** The pointer is over the board. */
  active: boolean
  x: number
  y: number
}

export const newGlow = (): GlowState => ({ strength: 0, x: 0, y: 0, placed: false, trail: [] })

/**
 * Advances the glow by one frame (`dtMs` since the last, `now` for the trail's age). Returns whether it still moves:
 * the caller stops asking for frames when it does not.
 */
export function stepGlow(state: GlowState, input: PointerInput, now: number, dtMs: number, reduced: boolean): boolean {
  const target = input.active ? 1 : 0
  const settle = reduced ? REDUCED_MS : target > state.strength ? TIMING.inMs : TIMING.outMs
  state.strength = easeTo(state.strength, target, dtMs, settle)
  if (state.strength < REST && target === 0) state.strength = 0

  if (input.active) {
    if (!state.placed || reduced || state.strength < REST) {
      state.x = input.x
      state.y = input.y
      state.placed = true
    } else {
      state.x = easeTo(state.x, input.x, dtMs, TIMING.followMs)
      state.y = easeTo(state.y, input.y, dtMs, TIMING.followMs)
    }
    if (!reduced) {
      const last = state.trail[state.trail.length - 1]
      if (!last || Math.hypot(state.x - last.x, state.y - last.y) >= TRAIL_STEP) {
        state.trail.push({ x: state.x, y: state.y, born: now })
        if (state.trail.length > TRAIL_MAX) state.trail.shift()
      }
    }
  }
  while (state.trail.length > 0 && now - state.trail[0]!.born >= TIMING.trailMs) state.trail.shift()
  if (reduced) state.trail.length = 0

  const settling = input.active ? Math.hypot(state.x - input.x, state.y - input.y) > 0.5 || state.strength < 1 - REST : state.strength > 0
  return settling || state.trail.length > 0
}

/** The opacity a glow state adds to a dot at (x, y): the brightest of the glow and the points of its trail. */
export function dotLight(state: GlowState, x: number, y: number, now: number): number {
  let light = glowIntensity(Math.hypot(x - state.x, y - state.y), state.strength)
  for (const p of state.trail) {
    const age = 1 - (now - p.born) / TIMING.trailMs
    if (age > 0) light = Math.max(light, glowIntensity(Math.hypot(x - p.x, y - p.y), age, GLOW.trailRadius, GLOW.trailPeak))
  }
  return light
}

/** The box the glow and its trail can light, for visiting only the dots near it. Null when nothing is lit. */
export function glowBox(state: GlowState): { x1: number; y1: number; x2: number; y2: number } | null {
  const centres: Array<{ x: number; y: number; r: number }> = state.trail.map((p) => ({ x: p.x, y: p.y, r: GLOW.trailRadius }))
  if (state.strength > 0) centres.push({ x: state.x, y: state.y, r: GLOW.radius })
  if (centres.length === 0) return null
  return {
    x1: Math.min(...centres.map((c) => c.x - c.r)),
    y1: Math.min(...centres.map((c) => c.y - c.r)),
    x2: Math.max(...centres.map((c) => c.x + c.r)),
    y2: Math.max(...centres.map((c) => c.y + c.r))
  }
}

// ── The grid ──────────────────────────────────────────────────────────────────

export const GRID = 10
/** Dots closer than this on screen are thinned out (a multiple of the grid), so zoomed far out it stays drawable. */
const MIN_SCREEN_GAP = 6

/** World distance between drawn dots at `scale` (screen px per world unit): the grid, doubled until dots are apart. */
export function gridStep(scale: number): number {
  let step = GRID
  while (step * scale < MIN_SCREEN_GAP) step *= 2
  return step
}

/** On-screen dot size: 1.3 world units, held between 1 and 2 px. */
export const dotSize = (scale: number): number => Math.min(2, Math.max(1, 1.3 * scale))

/** Which of `levels` brightness buckets (1…levels) a light value falls in; 0 = not lit enough to bother. */
export function lightBucket(light: number, levels: number): number {
  if (light < 0.02) return 0
  return Math.min(levels, Math.ceil((light / GLOW.peak) * levels))
}
