// 看板 · GitHub's 交给 agent as the phone asks for it (PRD F22 v1.227 ⑤): the name, the first message, the branch and a
// PR's start point, worked out from the item the same way 看板 · GitHub's own 交给 agent does on the Mac
// (src/renderer/overview/GitHubDetail.tsx `taskFor`) and 新建会话 names its branch. Pure: main reads the item, fetches a
// PR's head (src/main/github-board.ts) and the project's branches, and hands them in.
import { itemTitle, startBranch, taskPrompt, type BoardDetail, type BoardPrStart, type BoardStart } from '@shared/github-board'
import { repoArg } from '@shared/pull-requests'

/**
 * The phone's 交给 agent answer: `pr` is a PR's fetched head (main's prStart) and null for an issue; `taken` are the
 * project's local branch names, which a same-repository PR's head branch must not already be among.
 */
export function startItem(detail: BoardDetail, pr: Extract<BoardPrStart, { ok: true }> | null, prefix: string, taken: ReadonlySet<string>): BoardStart {
  // A fork's PR has no head branch to push back to: the task says to commit to the branch it starts on.
  const forkPr = pr !== null && pr.headRef === null
  return {
    link: { repo: repoArg(detail.repo), kind: detail.kind, number: detail.number },
    title: itemTitle(detail),
    prompt: taskPrompt(detail, forkPr),
    branch: startBranch(prefix, detail, pr?.headRef ?? null, taken),
    base: pr?.baseRef ?? null,
    ...(pr ? { startAt: pr.startAt } : {})
  }
}
