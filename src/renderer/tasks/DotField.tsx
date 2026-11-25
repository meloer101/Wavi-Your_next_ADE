// The board's dot grid (PRD F9 v1.249 · Figma 115A4): one <canvas> behind the cards, 10 px apart in world space so it
// pans and zooms with the board, black or white only (the text colour), a small glow where the pointer is.
//
// It draws only when something changed: the viewport moved, or the glow is still easing. At rest no frame is asked for,
// so an open board costs no CPU. The glow's maths and its transitions are in dot-field.ts.
import { useEffect, useRef } from 'react'
import { GLOW, RIPPLE, dotLight, dotSize, glowBox, gridStep, lightBucket, newGlow, rippleAlive, rippleIntensity, stepGlow, type PointerInput, type Ripple } from './dot-field'
import { scaleFor, visibleWorld, type Size, type View } from './layout'
import styles from './DotField.module.css'

const LEVELS = 8
/** Frames between two updates of the measurements on the canvas (data-frame-ms / data-fps). */
const REPORT_EVERY = 60

/** "rgb(237, 237, 237)" / "rgba(…)" / "#rrggbb" from a computed style → [r, g, b]. */
function rgbOf(color: string): [number, number, number] {
  const hex = /^\s*#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color)
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)]
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [237, 237, 237]
}

/** A ripple the board asks for; `id` counts up, so one is started once. */
export interface RippleEvent extends Omit<Ripple, 'born'> {
  id: number
}

export function DotField({ view, size, ripples }: { view: View; size: Size; ripples: readonly RippleEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ view, size })
  const wake = useRef<() => void>(() => undefined)
  const asked = useRef<(events: readonly RippleEvent[]) => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const glow = newGlow()
    const pointer: PointerInput = { active: false, x: 0, y: 0 }
    let rgb = rgbOf(getComputedStyle(canvas).color)
    let attention = rgbOf(getComputedStyle(canvas).getPropertyValue('--status-attention'))
    const rings: Ripple[] = []
    let ringsSeen = 0
    let raf = 0
    let last = 0
    let frames = 0
    let work = 0
    let windowStart = 0
    // Room for the dots one bucket draws, reused every frame: the glow is at most ~110 px wide.
    const bucketX = Array.from({ length: LEVELS }, () => new Float32Array(2048))
    const bucketY = Array.from({ length: LEVELS }, () => new Float32Array(2048))
    const counts = new Int32Array(LEVELS)

    const rgba = (a: number, c: readonly number[] = rgb): string => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`

    const draw = (now: number): void => {
      const { view: v, size: sz } = latest.current
      const dpr = window.devicePixelRatio || 1
      const px = Math.round(sz.w * dpr)
      const py = Math.round(sz.h * dpr)
      if (canvas.width !== px || canvas.height !== py) {
        canvas.width = px
        canvas.height = py
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, sz.w, sz.h)
      const s = scaleFor(v.zoom)
      const step = gridStep(s)
      const d = dotSize(s)
      const world = visibleWorld(v, sz)
      const ix0 = Math.floor(world.x / step)
      const ix1 = Math.ceil((world.x + world.w) / step)
      const iy0 = Math.floor(world.y / step)
      const iy1 = Math.ceil((world.y + world.h) / step)

      // The dots at rest: one path, one fill.
      ctx.fillStyle = rgba(GLOW.base)
      ctx.beginPath()
      for (let iy = iy0; iy <= iy1; iy++) {
        const y = iy * step * s + v.y - d / 2
        for (let ix = ix0; ix <= ix1; ix++) ctx.rect(ix * step * s + v.x - d / 2, y, d, d)
      }
      ctx.fill()

      drawRipples(now, s, step, v, ix0, ix1, iy0, iy1, d)

      // The lit ones, by brightness bucket: only the dots near the glow and its trail are looked at.
      const box = glowBox(glow)
      if (!box) return
      counts.fill(0)
      const jx0 = Math.max(ix0, Math.floor((box.x1 - v.x) / (step * s)))
      const jx1 = Math.min(ix1, Math.ceil((box.x2 - v.x) / (step * s)))
      const jy0 = Math.max(iy0, Math.floor((box.y1 - v.y) / (step * s)))
      const jy1 = Math.min(iy1, Math.ceil((box.y2 - v.y) / (step * s)))
      for (let iy = jy0; iy <= jy1; iy++) {
        const y = iy * step * s + v.y
        for (let ix = jx0; ix <= jx1; ix++) {
          const x = ix * step * s + v.x
          const b = lightBucket(dotLight(glow, x, y, now), LEVELS)
          if (b === 0) continue
          const n = counts[b - 1]!
          if (n >= 2048) continue
          bucketX[b - 1]![n] = x - d / 2
          bucketY[b - 1]![n] = y - d / 2
          counts[b - 1] = n + 1
        }
      }
      for (let b = 0; b < LEVELS; b++) {
        const n = counts[b]!
        if (n === 0) continue
        ctx.fillStyle = rgba((GLOW.peak * (b + 1)) / LEVELS)
        ctx.beginPath()
        for (let i = 0; i < n; i++) ctx.rect(bucketX[b]![i]!, bucketY[b]![i]!, d, d)
        ctx.fill()
      }
    }

    // Each ring lights the dots near its edge, in its own colour: a ring is ~50 px wide, so a few hundred dots at most.
    const drawRipples = (now: number, s: number, step: number, v: View, ix0: number, ix1: number, iy0: number, iy1: number, d: number): void => {
      for (const ring of rings) {
        if (!rippleAlive(ring, now)) continue
        const age = now - ring.born
        const cx = ring.x * s + v.x
        const cy = ring.y * s + v.y
        const reach = RIPPLE.radius + RIPPLE.width * 2
        const jx0 = Math.max(ix0, Math.floor((cx - reach - v.x) / (step * s)))
        const jx1 = Math.min(ix1, Math.ceil((cx + reach - v.x) / (step * s)))
        const jy0 = Math.max(iy0, Math.floor((cy - reach - v.y) / (step * s)))
        const jy1 = Math.min(iy1, Math.ceil((cy + reach - v.y) / (step * s)))
        counts.fill(0)
        for (let iy = jy0; iy <= jy1; iy++) {
          const y = iy * step * s + v.y
          for (let ix = jx0; ix <= jx1; ix++) {
            const x = ix * step * s + v.x
            const b = lightBucket(rippleIntensity(Math.hypot(x - cx, y - cy), age), LEVELS, RIPPLE.peak)
            if (b === 0) continue
            const n = counts[b - 1]!
            if (n >= 2048) continue
            bucketX[b - 1]![n] = x - d / 2
            bucketY[b - 1]![n] = y - d / 2
            counts[b - 1] = n + 1
          }
        }
        const color = ring.tone === 'attention' ? attention : rgb
        for (let b = 0; b < LEVELS; b++) {
          const n = counts[b]!
          if (n === 0) continue
          ctx.fillStyle = rgba((RIPPLE.peak * (b + 1)) / LEVELS, color)
          ctx.beginPath()
          for (let i = 0; i < n; i++) ctx.rect(bucketX[b]![i]!, bucketY[b]![i]!, d, d)
          ctx.fill()
        }
      }
    }

    const frame = (t: number): void => {
      raf = 0
      const dt = last === 0 ? 1000 / 60 : Math.min(64, t - last)
      last = t
      const started = performance.now()
      let moving = stepGlow(glow, pointer, t, dt, reducedQuery.matches)
      for (let i = rings.length - 1; i >= 0; i--) if (!rippleAlive(rings[i]!, t)) rings.splice(i, 1)
      if (rings.length > 0) moving = true
      draw(t)
      canvas.dataset.ripples = String(rings.length)
      work += performance.now() - started
      frames++
      if (frames === 1) windowStart = t
      if (frames % REPORT_EVERY === 0) {
        // Dev measurement: the time one frame's work took, and the rate while it kept running.
        canvas.dataset.frameMs = (work / REPORT_EVERY).toFixed(2)
        canvas.dataset.fps = ((REPORT_EVERY * 1000) / Math.max(1, t - windowStart)).toFixed(1)
        work = 0
        windowStart = t
      }
      if (moving) raf = requestAnimationFrame(frame)
      else {
        last = 0
        frames = 0
      }
    }
    const request = (): void => {
      if (raf === 0) raf = requestAnimationFrame(frame)
    }
    wake.current = request
    // A ripple starts once, for an event it has not seen; the system's reduced motion has none.
    asked.current = (events) => {
      for (const e of events) {
        if (e.id <= ringsSeen) continue
        ringsSeen = e.id
        if (reducedQuery.matches) continue
        rings.push({ x: e.x, y: e.y, tone: e.tone, born: performance.now() })
      }
      if (rings.length > 8) rings.splice(0, rings.length - 8)
      canvas.dataset.ripples = String(rings.length)
      request()
    }

    const onMove = (e: PointerEvent): void => {
      const rect = host.getBoundingClientRect()
      pointer.active = true
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      request()
    }
    const onLeave = (): void => {
      pointer.active = false
      request()
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    // A theme change turns the dots black or white: read the colour again.
    const themeWatch = new MutationObserver(() => {
      rgb = rgbOf(getComputedStyle(canvas).color)
      attention = rgbOf(getComputedStyle(canvas).getPropertyValue('--status-attention'))
      request()
    })
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-material', 'class'] })
    request()
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      themeWatch.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
      wake.current = () => undefined
      asked.current = () => undefined
    }
  }, [])

  // The frame draws what these effects hand it: the newest view and size, then a frame is asked for.
  useEffect(() => {
    latest.current = { view, size }
    wake.current()
  }, [view, size])

  // Ripples the board asks for; the first render's are not news (the board starts them only on events).
  useEffect(() => asked.current(ripples), [ripples])

  return <canvas ref={canvasRef} className={styles.field} style={{ width: size.w, height: size.h }} aria-hidden />
}
