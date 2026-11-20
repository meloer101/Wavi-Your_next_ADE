// 批准 (PRD F26 / Figma 102B3): the report block's one primary moves an issue the session handled through the merge
// chain — 合并到基线 (squash, its message ending with `Closes #n`) and then 推送 of the base, whose pre-push review (F13) is
// part of that node. Both are the chain's own moves (chain-actions.ts), so a step that stops (a conflict, a review at P0 /
// P1, a refused push, a busy base) stays in the chain exactly as when the user runs it by hand; the record is 已合并 only
// when the push went through.
import { CHAIN_LABEL } from '@shared/ship-chain'
import type { IssueRecord } from '@shared/issue-watch'
import { checksText, turnCheckView } from '@shared/turn-checks'
import { defineMessages, pick } from '@shared/i18n'
import type { SessionId } from '@shared/types'
import { loadPreflight } from '../pull-requests/chain-store'
import { chainPlace, runChainCommand } from '../pull-requests/chain-actions'
import { shipContextFor } from '../pull-requests/exit-model'
import { startShip, useShips } from '../pull-requests/ship-runner'
import { setPrNotice, usePullRequests } from '../pull-requests/store'
import { useSessionMeta } from '../session-meta/store'

const M = defineMessages({
  zh: {
    projectGone: '这个 worktree 不在工作区里',
    busy: '正在合并或推送',
    notGit: '读不到改动',
    checking: '还在检查这个 worktree',
    mergeStopped: '合并停在合入链路里',
    pushStopped: '合并好了，推送停在合入链路里',
    merged: '已合并并推送'
  },
  en: {
    projectGone: 'This worktree is not in the workspace',
    busy: 'A merge or push is already running',
    notGit: "Couldn't read the changes",
    checking: 'Still checking this worktree',
    mergeStopped: 'The merge stopped in the chain',
    pushStopped: 'Merged, but the push stopped in the chain',
    merged: 'Merged and pushed'
  }
})

export type ApprovalResult = { ok: true } | { ok: false; message: string }

/**
 * Whether a chain run in the worktree finished cleanly, stopped at a failed step, or never started. The run is started
 * after this call, so it waits a while for the block to appear.
 */
function watchRun(worktree: string, startWaitMs = 30_000): Promise<'done' | 'stopped' | 'none'> {
  return new Promise((resolve) => {
    let seen = false
    const timer = setTimeout(() => {
      if (seen) return
      off()
      resolve('none')
    }, startWaitMs)
    const check = (): void => {
      const state = useShips.getState().byWorktree[worktree]
      if (state) {
        seen = true
        // A step that failed leaves the block open for the user (重试 / 照样推送): this stops at once, not when it closes.
        if (state.error !== null) {
          clearTimeout(timer)
          off()
          resolve('stopped')
        }
        return
      }
      if (!seen) return
      clearTimeout(timer)
      off()
      resolve('done')
    }
    const off = useShips.subscribe(check)
    check()
  })
}

/**
 * 批准: 合并 (squash, closing the issue) then 推送 of the base. Resolves 完成 only when both went through; a chain step
 * that stopped is left for the user (the block on the worktree says why) and reported as a note.
 */
export async function approveIssue(record: IssueRecord, worktreePath: string, sessionId: SessionId): Promise<ApprovalResult> {
  const place = chainPlace(worktreePath)
  if (!place) return { ok: false, message: pick(M).projectGone }
  const path = place.worktree.path
  if (useShips.getState().byWorktree[path]) return { ok: false, message: pick(M).busy }
  const root = place.project.rootPath
  window.tr.pr.refresh(path)
  const [changes, preflight] = await Promise.all([
    window.tr.git.changes(path, place.worktree.baseBranch ?? undefined).catch(() => null),
    loadPreflight({ root, worktree: path })
  ])
  if (!changes) return { ok: false, message: pick(M).notGit }
  if (!preflight?.ok) return { ok: false, message: preflight?.message ?? pick(M).checking }
  const settings = await window.tr.settings.get()
  const pr = usePullRequests.getState().byWorktree[path]?.pr ?? null
  const checks = turnCheckView(useSessionMeta.getState().bySession[sessionId]?.checks)
  const ctx = shipContextFor({
    projectRoot: root,
    worktreePath: path,
    preflight,
    changes,
    pr,
    agentSession: place.agent?.id ?? null,
    openIn: sessionId,
    checksLine: checks ? checksText(checks) : null,
    settings: { review: settings.review, pr: settings.pr }
  })
  const merged = watchRun(path)
  startShip({ ...ctx, paths: null }, 'main', CHAIN_LABEL.mergeTo(preflight.base), { head: preflight.head, closes: record.number })
  if ((await merged) !== 'done') return { ok: false, message: pick(M).mergeStopped }
  // 推送 of the base: the chain's push node (pull first, the pre-push review, then the push), as if clicked by hand.
  const pushed = watchRun(path)
  await runChainCommand(path, 'push-base', sessionId)
  if ((await pushed) !== 'done') return { ok: false, message: pick(M).pushStopped }
  await window.tr.issueWatch.report({ key: record.key, type: 'merged' }).catch(() => {})
  setPrNotice(path, { tone: 'muted', text: pick(M).merged })
  return { ok: true }
}
