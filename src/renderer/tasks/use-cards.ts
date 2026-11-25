// Every task with the status its session gives it (PRD §6.2): the join of the task store and the workspace's sessions.
import { useMemo } from 'react'
import type { Session } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { joinCards, type Card } from './model'
import { useTaskBoard } from './store'

export function useCards(): Card<Session>[] {
  const tasks = useTaskBoard((s) => s.tasks)
  const sessions = useWorkspace((s) => s.sessions)
  return useMemo(() => joinCards(tasks, sessions), [tasks, sessions])
}
