// 主理人 · 模型 · effort (PRD F9 v1.252 新建框 and 派发, Figma 117D / 117E / 117F): three pickers, each as wide as its
// text and never cut off. 模型 shows only for a CLI with a model flag whose models are known (probed once, as 定时任务
// does, kept in the workspace's `guiPicks`); effort only for a CLI with an effort flag. The menus are the new-session
// sheet's. The row, its project picker and its button belong to the caller.
import { useEffect, useState, type ReactNode } from 'react'
import { AGENT_SPECS, agentName } from '@shared/agents'
import type { DispatchAgent } from '@shared/dispatch'
import { effortLabel } from '@shared/gui-chat'
import { defineMessages } from '@shared/i18n'
import type { LeaderOptions } from '../dispatch/task-deliver'
import { SheetMenu, type SheetMenuSection } from '../new-session/SheetMenu'
import { useWorkspace } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { useMessages } from '../ui/i18n'
import { Check, ChevronDown } from '../ui/icons'
import { usableLeader, type LeaderChoice } from './model'
import { effortsOf, leaderAgents, modelsFor, usedPick } from './picks'
import { useTaskBoard } from './store'
import styles from './LeaderPickers.module.css'

const M = defineMessages({
  zh: { leader: '主理人', model: '模型', effort: '推理强度', none: '暂不派发', missing: '没装', default: '默认', defaultModel: '默认模型', defaultEffort: '默认推理强度', off: '关' },
  en: { leader: 'Leader', model: 'Model', effort: 'Effort', none: 'Do not dispatch', missing: 'Not installed', default: 'Default', defaultModel: 'Default model', defaultEffort: 'Default effort', off: 'Off' }
})

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Who leads and how: `agent` null = 暂不派发. */
export interface LeaderSelection {
  agent: DispatchAgent | null
  options: LeaderOptions
}

type Found = Readonly<Record<string, boolean>>

const detect = (): Promise<Found | null> =>
  window.tr.app
    .detectAgents()
    .then((next) => next as unknown as Found)
    .catch(() => null)

/**
 * The remembered choice as it applies here now. `allowNone` false (派发): 暂不派发 reads as the first installed agent.
 */
export function useLeaderPickers(allowNone: boolean) {
  const [found, setFound] = useState<Found | null>(null)
  const choice = useTaskBoard((s) => s.leaderChoice)
  const picks = useTaskBoard((s) => s.leaderPicks)
  const guiPicks = useWorkspace((s) => s.guiPicks)

  useEffect(() => {
    let cancelled = false
    void detect().then((next) => !cancelled && next && setFound(next))
    return () => {
      cancelled = true
    }
  }, [])

  const wanted = (seen: Found | null, current: LeaderChoice): LeaderChoice => {
    const usable = usableLeader(current, seen)
    return usable === 'none' && !allowNone ? (leaderAgents(seen).installed[0] ?? 'none') : usable
  }
  const agent = wanted(found, choice)
  const probed = agent === 'none' ? undefined : guiPicks[agent]?.models
  const models = agent === 'none' ? [] : modelsFor(agent, probed)
  const efforts = agent === 'none' ? [] : effortsOf(agent)

  // The agent's models, asked without starting a conversation; only an installed CLI with a model flag is asked.
  const ask = agent !== 'none' && found?.[agent] === true && !probed?.length && AGENT_SPECS[agent].modelFlag !== null ? agent : null
  useEffect(() => {
    if (ask === null) return
    let cancelled = false
    void window.tr.gui
      .models(ask)
      .then((result) => {
        if (cancelled || !result.ok || useWorkspace.getState().guiPicks[ask]?.modelsFrom === 'live') return
        useWorkspace.getState().rememberGuiPicks(ask, { models: result.catalog.models, modelsFrom: 'probe' })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ask])

  const optionsOf = (of: DispatchAgent): LeaderOptions => {
    const state = useTaskBoard.getState().leaderPicks
    const model = usedPick(state.models[of], modelsFor(of, useWorkspace.getState().guiPicks[of]?.models).map((x) => x.value))
    const effort = usedPick(state.efforts[of], effortsOf(of))
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
  }

  /** What to start, looking for the installed CLIs again when the first look is not back yet. */
  const resolve = async (): Promise<LeaderSelection> => {
    const seen = found ?? (await detect())
    const chosen = seen === null ? 'none' : wanted(seen, useTaskBoard.getState().leaderChoice)
    return chosen === 'none' ? { agent: null, options: {} } : { agent: chosen, options: optionsOf(chosen) }
  }

  return {
    allowNone,
    found,
    agent,
    models,
    efforts,
    model: agent === 'none' ? undefined : usedPick(picks.models[agent], models.map((x) => x.value)),
    effort: agent === 'none' ? undefined : usedPick(picks.efforts[agent], efforts),
    resolve
  }
}

export type LeaderPickersState = ReturnType<typeof useLeaderPickers>

type Kind = 'leader' | 'model' | 'effort'

export function LeaderPickers({ state, onClosed }: { state: LeaderPickersState; onClosed(): void }) {
  const m = useMessages(M)
  const [menu, setMenu] = useState<{ kind: Kind; anchor: HTMLElement } | null>(null)
  const { agent, models, efforts, model, effort, found } = state
  const toggle = (kind: Kind, anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })
  const effortText = (value: string): string => (value === 'off' ? m.off : effortLabel(value))
  const tick = (on: boolean): ReactNode => (on ? <Check {...ICON} /> : null)

  const sections = (): SheetMenuSection[] => {
    if (menu?.kind === 'model' && agent !== 'none') {
      return [{ items: [{ value: '', label: m.default, icon: tick(model === undefined) }, ...models.map((x) => ({ value: x.value, label: x.label, icon: tick(model === x.value) }))] }]
    }
    if (menu?.kind === 'effort') {
      return [{ items: [{ value: '', label: m.default, icon: tick(effort === undefined) }, ...efforts.map((value) => ({ value, label: effortText(value), icon: tick(effort === value) }))] }]
    }
    const { installed, missing } = leaderAgents(found)
    const item = (id: DispatchAgent) => ({ value: id, label: agentName(id), icon: agent === id ? <Check {...ICON} /> : <AgentIcon kind={id} size={12} /> })
    return [
      { items: installed.map(item) },
      ...(state.allowNone ? [{ items: [{ value: 'none', label: m.none, icon: agent === 'none' ? <Check {...ICON} /> : <span className={styles.noMark} /> }] }] : []),
      { items: missing.map((id) => ({ ...item(id), meta: m.missing, disabled: true })) }
    ].filter((section) => section.items.length > 0)
  }

  const pickValue = (value: string): void => {
    const store = useTaskBoard.getState()
    if (menu?.kind === 'leader') {
      store.setLeaderChoice(value === 'none' ? 'none' : (leaderAgents(found).installed.find((id) => id === value) ?? store.leaderChoice))
    } else if (menu && agent !== 'none') {
      store.setLeaderPick(menu.kind === 'model' ? 'models' : 'efforts', agent, value === '' ? null : value)
    }
    setMenu(null)
    onClosed()
  }

  return (
    <>
      <Picker label={m.leader} testId="task-leader" onClick={(el) => toggle('leader', el)}>
        {agent !== 'none' && <AgentIcon kind={agent} size={12} />}
        <span className={styles.text}>{agent === 'none' ? m.none : agentName(agent)}</span>
      </Picker>
      {models.length > 0 && (
        <Picker label={m.model} testId="task-model" onClick={(el) => toggle('model', el)}>
          <span className={styles.text}>{model === undefined ? m.defaultModel : (models.find((x) => x.value === model)?.label ?? model)}</span>
        </Picker>
      )}
      {efforts.length > 0 && (
        <Picker label={m.effort} testId="task-effort" onClick={(el) => toggle('effort', el)}>
          <span className={styles.text}>{effort === undefined ? m.defaultEffort : effortText(effort)}</span>
        </Picker>
      )}
      {/* The menu is portalled to <body>, but React still bubbles its events up through here: keep them off the canvas. */}
      <div className={styles.menuHost} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        {menu && (
          <SheetMenu
            fit
            anchor={menu.anchor}
            label={m[menu.kind]}
            sections={sections}
            selected={menu.kind === 'leader' ? agent : ((menu.kind === 'model' ? model : effort) ?? '')}
            onPick={pickValue}
            onClose={(refocus) => {
              setMenu(null)
              if (refocus) onClosed()
            }}
          />
        )}
      </div>
    </>
  )
}

export function Picker({ label, testId, plain, onClick, children }: { label: string; testId: string; plain?: boolean; onClick(anchor: HTMLElement): void; children: ReactNode }) {
  return (
    <button type="button" className={plain ? `${styles.picker} ${styles.plain}` : styles.picker} aria-label={label} aria-haspopup="listbox" data-testid={testId} onClick={(e) => onClick(e.currentTarget)}>
      {children}
      <ChevronDown {...ICON} />
    </button>
  )
}
