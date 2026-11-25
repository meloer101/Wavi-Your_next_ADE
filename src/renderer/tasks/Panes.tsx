// The board's floating panes (Figma 115A4): 「动态」 top right, the toolbar at the bottom, the zoom control bottom right.
// All three are the thickest solid-glass finish, so they read above notes and dots alike.
import { defineMessages } from '@shared/i18n'
import { Minus, Plus } from '../ui/icons'
import { useMessages } from '../ui/i18n'
import type { ActivityEvent, ActivityKind } from './model'
import styles from './Panes.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const
const SHOWN_EVENTS = 6

const M = defineMessages({
  zh: {
    activity: '动态',
    collapse: '收起动态',
    expand: '展开动态',
    add: '贴一张',
    fit: '适应窗口',
    zoomOut: '缩小',
    zoomIn: '放大',
    zoom: '缩放',
    added: (seq: number, title: string) => `#${seq} ${title} 贴出`,
    started: (seq: number, title: string) => `#${seq} ${title} 开始`,
    dispatched: (seq: number, title: string) => `#${seq} ${title} 已派发`,
    done: (seq: number, title: string) => `#${seq} ${title} 完成`,
    attention: (seq: number, title: string) => `#${seq} ${title} 等你处理`,
    error: (seq: number, title: string) => `#${seq} ${title} 出错`,
    canceled: (seq: number, title: string) => `#${seq} ${title} 已取消`,
    split: (parent: number, from: number, to?: number) => `#${parent} 拆出 #${from}${to !== undefined ? ` – #${to}` : ''}`
  },
  en: {
    activity: 'Activity',
    collapse: 'Collapse activity',
    expand: 'Expand activity',
    add: 'New note',
    fit: 'Fit to window',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    zoom: 'Zoom',
    added: (seq: number, title: string) => `#${seq} ${title} added`,
    started: (seq: number, title: string) => `#${seq} ${title} started`,
    dispatched: (seq: number, title: string) => `#${seq} ${title} dispatched`,
    done: (seq: number, title: string) => `#${seq} ${title} done`,
    attention: (seq: number, title: string) => `#${seq} ${title} needs you`,
    error: (seq: number, title: string) => `#${seq} ${title} failed`,
    canceled: (seq: number, title: string) => `#${seq} ${title} canceled`,
    split: (parent: number, from: number, to?: number) => `#${parent} split #${from}${to !== undefined ? ` – #${to}` : ''}`
  }
})

const DOT_OF: Record<ActivityKind, 'working' | 'attention' | 'done' | 'error' | 'idle'> = {
  added: 'idle',
  split: 'idle',
  dispatched: 'idle',
  started: 'working',
  done: 'done',
  attention: 'attention',
  error: 'error',
  canceled: 'idle'
}

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function ActivityPanel({ events, open, onToggle }: { events: readonly ActivityEvent[]; open: boolean; onToggle(): void }) {
  const m = useMessages(M)
  if (events.length === 0) return null
  return (
    <section className={styles.activity} data-testid="task-activity" data-open={open} aria-label={m.activity}>
      <button type="button" className={styles.activityHead} onClick={onToggle} aria-expanded={open} title={open ? m.collapse : m.expand}>
        <span>{m.activity}</span>
        <span className={styles.key}>⌥D</span>
      </button>
      {open && (
        <ol className={styles.events}>
          {events.slice(0, SHOWN_EVENTS).map((e) => (
            <li key={e.id} className={styles.event}>
              <span className={styles.eventDot} data-tone={DOT_OF[e.kind]} aria-hidden />
              <span className={styles.eventBody}>
                <span className={styles.key}>{clock(e.at)}</span>
                <span className={styles.eventText}>{e.kind === 'split' ? m.split(e.parentSeq ?? 0, e.seq, e.toSeq) : m[e.kind](e.seq, e.title)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function Toolbar({ onAdd, onFit }: { onAdd(): void; onFit(): void }) {
  const m = useMessages(M)
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={m.add}>
      <button type="button" className={styles.tool} onClick={onAdd} data-testid="task-add">
        <Plus {...ICON} />
        {m.add}
        <span className={styles.key}>N</span>
      </button>
      <span className={styles.rule} aria-hidden />
      <button type="button" className={styles.tool} onClick={onFit} data-testid="task-fit">
        {m.fit}
        <span className={styles.key}>⇧1</span>
      </button>
    </div>
  )
}

export function ZoomControl({ zoom, onStep }: { zoom: number; onStep(direction: 1 | -1): void }) {
  const m = useMessages(M)
  return (
    <div className={styles.zoom} role="group" aria-label={m.zoom}>
      <button type="button" className={styles.zoomButton} aria-label={m.zoomOut} title={m.zoomOut} onClick={() => onStep(-1)}>
        <Minus {...ICON} />
      </button>
      <span className={styles.zoomValue} data-testid="task-zoom">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className={styles.zoomButton} aria-label={m.zoomIn} title={m.zoomIn} onClick={() => onStep(1)}>
        <Plus {...ICON} />
      </button>
    </div>
  )
}
