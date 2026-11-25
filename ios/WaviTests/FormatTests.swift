// Format.swift, with the cases of the Expo app's model.test.ts.
import Foundation
import Testing
@testable import Wavi

private func text(_ n: Int, _ t: String? = nil) -> ChatItem { ChatItem(kind: "text", id: "i\(n)", at: 0, text: t ?? "t\(n)") }

private func session(_ id: String = "s", project: String = "p1", status: SessionStatus = .idle, since: Double? = nil, activity: Double = 0) -> RemoteSession {
  RemoteSession(id: id, projectId: project, title: "x", agent: "claude", status: status, action: nil, since: since, activity: activity, branch: nil, model: nil, reply: nil, ship: nil, shipNotice: nil)
}

@Suite struct FormatTests {
  @Test func feedStartsExtendsAndRewritesItsEnd() {
    var feed = applyFeed(nil, start: 50, items: [text(50), text(51)])
    feed = applyFeed(feed, start: 52, items: [text(52)])
    #expect(feed.items.map(\.id) == ["i50", "i51", "i52"])
    feed = applyFeed(feed, start: 52, items: [text(52, "changed"), text(53)])
    #expect(feed == Feed(start: 50, items: [text(50), text(51), text(52, "changed"), text(53)]))
  }

  @Test func staleNoticeSaysHowOldTheListIs() {
    let now = 10_000_000.0
    #expect(staleNotice(heardAt: now - 20_000, now: now) == "显示的是 1 分钟内的状态")
    #expect(staleNotice(heardAt: now - 12 * 60_000, now: now) == "显示的是 12 分钟前的状态")
    #expect(staleNotice(heardAt: now - 125 * 60_000, now: now) == "显示的是 2 小时前的状态")
    #expect(staleNotice(heardAt: nil, now: now) == "显示的不是最新的状态")
  }

  @Test func aPlanSplitsIntoTheNameItsFirstHeadingGivesAndTheRest() {
    // The Mac's plan card splits it the same way (src/renderer/gui/model.ts planParts); the phone's sheet puts the
    // name under a head that already says 等你确认计划 (Figma 100A / 100B), so no 「计划：」 stands in front of it.
    let headed = planParts("## 计划：登录改成 Set-Cookie\n\n1. 读 cookie\n2. 删 localStorage\n")
    #expect(headed.title == "登录改成 Set-Cookie")
    #expect(headed.named)
    #expect(headed.body == "1. 读 cookie\n2. 删 localStorage")
    // The agent's own heading prefix goes, in either language, and any heading level counts.
    #expect(planParts("# Plan: migrate auth\nbody").title == "migrate auth")
    #expect(planParts("### 会话续期\nbody").title == "会话续期")
    // No heading: 计划, and the whole text stays as the body (blank lines in front dropped).
    let unheaded = planParts("\n\n先看看 auth.ts，再改登录。\n第二步")
    #expect(unheaded.title == "计划")
    #expect(!unheaded.named)
    #expect(unheaded.body == "先看看 auth.ts，再改登录。\n第二步")
    // A heading with nothing after the prefix is just 计划, and an empty plan asks nothing.
    #expect(planParts("## 计划：\nstep").title == "计划")
    #expect(planParts("## 计划：\nstep").body == "step")
    #expect(planParts("") == PlanParts(title: "计划", body: "", named: false))
    #expect(planParts("\r\n## 标题\r\nbody").body == "body")
    // The line without a head above it (a receipt) keeps the 「计划：<name>」 form; nothing named stays 「计划」.
    #expect(headed.namedTitle == "计划：登录改成 Set-Cookie")
    #expect(unheaded.namedTitle == "计划")
  }

  @Test func aPlansReceiptNamesThePlanWhereAQuestionNamesItsText() {
    // The receipt line reads a permission's summary or a question's text (TranscriptGroups.swift receiptText).
    let plan = RemotePrompt(kind: "plan", id: "s1:p", sessionId: "s1", createdAt: 0, answerable: true, plan: "## 登录迁移\n1. 读 cookie")
    #expect(receiptNaming(plan).questions?.first?.question == "计划：登录迁移")
    #expect(receiptText(receiptNaming(plan), decision: nil, onPhone: true) == "在这台手机上回答 · 计划：登录迁移")
    let question = RemotePrompt(kind: "question", id: "s1:q", sessionId: "s1", createdAt: 0, answerable: true,
      questions: [AgentQuestion(header: nil, question: "按什么排序？", multiSelect: false, options: [])])
    #expect(receiptNaming(question) == question)
  }

  @Test func connectionLineSaysWhatIsWrong() {
    let mac = "MacBook Pro"
    #expect(connectionWords(.open(url: "ws://100.101.1.2:7429"), mac: mac, dropped: false) == ConnectionWords(text: "MacBook Pro · Tailscale", tone: .quiet))
    #expect(connectionWords(.connecting, mac: mac, dropped: false).text == "正在连接 MacBook Pro")
    #expect(connectionWords(.connecting, mac: mac, dropped: true).text == "连接断了，正在重连")
    #expect(connectionWords(.offline(.macAsleep), mac: mac, dropped: true) == ConnectionWords(text: "MacBook Pro 已睡眠或离线", tone: .warning))
    #expect(connectionWords(.offline(.waviNotRunning), mac: mac, dropped: true).text == "Mac 上的 Wavi 没有打开")
    #expect(connectionWords(.offline(.tailscaleOff), mac: mac, dropped: true).text == "连不上 · 检查这台手机的 Tailscale")
    #expect(connectionWords(.offline(.macOutdated), mac: mac, dropped: true).text == "Mac 上的 Wavi 需要更新")
    #expect(connectionWords(.offline(.phoneOutdated), mac: mac, dropped: true).text == "这台手机上的 Wavi 需要更新")
    #expect(connectionWords(.refused, mac: mac, dropped: false) == ConnectionWords(text: "MacBook Pro 不认识这台手机", tone: .danger))
  }

  @Test func feedResetsOnResetOrGap() {
    let feed = Feed(start: 0, items: [text(0)])
    #expect(applyFeed(feed, start: 0, items: [], reset: true) == Feed(start: 0, items: []))
    #expect(applyFeed(feed, start: 5, items: [text(5)]) == Feed(start: 5, items: [text(5)]))
  }

  @Test func olderPageGoesInFrontOnlyWhenItEndsAtTheStart() {
    let feed = Feed(start: 2, items: [text(2)])
    #expect(prependFeed(feed, start: 0, items: [text(0), text(1)]).items.count == 3)
    #expect(prependFeed(feed, start: 0, items: [text(0)]) == feed)
  }

  @Test func groupsWaitingFirstThenProjectsNewestFirst() {
    let groups = groupSessions(RemoteSessionList(
      projects: [.init(id: "p1", name: "acme-web"), .init(id: "p2", name: "terminal-reborn"), .init(id: "p3", name: "empty")],
      sessions: [
        session("a", activity: 1), session("b", activity: 5),
        session("w1", project: "p2", status: .needsYou, since: 300), session("w2", status: .needsYou, since: 100),
        session("c", project: "p2", activity: 2)
      ]))
    #expect(groups.map(\.title) == ["等你处理", "acme-web", "terminal-reborn"])
    #expect(groups.map { $0.rows.map(\.session.id) } == [["w1", "w2"], ["b", "a"], ["c"]])
    #expect(groups[0].rows[1].projectName == "acme-web")
    #expect(groups[1].rows[0].projectName == nil)
  }

  @Test func shortAgesAndRowTime() {
    #expect([shortAge(40_000), shortAge(180_000), shortAge(7_200_000), shortAge(200_000_000)] == ["40s", "3m", "2h", "2d"])
    #expect(rowTime(session(status: .needsYou, since: 0), now: 120_000) == "已等 2m")
    #expect(rowTime(session(activity: 0), now: 60_000) == "1m")
  }

  @Test func runClockReadsTenthsThenMinutesThenHours() {
    #expect([runClock(0), runClock(4321), runClock(59_999), runClock(65_000), runClock(3_725_000), runClock(-5)]
      == ["0.0s", "4.3s", "59.9s", "1m 05s", "1h 02m", "0.0s"])
  }

  @Test func runRowComesWithTheMessageAndGoesWhenTheTurnEnds() {
    let sent = ChatItem(kind: "user", id: "sending-1", at: 900)
    // Sent from the phone, before the Mac says the turn runs: the agent's mark and 思考中, counted from the send.
    let fresh = runRow(session: session(status: .idle), turnStart: nil, sending: [sent], lastIsUser: false)
    #expect(fresh == RunRow(action: nil, since: 900, startsTurn: true))
    // Running: what the agent does now, counted from the turn's start; the mark only right after the user's message,
    // not under a message the phone sent meanwhile (it waits on the Mac).
    let running = RemoteSession(id: "s", projectId: "p1", title: "x", agent: "claude", status: .running,
      action: "运行 npm test", since: 3000, activity: 0, branch: nil, model: nil, reply: nil, ship: nil, shipNotice: nil)
    #expect(runRow(session: running, turnStart: 1000, sending: [], lastIsUser: false) == RunRow(action: "运行 npm test", since: 1000, startsTurn: false))
    #expect(runRow(session: running, turnStart: 1000, sending: [sent], lastIsUser: false)?.startsTurn == false)
    #expect(runRow(session: running, turnStart: nil, sending: [], lastIsUser: true) == RunRow(action: "运行 npm test", since: 3000, startsTurn: true))
    // No status time from the Mac: its last activity, never the epoch.
    #expect(runRow(session: session(status: .running, activity: 2500), turnStart: nil, sending: [], lastIsUser: false)?.since == 2500)
    // Waiting on the user (the sheet says so) or not running: none.
    #expect(runRow(session: session(status: .needsYou, since: 1000), turnStart: 1000, sending: [], lastIsUser: false) == nil)
    #expect(runRow(session: session(status: .idle), turnStart: nil, sending: [], lastIsUser: true) == nil)
  }

  @Test func turnStartHoldsThroughAnAnswerAndEndsWithTheTurn() {
    var starts = nextTurnStarts([:], sessions: [session(status: .running, since: 1000)])
    #expect(starts == ["s": 1000])
    starts = nextTurnStarts(starts, sessions: [session(status: .needsYou, since: 4000)])
    starts = nextTurnStarts(starts, sessions: [session(status: .running, since: 6000)])
    #expect(starts == ["s": 1000])
    #expect(nextTurnStarts(starts, sessions: [session(status: .doneUnread, since: 9000)]).isEmpty)
  }

  @Test func connectionPathsAndLastLine() {
    #expect(viaOf("ws://100.101.2.3:7429") == "Tailscale")
    #expect(viaOf("ws://100.20.2.3:7429") == "局域网")
    #expect(viaOf("ws://192.168.1.5:7429") == "局域网")
    #expect(splitPath("src/auth/session.ts") == ("session.ts", "src/auth/"))
    #expect(lastLine("a\n✓ 12 passed (1.4s)\n\n") == "✓ 12 passed (1.4s)")
    #expect(lastLine(nil) == nil)
  }

  @Test func numbersStructuredPatchHunks() {
    let rows = hunkRows([DiffHunk(oldStart: 12, newStart: 12, lines: [" a", "-b", "+c", "+d", " e"])])
    #expect(rows[0] == .hunk("@@ -12,3 +12,4 @@"))
    #expect(Array(rows.dropFirst()) == [
      .line(sign: " ", old: 12, new: 12, code: "a"), .line(sign: "-", old: 13, new: nil, code: "b"),
      .line(sign: "+", old: nil, new: 13, code: "c"), .line(sign: "+", old: nil, new: 14, code: "d"),
      .line(sign: " ", old: 14, new: 15, code: "e")
    ])
  }

  @Test func readsGitDiffText() {
    let rows = unifiedRows("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\n\\ No newline at end of file\n")
    #expect(rows == [.hunk("@@ -1,2 +1,2 @@ fn"), .line(sign: " ", old: 1, new: 1, code: "a"), .line(sign: "-", old: 2, new: nil, code: "b"), .line(sign: "+", old: nil, new: 2, code: "c")])
  }

  @Test func permissionSheetText() {
    #expect(permissionTitle("Bash") == "运行命令")
    #expect(permissionTitle("mcp__x") == "使用 mcp__x")
    #expect(permissionSubject(["command": .string("pnpm add -D msw"), "description": .string("x")], summary: "s") == "pnpm add -D msw")
    #expect(permissionSubject([:], summary: "运行 x") == "运行 x")
    #expect(allowAlwaysLabel([PermissionRule(tool: "Bash", content: "pnpm add:*")]) == "总是允许 pnpm add")
    #expect(allowAlwaysLabel([PermissionRule(tool: "WebFetch", content: "domain:example.com"), PermissionRule(tool: "Bash", content: nil)]) == "总是允许 example.com 等 2 项")
    #expect(allowAlwaysLabel(nil) == "总是允许")
  }

  @Test func branchNamesAvoidTakenOnes() {
    let name = generateBranchName(prefix: "jacob", taken: [])
    #expect(name.hasPrefix("jacob/"))
    #expect(name.split(separator: "/")[1].split(separator: "-").count >= 2)
  }

  @Test func decodesWhatTheMacSends() throws {
    let json = #"{"id":"s1","projectId":"p1","title":"导航","agent":"claude","status":"weird","activity":1,"extra":true}"#
    let s = try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
    #expect(s.status == .idle)
    #expect(SessionStatus.needsYou.label == "等你处理")
    let item = try JSONDecoder().decode(ChatItem.self, from: Data(#"{"kind":"tool","id":"t","at":2,"name":"Edit","arg":"a.ts","state":"ok","diff":{"path":"a.ts","hunks":[],"added":1,"removed":0,"truncated":false}}"#.utf8))
    #expect(item.diff?.added == 1)
    let fields = PhoneCommand.diff(session: "s", path: "a", scope: "committed", oldPath: nil, untracked: true).fields
    #expect(fields["untracked"] == .bool(true))
    #expect(fields["oldPath"] == nil)
  }

  // PRD v1.243: a session under a listed parent is no row of its project; it stays in 等你处理 while it needs the user.
  @Test func aMemberOfAListedParentIsNoProjectRow() {
    func child(_ id: String, _ status: SessionStatus, parent: String) -> RemoteSession {
      var s = session(id, status: status, activity: 1)
      s.parentId = parent
      return s
    }
    let list = RemoteSessionList(projects: [.init(id: "p1", name: "acme-web")], sessions: [
      session("parent", activity: 9), child("kid", .running, parent: "parent"), child("asking", .needsYou, parent: "parent"),
      child("orphan", .idle, parent: "gone")
    ])
    let groups = groupSessions(list)
    #expect(groups.map(\.title) == ["等你处理", "acme-web"])
    #expect(groups[0].rows.map(\.session.id) == ["asking"])
    // A parent that is not listed leaves the session where it was.
    #expect(groups[1].rows.map(\.session.id) == ["parent", "orphan"])
  }

  @Test func foldMembersFollowTheMacsOrderAndResolveSessionMembers() {
    var parent = session("parent")
    parent.group = RemoteGroup(total: 2, counts: [.init(status: .running, count: 2)], members: [
      RemoteMember(id: "kid", kind: .session, title: "kid", status: .running, meta: nil),
      RemoteMember(id: "a1", kind: .subagent, title: "scan", status: .running, meta: "Opus 5.5")
    ])
    let list = RemoteSessionList(projects: [], sessions: [parent, session("kid")])
    let members = foldMembers(of: parent, in: list)
    #expect(members.map(\.id) == ["kid", "a1"])
    #expect(members[0].session?.id == "kid" && members[1].session == nil)
    #expect(foldMembers(of: session("kid"), in: list).isEmpty)
  }

  @Test func openFoldsToggleAndForgetSessionsThatAreGone() {
    var raw = ""
    raw = FoldOpen.toggled(raw, "a")
    raw = FoldOpen.toggled(raw, "b")
    #expect(FoldOpen.ids(raw) == ["a", "b"])
    #expect(FoldOpen.ids(FoldOpen.toggled(raw, "a")) == ["b"])
    #expect(FoldOpen.ids(FoldOpen.pruned(raw, keeping: ["b", "c"])) == ["b"])
    #expect(FoldOpen.ids("") .isEmpty)
  }
}
