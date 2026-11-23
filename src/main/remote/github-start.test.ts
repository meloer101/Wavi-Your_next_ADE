// 看板 · GitHub's 交给 agent for the phone (PRD F22 v1.227 ④, F9): the answer's title, first message, branch and start
// point, for an issue, a same-repository PR whose head branch is free, one whose branch is taken, and a fork's PR.
import { describe, expect, it } from 'vitest'
import { itemBranch, itemTitle, taskPrompt, type BoardDetail, type BoardPrStart } from '@shared/github-board'
import { startItem } from './github-start'

const repo = { host: 'github.com', owner: 'acme', name: 'web' }

function issue(o: Partial<BoardDetail> = {}): BoardDetail {
  return {
    kind: 'issue',
    repo,
    number: 139,
    title: 'Safari 17 上结算页白屏',
    url: 'https://github.com/acme/web/issues/139',
    state: 'open',
    author: 'lin-wei',
    createdAt: 1_730_000_000_000,
    labels: ['bug'],
    assignees: [],
    body: '点「去付款」白屏。',
    comments: [],
    commentCount: 0,
    ...o
  }
}

function pr(o: Partial<BoardDetail> = {}): BoardDetail {
  return issue({
    kind: 'pr',
    number: 140,
    title: 'chore: 升级 Vite 到 7',
    url: 'https://github.com/acme/web/pull/140',
    pr: {
      draft: false,
      headRef: 'jacoy/vite-7',
      baseRef: 'main',
      crossRepo: false,
      additions: 86,
      deletions: 41,
      changedFiles: 7,
      review: null,
      checks: []
    },
    ...o
  })
}

const fetched = (o: Partial<Extract<BoardPrStart, { ok: true }>> = {}): Extract<BoardPrStart, { ok: true }> => ({
  ok: true,
  startAt: 'refs/remotes/origin/jacoy/vite-7',
  baseRef: 'main',
  headRef: 'jacoy/vite-7',
  ...o
})

describe('the phone\'s 交给 agent answer', () => {
  it('names an issue\'s branch after it and asks for the fix, with nothing to start from', () => {
    const detail = issue()
    const answer = startItem(detail, null, 'jacoy', new Set())
    expect(answer).toEqual({
      link: { repo: 'github.com/acme/web', kind: 'issue', number: 139 },
      title: '#139 Safari 17 上结算页白屏',
      prompt: taskPrompt(detail),
      branch: 'jacoy/issue-139-safari-17',
      base: null
    })
    expect(answer.prompt).toContain('处理 GitHub issue acme/web#139')
    expect(answer.prompt).toContain('<issue>')
  })

  it('keeps a same-repository PR\'s own head branch while it is free, and starts at its head', () => {
    const detail = pr()
    const answer = startItem(detail, fetched(), 'jacoy', new Set(['main']))
    expect(answer).toEqual({
      link: { repo: 'github.com/acme/web', kind: 'pr', number: 140 },
      title: '#140 chore: 升级 Vite 到 7',
      prompt: taskPrompt(detail, false),
      branch: 'jacoy/vite-7',
      base: 'main',
      startAt: 'refs/remotes/origin/jacoy/vite-7'
    })
  })

  it('names a new branch after the PR when its head branch is already here, still starting at the PR head', () => {
    const detail = pr()
    const taken = new Set(['main', 'jacoy/vite-7'])
    const answer = startItem(detail, fetched(), 'jacoy', taken)
    expect(answer.branch).toBe(itemBranch('jacoy', 'pr', 140, detail.title, taken))
    expect(answer.branch).not.toBe('jacoy/vite-7')
    expect(answer.title).toBe(itemTitle(detail))
    expect(answer.startAt).toBe('refs/remotes/origin/jacoy/vite-7')
  })

  it('names a fork PR\'s branch after it and asks not to push back', () => {
    const detail = pr()
    const answer = startItem(detail, fetched({ startAt: 'refs/wavi/pull/140', headRef: null }), 'jacoy', new Set())
    expect(answer.branch).toBe(itemBranch('jacoy', 'pr', 140, detail.title, new Set()))
    expect(answer.base).toBe('main')
    expect(answer.startAt).toBe('refs/wavi/pull/140')
    expect(answer.prompt).toBe(taskPrompt(detail, true))
    expect(answer.prompt).toContain('推不回去')
  })
})
