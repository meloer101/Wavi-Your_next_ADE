// The image preview's view math (PRD F23 v1.243, Figma 112G / 112H): pure, so the zoom around the cursor, the fit and
// the pan limits are tested without a DOM. The picture sits at the stage's centre moved by `offset`, drawn at `scale`
// times its own size.

export interface Size {
  w: number
  h: number
}

export interface Offset {
  x: number
  y: number
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 16
/** One step of ⌘+ / ⌘− and the buttons. */
export const ZOOM_STEP = 1.25

/** The scale that shows the whole picture in the stage, never above 100%. */
export function fitScale(image: Size, stage: Size): number {
  if (image.w <= 0 || image.h <= 0 || stage.w <= 0 || stage.h <= 0) return 1
  return Math.min(1, stage.w / image.w, stage.h / image.h)
}

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * The offset after scaling from `from` to `to` with the point `at` (from the stage's centre) staying under the cursor:
 * the picture point under it is (at − offset) / from, and must be at `at` again.
 */
export function zoomOffset(offset: Offset, from: number, to: number, at: Offset): Offset {
  const k = to / from
  return { x: at.x - (at.x - offset.x) * k, y: at.y - (at.y - offset.y) * k }
}

/** Keeps the picture from leaving the stage: a picture smaller than the stage on an axis is centred on it, a larger one stops at its edges. */
export function clampOffset(offset: Offset, image: Size, scale: number, stage: Size): Offset {
  const limit = (shown: number, room: number): number => Math.max(0, (shown - room) / 2)
  const x = limit(image.w * scale, stage.w)
  const y = limit(image.h * scale, stage.h)
  return { x: Math.min(x, Math.max(-x, offset.x)), y: Math.min(y, Math.max(-y, offset.y)) }
}

/** Whether the picture is larger than the stage on an axis (it can be dragged). */
export const canPan = (image: Size, scale: number, stage: Size): boolean => image.w * scale > stage.w + 0.5 || image.h * scale > stage.h + 0.5

/** The ratio as the bar writes it: the actual value in whole percent. */
export const ratioLabel = (scale: number): string => `${Math.round(scale * 100)}%`
