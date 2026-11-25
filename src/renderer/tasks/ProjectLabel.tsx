// The chip above each project's tree (Figma 115A4 ProjectLabel): `acme-web  主理人 ✻ Opus 5.5 ◌`. Without a leader it
// says 「未设置主理人」「设置…」, which starts the leader flow of the project's ⋯ menu (leader-action.ts).
import { defineMessages } from '@shared/i18n'
import type { Project, Session } from '@shared/types'
import { openNewSessionSheet } from '../new-session/sheet-store'
import { enterSession } from '../overview/store'
import { useSessionMeta } from '../session-meta/store'
import { openSettings } from '../settings/SettingsDialog'
import { AgentIcon } from '../ui/AgentIcon'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import type { Rect } from './layout'
import { setLeaderFor } from './leader-action'
import styles from './ProjectLabel.module.css'

const M = defineMessages({
  zh: { leader: '主理人', none: '未设置主理人', set: '设置…', open: (name: string) => `打开主理人会话（${name}）` },
  en: { leader: 'Leader', none: 'No leader set', set: 'Set…', open: (name: string) => `Open the leader session (${name})` }
})

const LEADER_FLOW = {
  leaderEnabled: () => window.tr.settings.get().then((s) => s.dispatch.leader),
  openSheet: (projectId: string, options: { leader: true }) => openNewSessionSheet(projectId, null, options),
  openSettings: () => openSettings('automation')
}

export function ProjectLabel({ project, at, leader }: { project: Pick<Project, 'id' | 'name'>; at: Pick<Rect, 'x' | 'y'>; leader: Session | undefined }) {
  const m = useMessages(M)
  const model = useSessionMeta((s) => (leader ? s.bySession[leader.id]?.settings?.model : undefined)) ?? leader?.dispatchModel
  return (
    <div className={styles.label} style={{ left: at.x, top: at.y }} data-testid="task-project-label" data-project-id={project.id}>
      <span className={styles.name}>{project.name}</span>
      {leader ? (
        <button type="button" className={styles.leader} title={m.open(leader.title)} aria-label={m.open(leader.title)} onClick={() => enterSession(leader.id)}>
          <span className={styles.dim}>{m.leader}</span>
          <AgentIcon kind={leader.kind} size={12} />
          {model && <span className={styles.model}>{model}</span>}
          <StatusGlyph status={leader.status} />
        </button>
      ) : (
        <>
          <span className={styles.dim}>{m.none}</span>
          <button type="button" className={styles.set} onClick={() => void setLeaderFor(project.id, LEADER_FLOW)}>
            {m.set}
          </button>
        </>
      )}
    </div>
  )
}
