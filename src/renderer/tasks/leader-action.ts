// 「设置…」 on a project label without a leader (PRD F21 v1.198): the same flow as the project's ⋯ menu item
// 「新建 leader…」 — the new-session panel with 「作为 leader」 ticked. While 设置 · 自动化 · 派活 · 「leader 会话」 is off
// that item does not exist, so the settings open at it instead.
import type { ProjectId } from '@shared/types'

export interface LeaderFlow {
  /** Whether the setting 「leader 会话」 is on. */
  leaderEnabled(): Promise<boolean>
  openSheet(projectId: ProjectId, options: { leader: true }): void
  openSettings(): void
}

export async function setLeaderFor(projectId: ProjectId, flow: LeaderFlow): Promise<'sheet' | 'settings'> {
  const enabled = await flow.leaderEnabled().catch(() => false)
  if (enabled) {
    flow.openSheet(projectId, { leader: true })
    return 'sheet'
  }
  flow.openSettings()
  return 'settings'
}
