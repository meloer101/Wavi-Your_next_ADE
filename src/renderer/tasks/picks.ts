// What the new-card box and 派发 offer for a card's leader (PRD F9 v1.252): agents, then that agent's models and
// effort levels. Pure; the remembered picks live in ./store.ts, the menus in ./LeaderPickers.tsx.
import { isLaunchEffort, isLaunchModel } from '@shared/agent-launch'
import { AGENT_SPECS, CLI_AGENTS, isCliAgent } from '@shared/agents'
import { canLeadCard, type DispatchAgent } from '@shared/dispatch'

/** The model and effort last picked per agent; absent = 默认 (nothing passed). */
export interface LeaderPicks {
  models: Partial<Record<DispatchAgent, string>>
  efforts: Partial<Record<DispatchAgent, string>>
}

export const NO_PICKS: LeaderPicks = { models: {}, efforts: {} }

/** The stored picks; anything that no longer fits (an agent gone, a value no command line takes) is dropped. */
export function parseLeaderPicks(raw: unknown): LeaderPicks {
  const of = (value: unknown, ok: (agent: DispatchAgent, text: string) => boolean): Partial<Record<DispatchAgent, string>> =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([agent, text]) => isCliAgent(agent) && typeof text === 'string' && ok(agent, text)))
      : {}
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as { models?: unknown; efforts?: unknown }
  return {
    models: of(v.models, (_agent, model) => isLaunchModel(model)),
    efforts: of(v.efforts, (agent, effort) => effortsOf(agent).includes(effort) && isLaunchEffort(effort))
  }
}

/** Every agent the leader menu lists, installed and not, each group in `CLI_AGENTS` order (PRD F9 v1.252). */
export function leaderAgents(found: Readonly<Record<string, boolean>> | null): { installed: DispatchAgent[]; missing: DispatchAgent[] } {
  const all = CLI_AGENTS.filter((id) => canLeadCard(id))
  return { installed: all.filter((id) => found === null || found[id] === true), missing: all.filter((id) => found !== null && found[id] !== true) }
}

export interface ModelChoice {
  value: string
  label: string
}

/** The models the menu lists under 默认: none for a CLI without a model flag; the agent's own "default" entry is 默认. */
export function modelsFor(agent: DispatchAgent, probed: readonly ModelChoice[] | undefined): ModelChoice[] {
  if (AGENT_SPECS[agent].modelFlag === null) return []
  return (probed ?? []).filter((m) => m.value !== 'default' && isLaunchModel(m.value))
}

export const effortsOf = (agent: DispatchAgent): readonly string[] => AGENT_SPECS[agent].effort?.values ?? []

/** What is really passed: a remembered value the menu no longer lists reads as 默认. */
export function usedPick(remembered: string | undefined, offered: readonly string[]): string | undefined {
  return remembered !== undefined && offered.includes(remembered) ? remembered : undefined
}
