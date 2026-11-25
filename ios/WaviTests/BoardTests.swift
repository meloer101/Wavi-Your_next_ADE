// 看板's view models (PRD F22 v1.229, Figma 103 / 103′): 进度's groups, card colours, checks line and the landscape card's
// third row; 看板 · GitHub's projects, rows, review tags, checks marks and an item's page; and the old Mac's answer. Pure,
// so the phone's screens only place what these return.
import Foundation
import Testing
@testable import Wavi

private let now: Double = 1_800_000_000_000

private func session(_ id: String, _ status: SessionStatus, project: String = "p1", activity: Double, since: Double? = nil,
  action: String? = nil, reply: String? = nil, branch: String? = "jacoy/x", checks: RemoteChecks? = nil,
  stat: RemoteStat? = nil, github: GitHubLink? = nil) -> RemoteSession {
  RemoteSession(id: id, projectId: project, title: "会话 \(id)", agent: "claude", status: status, action: action, since: since,
    activity: activity, branch: branch, model: nil, reply: reply, ship: nil, shipNotice: nil, checks: checks, stat: stat, github: github)
}

private let projects = [RemoteProject(id: "p1", name: "acme-web"), RemoteProject(id: "p2", name: "terminal-reborn")]

@Suite struct ProgressBoardTests {
  @Test func groupsComeInTheDesktopsOrder() {
    let list = RemoteSessionList(projects: projects, sessions: [
      session("idle2", .idle, activity: 30),
      session("run", .running, activity: 20),
      session("wait-recent", .needsYou, project: "p2", activity: 10, since: 10),
      session("done", .doneUnread, activity: 25),
      session("error", .error, activity: 15),
      session("wait-earlier", .needsYou, activity: 5, since: 5),
      session("idle1", .idle, activity: 40)
    ])
    let groups = boardGroups(list)
    #expect(groups.map(\.key) == [.needsYou, .error, .doneUnread, .running, .idle])
    #expect(groups.map(\.label) == ["等你处理", "出错", "待审阅", "运行中", "空闲"])
    // Within a section the one active last comes first (Figma 103′B).
    #expect(groups[0].cards.map(\.session.id) == ["wait-recent", "wait-earlier"])
    #expect(groups[4].cards.map(\.session.id) == ["idle1", "idle2"])
    #expect(groups[0].cards[0].projectName == "terminal-reborn")
    #expect(groups[0].cards[0].whereLine == "terminal-reborn › jacoy/x")
    // An empty group is not drawn.
    #expect(groups.count == 5)
  }

  @Test func exitedIsItsOwnGroupOnlyWhenItHasSessions() {
    let without = RemoteSessionList(projects: projects, sessions: [session("a", .running, activity: 1)])
    #expect(!boardGroups(without).contains { $0.key == .exited })
    let with = RemoteSessionList(projects: projects, sessions: [session("a", .running, activity: 1), session("x", .exited, activity: 2)])
    #expect(boardGroups(with).map(\.key) == [.running, .exited])
  }

  @Test func cardsTakeTheDesktopsColoursAndExitedTakesIdles() {
    #expect(cardTone(.needsYou) == .attention)
    #expect(cardTone(.error) == .error)
    #expect(cardTone(.doneUnread) == .review)
    #expect(cardTone(.running) == .working)
    #expect(cardTone(.idle) == .idle)
    #expect(cardTone(.exited) == .idle)
    // The colours themselves come from the desktop through Shared.json.
    #expect(Shared.data.colors["card-attention"] != nil)
    #expect(Shared.data.colors["card-review-meta"] != nil)
    #expect(Shared.data.colors["card-idle"] != nil)
  }

  @Test func theChecksLineReadsLikeTheDesktops() {
    let checks = RemoteChecks(turn: .current, edited: true, kinds: [
      .init(kind: "test", status: "pass"), .init(kind: "lint", status: "fail"), .init(kind: "typecheck", status: "not-run")
    ])
    #expect(checksText(checks) == "测试 ✓ · lint ✗ · 类型 未跑")
    #expect(checksText(RemoteChecks(turn: .previous, edited: true, kinds: [])) == "没跑检查")
  }

  @Test func aLandscapeCardSaysTheChecksWhenThereAreAnyElseTheSummary() {
    let checks = RemoteChecks(turn: .current, edited: false, kinds: [.init(kind: "test", status: "pass"), .init(kind: "build", status: "pass")])
    let withChecks = BoardCard(session: session("a", .running, activity: 1, action: "跑 pnpm test", checks: checks), projectName: "acme-web")
    #expect(withChecks.landscapeThirdLine == "测试 ✓ · 构建 ✓")
    let summary = BoardCard(session: session("b", .running, activity: 1, action: "跑 pnpm test"), projectName: "acme-web")
    #expect(summary.landscapeThirdLine == "跑 pnpm test")
    // 空闲 and 待审阅 have nothing running: what it last replied (the desktop's `summaryOf`).
    let idle = BoardCard(session: session("c", .idle, activity: 1, reply: "已回复：可以先从这一版开始"), projectName: "acme-web")
    #expect(idle.landscapeThirdLine == "已回复：可以先从这一版开始")
    // Nothing said either way: the status word, so the card still has its three rows.
    let quiet = BoardCard(session: session("e", .idle, activity: 1), projectName: "acme-web")
    #expect(quiet.landscapeThirdLine == "空闲")
    // A PR's `+N −M` never reaches a landscape card: the third row is the only thing after 项目 › 分支.
    let stat = BoardCard(session: session("d", .running, activity: 1, action: "跑测试", stat: RemoteStat(added: 12, removed: 3)), projectName: "acme-web")
    #expect(stat.landscapeThirdLine == "跑测试")
    #expect(statText(RemoteStat(added: 12, removed: 3)) == "+12 −3")
  }
}

@Suite struct GitHubBoardTests {
  private let repo = GitHubRepo(host: "github.com", owner: "acme", name: "web")
  private let issue = BoardItem(kind: "issue", number: 142, title: "登录后刷新页面会丢失会话", url: "https://github.com/acme/web/issues/142",
    author: "lin-wei", labels: ["bug"], comments: 3, updatedAt: now - 2 * 3_600_000)
  private let pr = BoardPr(kind: "pr", number: 145, title: "fix(auth): 刷新 token 前先检查过期时间", url: "https://github.com/acme/web/pull/145",
    author: "mira", labels: ["auth"], comments: 2, updatedAt: now - 40 * 60_000, draft: false, review: "changes-requested",
    reviewRequestedFromMe: true, checks: ChecksSummary(state: "failing", total: 4, passed: 2, pending: 1,
      failing: [CheckSummaryFailure(name: "e2e", runId: 1, jobId: 2)]))
  private let board = GitHubBoard(gh: "ready", projects: [
    .init(project: "p1", board: BoardProject(state: "ok", repo: GitHubRepo(host: "github.com", owner: "acme", name: "web"),
      issues: nil, prs: nil, fetchedAt: now, message: nil)),
    .init(project: "p2", board: BoardProject(state: "not-github", repo: nil, issues: nil, prs: nil, fetchedAt: nil, message: nil))
  ])

  private func withRows() -> GitHubBoard {
    GitHubBoard(gh: "ready", projects: [
      .init(project: "p1", board: BoardProject(state: "ok", repo: repo, issues: [issue], prs: [pr], fetchedAt: now, message: nil)),
      .init(project: "p2", board: BoardProject(state: "not-github", repo: nil, issues: nil, prs: nil, fetchedAt: nil, message: nil))
    ])
  }

  @Test func projectsKeepTheMacsOrderAndItsNames() {
    let sections = boardSections(withRows(), projects: projects, sessions: [], scope: .all)
    #expect(sections.map(\.name) == ["acme-web", "terminal-reborn"])
    #expect(sections.map(\.repo) == ["acme/web", nil])
    #expect(sections[0].issues.map(\.item.number) == [142])
    #expect(sections[0].prs.map(\.item.number) == [145])
    #expect(sections[1].state == "not-github")
    #expect(sections[1].repo == nil)
  }

  @Test func reviewScopeHasNoIssues() {
    let sections = boardSections(withRows(), projects: projects, sessions: [], scope: .review)
    #expect(sections[0].issues.isEmpty)
    #expect(sections[0].prs.count == 1)
  }

  @Test func aSessionWorkingOnAnItemIsFoundWhateverTheReposCase() {
    let linked = session("s", .running, activity: 9, github: GitHubLink(repo: "GitHub.com/ACME/web", kind: "issue", number: 142))
    let sections = boardSections(withRows(), projects: projects, sessions: [linked], scope: .all)
    #expect(sections[0].issues[0].session?.id == "s")
    #expect(sections[0].prs[0].session == nil)
    // Two sessions on one item: the one active last.
    let older = session("old", .running, activity: 3, github: GitHubLink(repo: "github.com/acme/web", kind: "issue", number: 142))
    let both = boardSections(withRows(), projects: projects, sessions: [older, linked], scope: .all)
    #expect(both[0].issues[0].session?.id == "s")
  }

  @Test func rowsSayLabelsTagsChecksAndComments() {
    let sections = boardSections(withRows(), projects: projects, sessions: [], scope: .all)
    let issueRow = sections[0].issues[0]
    #expect(rowMeta(issueRow).map(\.text) == ["bug", "3 条评论"])
    let prRow = sections[0].prs[0]
    let tags = prTags(pr)
    #expect(tags.map(\.text) == ["待你审阅"])
    #expect(tags.first?.tone == .attention)
    let mark = checksMeta(pr)
    #expect(mark?.mark == .x)
    #expect(mark?.text == "1 失败")
    #expect(rowMeta(prRow).map(\.text) == ["auth", "待你审阅", "1 失败", "2 条评论"])
    // A session on the item takes the comments' place (the row says 处理中 instead).
    let linked = session("s", .running, activity: 9, github: GitHubLink(repo: "github.com/acme/web", kind: "issue", number: 142))
    #expect(rowMeta(boardSections(withRows(), projects: projects, sessions: [linked], scope: .all)[0].issues[0]).map(\.text) == ["bug"])
  }

  @Test func checkMarksMatchTheDesktops() {
    func pr(_ state: String, failing: Int = 0) -> BoardPr {
      BoardPr(kind: "pr", number: 1, title: "t", url: "u", author: "a", labels: [], comments: 0, updatedAt: 0, draft: false,
        review: nil, reviewRequestedFromMe: false,
        checks: ChecksSummary(state: state, total: 1, passed: 1, pending: 0, failing: (0..<failing).map { _ in CheckSummaryFailure(name: "c", runId: nil, jobId: nil) }))
    }
    #expect(checksMeta(pr("none")) == nil)
    #expect(checksMeta(pr("passing"))?.mark == .check)
    #expect(checksMeta(pr("pending"))?.mark == .circle)
    #expect(checksMeta(pr("failing", failing: 2))?.text == "2 失败")
    #expect(checksMeta(pr("failing", failing: 2))?.mark == .x)
  }

  @Test func aProjectThatCannotBeReadSaysWhy() {
    let failed = GitHubBoard(gh: "ready", projects: [
      .init(project: "p1", board: BoardProject(state: "error", repo: nil, issues: nil, prs: nil, fetchedAt: nil, message: "rate limited"))
    ])
    let sections = boardSections(failed, projects: projects, sessions: [], scope: .all)
    #expect(sections[0].state == "error")
    #expect(sections[0].message == "rate limited")
  }
}

@Suite struct GitHubItemTests {
  private func detail(_ kind: String, pr: BoardDetailPr? = nil) -> BoardDetail {
    BoardDetail(kind: kind, repo: GitHubRepo(host: "github.com", owner: "acme", name: "web"), number: 142,
      title: "登录后刷新页面会丢失会话", url: "https://github.com/acme/web/issues/142", state: "open", author: "jacob",
      createdAt: now - 3 * 24 * 3_600_000, labels: ["bug"], assignees: ["jacob"], body: "复现步骤\n\n1. 登录后打开设置",
      comments: [BoardComment(author: "mira", createdAt: now - 2 * 3_600_000, body: "Safari 和 Chrome 都能复现。")],
      commentCount: 3, pr: pr)
  }

  @Test func agesAndTheLineUnderATitle() {
    #expect(ageText(now - 30_000, now: now) == "刚刚")
    #expect(ageText(now - 12 * 60_000, now: now) == "12 分钟前")
    #expect(ageText(now - 5 * 3_600_000, now: now) == "5 小时前")
    #expect(ageText(now - 3 * 24 * 3_600_000, now: now) == "3 天前")
    #expect(detailMetaText(detail("issue"), now: now) == "打开 · jacob 3 天前 · bug · 指派给 jacob")
    #expect(detailStateText("merged") == "已合并")
    #expect(detailStateText("closed") == "已关闭")
  }

  @Test func aPullRequestsBranchSizeAndChecks() {
    let pr = BoardDetailPr(draft: false, headRef: "mira/token-expiry", baseRef: "main", crossRepo: false, additions: 42,
      deletions: 18, changedFiles: 3, review: "review-required", checks: [
        .init(name: "lint", verdict: "passed", startedAt: now - 300_000, completedAt: now - 300_000 + 72_000),
        .init(name: "e2e", verdict: "failed", startedAt: now - 900_000, completedAt: now - 12 * 60_000),
        .init(name: "build", verdict: "pending", startedAt: nil, completedAt: nil)
      ])
    #expect(detailBranchText(pr) == "mira/token-expiry → main · +42 −18 · 3 个文件")
    #expect(detailMetaText(detail("pr", pr: pr), now: now) == "打开 · jacob 3 天前 · bug · 待你审阅 · 指派给 jacob")
    #expect(checkRightText(pr.checks[0], now: now) == "1m 12s")
    #expect(checkRightText(pr.checks[1], now: now) == "12 分钟前失败")
    #expect(checkRightText(pr.checks[2], now: now) == "进行中")
  }
}

@Suite struct OldMacTests {
  @Test func theMacsInvalidRequestIsAnOldWavi() {
    // src/main/remote/server.ts answers `pick(M).invalid` to a command it does not parse.
    #expect(isInvalidRequest("无效的请求"))
    #expect(isInvalidRequest("Invalid request"))
    #expect(!isInvalidRequest("超时"))
    #expect(!isInvalidRequest("没有连上 Mac"))
    #expect(!isInvalidRequest("rate limited"))
  }
}

@Suite struct BoardReviewRound1Tests {
  // Item 3: switching tabs must re-watch the session left open in the first tab.
  @Test func theOpenSessionIsTheOneOfTheTabOnScreen() {
    let path: [Route] = [.session("a"), .changes("a")]
    let boardPath: [Route] = [.session("b")]
    #expect(openSession(tab: .sessions, path: path, boardPath: boardPath) == "a")
    #expect(openSession(tab: .board, path: path, boardPath: []) == nil)
    #expect(openSession(tab: .board, path: path, boardPath: boardPath) == "b")
    #expect(openSession(tab: .sessions, path: [], boardPath: boardPath) == nil)
  }

  // Item 4: the answer of a scope no longer on screen is dropped and leaves the spinner for the request still wanted.
  @Test func anAnswerForAnotherScopeIsDropped() {
    var request = BoardRequest()
    request.begin("all")
    request.begin("review")
    #expect(request.loading)
    let stale = request.settle("all")
    #expect(!stale)
    #expect(request.loading)
    let wanted = request.settle("review")
    #expect(wanted)
    #expect(!request.loading)
  }

  // Item 7: only the server's invalid-request text means an old Mac.
  @Test func onlyTheInvalidRequestTextMeansAnOldMac() {
    #expect(detailFailure("无效的请求") == String(localized: "Mac 上的 Wavi 要更新"))
    #expect(detailFailure("Invalid request") == String(localized: "Mac 上的 Wavi 要更新"))
    #expect(detailFailure(nil) == String(localized: "没有读到"))
    #expect(detailFailure("") == String(localized: "没有读到"))
    #expect(detailFailure(nil) != String(localized: "Mac 上的 Wavi 要更新"))
    #expect(detailFailure("gh 没有登录") == "gh 没有登录")
  }
}

// PRD v1.243: the board's sections keep every session; a member's card stays in its own status section.
@Suite struct BoardGroupFoldTests {
  @Test func aMembersCardStaysInItsOwnSection() {
    var kid = session("kid", .needsYou, activity: 5, since: 5)
    kid.parentId = "parent"
    var parent = session("parent", .running, activity: 9)
    parent.group = RemoteGroup(total: 1, counts: [.init(status: .needsYou, count: 1)], members: [
      RemoteMember(id: "kid", kind: .session, title: "kid", status: .needsYou, meta: nil)
    ])
    let groups = boardGroups(RemoteSessionList(projects: projects, sessions: [parent, kid]))
    #expect(groups.map(\.key) == [.needsYou, .running])
    #expect(groups.map { $0.cards.map(\.id) } == [["kid"], ["parent"]])
    #expect(groups[1].cards[0].session.group?.total == 1)
  }
}
