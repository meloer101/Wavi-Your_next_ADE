// The chip above each project's tree (Figma 115A4 ProjectLabel): `acme-web  主理人 ✻ Opus 5.5 ◌`. Without a leader it
// says 「未设置主理人」「设置…」; choosing a leader is the next step (PRD F21 · 114C), so 「设置…」 does nothing yet.
import { defineMessages } from '@shared/i18n'
import type { Project, Session } from '@shared/types'
import { enterSession } from '../overview/store'
import { useSessionMeta } from '../session-meta/store'
import { AgentIcon } from '../ui/AgentIcon'
import { useMessages } from '../ui/i18n'
import { StatusGlyph } from '../ui/StatusGlyph'
import type { Rect } from './layout'
import styles from './ProjectLabel.module.css'

const M = defineMessages({
  zh: { leader: '主理人', none: '未设置主理人', set: '设置…', open: (name: string) => `打开主理人会话（${name}）` },
  en: { leader: 'Leader', none: 'No leader set', set: 'Set…', open: (name: string) => `Open the leader session (${name})` }
})

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
          {/* TODO(task B step 2): 设置… opens the leader menu (Figma 114C); until then it only reads. */}
          <span className={styles.set} role="button" aria-disabled="true">
            {m.set}
          </span>
        </>
      )}
    </div>
  )
}
