// The image preview (PRD F23 v1.243, Figma 112G / 112H): a layer over the whole window that shows one picture of the
// session at a time — yours, a tool's, an agent's, one its Markdown wrote — fitted to the stage, zoomed around the
// cursor, dragged when larger than it. ← → go through every picture of the session; ⎋ closes the layer and goes no
// further (the chat's own ⎋, which interrupts the agent, never sees it). The view math is image-zoom.ts.
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { defineMessages } from '@shared/i18n'
import type { ImageZoomAction } from '@shared/ipc'
import { Check, ChevronLeft, ChevronRight, Copy, FolderOpen, Minus, Plus, X } from '../ui/icons'
import { useMessages } from '../ui/i18n'
import { canPan, clampOffset, clampScale, fitScale, ratioLabel, zoomOffset, ZOOM_STEP, type Offset, type Size } from './image-zoom'
import { thumbnailUrl, type GalleryImage } from './model'
import styles from './ImagePreview.module.css'

const M = defineMessages({
  zh: {
    preview: '图片预览',
    zoomOut: '缩小',
    zoomIn: '放大',
    fit: '适应窗口',
    reveal: '在 Finder 中显示',
    copy: '复制图片',
    copied: '已复制',
    close: '关闭',
    previous: '上一张',
    next: '下一张',
    ratio: '缩放比例',
    position: (n: number, total: number) => `第 ${n} 张，共 ${total} 张`
  },
  en: {
    preview: 'Image preview',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    fit: 'Fit to window',
    reveal: 'Show in Finder',
    copy: 'Copy image',
    copied: 'Copied',
    close: 'Close',
    previous: 'Previous image',
    next: 'Next image',
    ratio: 'Zoom',
    position: (n: number, total: number) => `Image ${n} of ${total}`
  }
})

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const COPIED_MS = 1200
/** How long after the last wheel event a move still follows the cursor with no transition. */
const LIVE_MS = 160
/** Two scales or offsets closer than this are the same (the fit button is greyed, a double click knows where it is). */
const EPSILON = 0.001

/** Opens the preview at the picture drawn under `key` (null outside a session's feed: a thumbnail is then not a button). */
type OpenImage = (key: string) => void
const ImageGallery = createContext<OpenImage | null>(null)
export const useOpenImage = (): OpenImage | null => useContext(ImageGallery)

/** The `data-gallery-key` a thumbnail carries, so closing the preview can give the focus back to it. */
export const GALLERY_KEY_ATTRIBUTE = 'data-gallery-key'

/** Around a session's feed: its thumbnails open the preview, which lists `images`. */
export function ImageGalleryProvider({ images, children }: { images: readonly GalleryImage[]; children: ReactNode }) {
  const [opened, setOpened] = useState<string | null>(null)
  const close = useCallback(() => setOpened(null), [])
  return (
    <ImageGallery.Provider value={setOpened}>
      {children}
      {opened !== null && <ImagePreview images={images} startKey={opened} onClose={close} />}
    </ImageGallery.Provider>
  )
}

const sizeOf = (el: HTMLElement): Size => ({ w: el.clientWidth, h: el.clientHeight })

function ImagePreview({ images, startKey, onClose }: { images: readonly GalleryImage[]; startKey: string; onClose(): void }) {
  const m = useMessages(M)
  const [key, setKey] = useState(startKey)
  // The picture is found by its key; one that is gone (a rewind took it) closes the layer, never shows another.
  const index = images.findIndex((image) => image.key === key)
  const image = images[index]
  const [failed, setFailed] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  // `zoom` null: fitted to the stage, however it is resized.
  const [zoom, setZoom] = useState<number | null>(null)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [following, setFollowing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null)
  // The press began on the picture: a click that ends a drag is reported on the stage (pointer capture) but is not one on the empty stage.
  const pressedPicture = useRef(false)
  const followTimer = useRef<number | undefined>(undefined)

  // Nothing to show (a rewind took the picture away): the layer closes.
  useEffect(() => {
    if (!image) onClose()
  }, [image, onClose])

  const fit = natural ? fitScale(natural, stage) : 1
  const scale = zoom ?? fit
  const fitted = zoom === null || (Math.abs(zoom - fit) < EPSILON && Math.abs(offset.x) < EPSILON && Math.abs(offset.y) < EPSILON)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    setStage(sizeOf(el))
    const observer = new ResizeObserver(() => setStage(sizeOf(el)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  // The focus goes into the layer, and back to the picture it came from when it closes.
  useEffect(() => {
    const before = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      const origin = document.querySelector<HTMLElement>(`[${GALLERY_KEY_ATTRIBUTE}="${CSS.escape(startKey)}"]`)
      ;(origin ?? (before instanceof HTMLElement ? before : null))?.focus({ preventScroll: true })
    }
  }, [startKey])

  // A move that follows the wheel or the pointer has no transition; the others glide.
  const follow = useCallback(() => {
    setFollowing(true)
    window.clearTimeout(followTimer.current)
    followTimer.current = window.setTimeout(() => setFollowing(false), LIVE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(followTimer.current), [])

  const zoomTo = useCallback(
    (next: number, at: Offset = { x: 0, y: 0 }) => {
      if (!natural) return
      const to = clampScale(next)
      setOffset((offset) => clampOffset(zoomOffset(offset, scale, to, at), natural, to, stage))
      setZoom(to)
    },
    [natural, scale, stage]
  )
  const fitView = useCallback(() => {
    setZoom(null)
    setOffset({ x: 0, y: 0 })
  }, [])
  // Another picture opens fitted.
  const go = useCallback(
    (step: number) => {
      const next = images[index + step]
      if (!next) return
      setKey(next.key)
      setNatural(null)
      setZoom(null)
      setOffset({ x: 0, y: 0 })
      setCopied(false)
      setFailed(null)
    },
    [images, index]
  )

  // Keys, in the capture phase on the document: ⎋ must not reach the chat (it interrupts the agent), and the arrows must
  // not move the composer's caret.
  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Tab') {
      // The focus stays in the layer.
      const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
      const first = items[0]
      const last = items.at(-1)
      const active = document.activeElement
      if (!first || !last) e.preventDefault()
      else if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else return
      e.stopPropagation()
      return
    }
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowLeft' && !mod) go(-1)
    else if (e.key === 'ArrowRight' && !mod) go(1)
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  // ⌘+ ⌘= ⌘− ⌘0 are the View menu's font size items: while the layer is open, main sends them here instead (one path, so
  // a key is never both a font step and a zoom).
  const onMenuZoom = useEffectEvent((action: ImageZoomAction): void => (action === 'in' ? zoomTo(scale * ZOOM_STEP) : action === 'out' ? zoomTo(scale / ZOOM_STEP) : fitView()))
  useEffect(() => {
    window.tr.ui.setImagePreviewOpen(true)
    const off = window.tr.ui.onImageZoom((action) => onMenuZoom(action))
    return () => {
      off()
      window.tr.ui.setImagePreviewOpen(false)
    }
  }, [])
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey(e)
    document.addEventListener('keydown', listener, true)
    return () => document.removeEventListener('keydown', listener, true)
  }, [])

  // ⌘ / ctrl + wheel (a pinch on the trackpad is one) zooms around the cursor; a plain wheel pans a larger picture.
  const onWheel = useEffectEvent((e: WheelEvent): void => {
    const el = stageRef.current
    if (!el || !natural) return
    e.preventDefault()
    follow()
    if (e.ctrlKey || e.metaKey) {
      const box = el.getBoundingClientRect()
      const at = { x: e.clientX - box.left - box.width / 2, y: e.clientY - box.top - box.height / 2 }
      const to = clampScale(scale * Math.exp(-e.deltaY * 0.01))
      setOffset(clampOffset(zoomOffset(offset, scale, to, at), natural, to, stage))
      setZoom(to)
    } else if (canPan(natural, scale, stage)) {
      setOffset(clampOffset({ x: offset.x - e.deltaX, y: offset.y - e.deltaY }, natural, scale, stage))
    }
  })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const listener = (e: WheelEvent): void => onWheel(e)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [])

  const pannable = natural ? canPan(natural, scale, stage) : false
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    pressedPicture.current = e.target instanceof HTMLImageElement
    if (e.button !== 0 || !pannable || !(e.target instanceof HTMLImageElement)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: offset }
    setDragging(true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || !natural) return
    setOffset(clampOffset({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }, natural, scale, stage))
  }
  const endDrag = (): void => {
    drag.current = null
    setDragging(false)
  }
  // Double click: 100% from the fitted view, the fitted view from any other.
  const toggleFit = (): void => (fitted && Math.abs(scale - 1) > EPSILON ? zoomTo(1) : fitView())
  const copy = (): void => {
    if (image) void window.tr.ui.copyImage(image.path).then(setCopied)
  }

  if (!image) return null
  const transform = `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`

  return createPortal(
    <div ref={dialogRef} className={styles.layer} role="dialog" aria-modal="true" aria-label={m.preview} tabIndex={-1} data-testid="gui-image-preview">
      <header className={styles.bar}>
        <span className={styles.title} title={image.title}>
          {image.title}
        </span>
        <span className={styles.position} aria-label={m.position(index + 1, images.length)} data-testid="gui-image-position">
          {index + 1} / {images.length}
        </span>
        <span className={styles.fill} />
        <div className={styles.controls}>
          <button type="button" className={styles.icon} aria-label={m.zoomOut} title={m.zoomOut} onClick={() => zoomTo(scale / ZOOM_STEP)}>
            <Minus {...ICON} />
          </button>
          <span className={styles.ratio} aria-label={m.ratio} data-testid="gui-image-ratio">
            {ratioLabel(scale)}
          </span>
          <button type="button" className={styles.icon} aria-label={m.zoomIn} title={m.zoomIn} onClick={() => zoomTo(scale * ZOOM_STEP)}>
            <Plus {...ICON} />
          </button>
          <button type="button" className={styles.text} disabled={fitted} onClick={fitView} data-testid="gui-image-fit">
            {m.fit}
          </button>
          <span className={styles.divider} aria-hidden />
          <button type="button" className={styles.icon} aria-label={m.reveal} title={m.reveal} onClick={() => window.tr.ui.revealInFinder(image.path)}>
            <FolderOpen {...ICON} />
          </button>
          <button type="button" className={styles.icon} aria-label={copied ? m.copied : m.copy} title={m.copy} onClick={copy}>
            {copied ? <Check {...ICON} /> : <Copy {...ICON} />}
          </button>
          <span className={styles.divider} aria-hidden />
          <button type="button" className={styles.icon} aria-label={m.close} title={m.close} onClick={onClose}>
            <X {...ICON} />
          </button>
        </div>
      </header>
      <div
        ref={stageRef}
        className={styles.stage}
        data-pannable={pannable || undefined}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // On the stage, not the picture: while a drag has the pointer captured, the stage is where the events land.
        onDoubleClick={() => pressedPicture.current && toggleFit()}
        onClick={(e) => {
          // A click on the empty stage closes the layer.
          if (e.target === e.currentTarget && !pressedPicture.current) onClose()
        }}
      >
        {failed === image.key && <span className={styles.missing}>{image.path.slice(image.path.lastIndexOf('/') + 1)}</span>}
        <img
          key={image.key}
          className={styles.picture}
          src={thumbnailUrl(image.path) ?? undefined}
          alt={image.title}
          draggable={false}
          style={{ ...(natural ? { width: natural.w, height: natural.h } : {}), transform, opacity: natural ? 1 : 0 }}
          data-following={following || dragging || undefined}
          data-testid="gui-image-preview-picture"
          onError={() => setFailed(image.key)}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        <button type="button" className={`${styles.nav} ${styles.prev}`} aria-label={m.previous} title={m.previous} disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft {...ICON} />
        </button>
        <button type="button" className={`${styles.nav} ${styles.next}`} aria-label={m.next} title={m.next} disabled={index === images.length - 1} onClick={() => go(1)}>
          <ChevronRight {...ICON} />
        </button>
      </div>
    </div>,
    document.body
  )
}
