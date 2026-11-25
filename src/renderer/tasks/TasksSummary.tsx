// 「3 个项目 · 12 个任务 · 2 个等你处理」: the 任务 tab's header summary.
import { defineMessages } from '@shared/i18n'
import { useWorkspace } from '../state/workspace'
import { useMessages } from '../ui/i18n'
import { boardCounts } from './model'
import { useCards } from './use-cards'

const M = defineMessages({
  zh: { text: (projects: number, tasks: number, attention: number) => `${projects} 个项目 · ${tasks} 个任务${attention > 0 ? ` · ${attention} 个等你处理` : ''}` },
  en: {
    text: (projects: number, tasks: number, attention: number) =>
      `${projects} ${projects === 1 ? 'project' : 'projects'} · ${tasks} ${tasks === 1 ? 'task' : 'tasks'}${attention > 0 ? ` · ${attention} need you` : ''}`
  }
})

export function TasksSummary() {
  const m = useMessages(M)
  const cards = useCards()
  const projects = useWorkspace((s) => s.projects.length)
  const counts = boardCounts(cards, projects)
  return <>{m.text(counts.projects, counts.tasks, counts.attention)}</>
}
