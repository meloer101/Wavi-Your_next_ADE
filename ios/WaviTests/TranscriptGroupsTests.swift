// TranscriptGroups.swift: consecutive tool calls fold into one line, a finished turn that changed files ends with its
// totals, answers are left where they happened (Figma 62E).
import Foundation
import Testing
@testable import Wavi

private func user(_ id: String, at: Double) -> ChatItem { ChatItem(kind: "user", id: id, at: at, text: "go") }
private func text(_ id: String, at: Double) -> ChatItem { ChatItem(kind: "text", id: id, at: at, text: "done") }
private func tool(_ id: String, _ name: String, _ arg: String, at: Double, state: String = "ok", added: Int = 0, removed: Int = 0) -> ChatItem {
  let diff = added + removed > 0 ? ToolDiff(path: arg, hunks: [], added: added, removed: removed, truncated: false) : nil
  return ChatItem(kind: "tool", id: id, at: at, name: name, arg: arg, state: state, diff: diff)
}

@Suite struct TranscriptGroupsTests {
  @Test func consecutiveToolCallsFoldIntoOneLine() {
    let items = [user("u", at: 1), tool("a", "Read", "a.ts", at: 2), tool("b", "Read", "b.ts", at: 3), tool("c", "Grep", "x", at: 4), tool("d", "Bash", "pnpm test", at: 5), text("t", at: 6), tool("e", "Read", "c.ts", at: 7)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: true)
    #expect(blocks.map(\.id) == ["u", "run-a", "t", "e"])
    guard case .tools(let run) = blocks[1] else { Issue.record("no run"); return }
    #expect(run.summary == "读了 2 个文件，搜索了 1 次，跑了 1 条命令")
    #expect(run.items.map(\.id) == ["a", "b", "c", "d"])
    #expect(!run.running)
  }

  @Test func aFinishedTurnThatChangedFilesEndsWithItsTotals() {
    let items = [user("u1", at: 1), tool("a", "Edit", "a.ts", at: 2, added: 10, removed: 2), tool("b", "Edit", "a.ts", at: 3, added: 4), tool("c", "Write", "b.ts", at: 4, added: 20),
      text("t", at: 5), user("u2", at: 6), tool("d", "Edit", "c.ts", at: 7, state: "running", added: 1)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: true)
    #expect(blocks.map(\.id) == ["u1", "fold-a", "t", "turn-u1", "u2", "d"])
    guard case .turn(let turn) = blocks[3], case .fold(let fold) = blocks[1], case .reply(let reply, let meta) = blocks[2] else { Issue.record("no turn"); return }
    #expect(turn == TurnChange(id: "turn-u1", files: 2, added: 34, removed: 2, tools: ["a", "b", "c"], reply: text("t", at: 5)))
    #expect(fold.entries.map(\.id) == ["a", "b", "c"])
    #expect(reply.id == "t")
    // The turn has totals: its time and copy go under them, not under the reply.
    #expect(!meta)
    // The open turn (the agent is still at it) has none yet, and is not folded.
    #expect(!blocks.contains { $0.id == "turn-u2" })
  }

  @Test func theLastTurnGetsItsTotalsOnceTheAgentStops() {
    let items = [user("u1", at: 1), tool("a", "Edit", "a.ts", at: 2, added: 3, removed: 1), text("t", at: 3)]
    #expect(transcriptBlocks(items, receipts: [], turnOpen: false).map(\.id) == ["u1", "fold-a", "t", "turn-u1"])
    #expect(transcriptBlocks(items, receipts: [], turnOpen: true).map(\.id) == ["u1", "a", "t"])
  }

  @Test func answersSitWhereTheyHappened() {
    let items = [user("u", at: 1), tool("a", "Bash", "pnpm add -D msw", at: 2), tool("b", "Bash", "pnpm test", at: 10)]
    let receipt = Receipt(id: "r1", at: 5, onPhone: true, text: "在这台手机上允许 · pnpm add -D msw")
    let blocks = transcriptBlocks(items, receipts: [receipt], turnOpen: true)
    // The answer splits the run: the call before it and the one after stay single rows.
    #expect(blocks.map(\.id) == ["u", "a", "r1", "b"])
  }

  @Test func answersAfterTheLastItemKeepTheirOrder() {
    let items = [user("u", at: 1), text("t", at: 2)]
    let first = Receipt(id: "r1", at: 5, onPhone: true, text: "a")
    let second = Receipt(id: "r2", at: 9, onPhone: false, text: "b")
    #expect(transcriptBlocks(items, receipts: [second, first], turnOpen: true).map(\.id) == ["u", "t", "r1", "r2"])
  }

  @Test func receiptWordsSayWhereAndWhat() {
    let permission = RemotePrompt(kind: "permission", id: "p", sessionId: "s", createdAt: 0, answerable: true, tool: "Bash", summary: "pnpm add -D msw")
    #expect(receiptText(permission, decision: "allow-once", onPhone: true) == "在这台手机上允许 · pnpm add -D msw")
    #expect(receiptText(permission, decision: "deny", onPhone: true) == "在这台手机上拒绝 · pnpm add -D msw")
    #expect(receiptText(permission, decision: nil, onPhone: false) == "在 Mac 上处理 · pnpm add -D msw")
    let q = AgentQuestion(header: nil, question: "用哪种存储？", multiSelect: false, options: [])
    let question = RemotePrompt(kind: "question", id: "q", sessionId: "s", createdAt: 0, answerable: true, questions: [q])
    #expect(receiptText(question, decision: nil, onPhone: false) == "在 Mac 上回答 · 用哪种存储？")
  }

  @Test func aFinishedTurnFoldsItsProcessAndKeepsTheLastText() {
    let items = [user("u", at: 1000), ChatItem(kind: "thinking", id: "k", at: 2000, text: "hm", ms: 1000), tool("a", "Read", "a.ts", at: 3000), tool("b", "Grep", "x", at: 4000),
      text("t1", at: 5000), tool("c", "Bash", "ls", at: 6000), text("t2", at: 76000)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: false)
    #expect(blocks.map(\.id) == ["u", "fold-k", "t2"])
    guard case .fold(let fold) = blocks[1], case .reply(_, let meta) = blocks[2] else { Issue.record("shape"); return }
    // No totals: the time and copy stay under the reply.
    #expect(meta)
    // No ToolRun inside, the first text with the rest of the process, in order.
    #expect(fold.entries.map(\.id) == ["k", "a", "b", "t1", "c"])
    #expect(fold.ms == 75000)
  }

  @Test func aTurnEndingWithAToolHasAFoldAndNoReply() {
    let items = [user("u", at: 1000), text("t", at: 2000), tool("a", "Read", "a.ts", at: 5000)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: false)
    #expect(blocks.map(\.id) == ["u", "fold-t"])
    guard case .fold(let fold) = blocks[1] else { Issue.record("no fold"); return }
    #expect(fold.entries.map(\.id) == ["t", "a"])
    #expect(fold.ms == 4000)
  }

  @Test func aTurnOfOnlyATextHasNoFold() {
    let blocks = transcriptBlocks([user("u", at: 1), text("t", at: 2)], receipts: [], turnOpen: false)
    #expect(blocks.map(\.id) == ["u", "t"])
    guard case .reply(_, let meta) = blocks[1] else { Issue.record("no reply"); return }
    #expect(meta)
  }

  @Test func theOpenLastTurnIsNotFolded() {
    let items = [user("u", at: 1), tool("a", "Read", "a.ts", at: 2), tool("b", "Read", "b.ts", at: 3), text("t", at: 4)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: true)
    #expect(blocks.map(\.id) == ["u", "run-a", "t"])
    guard case .item = blocks[2] else { Issue.record("a reply in an open turn"); return }
  }

  @Test func aReceiptInAFinishedTurnLandsInsideTheFold() {
    let items = [user("u", at: 1), tool("a", "Bash", "pnpm add", at: 2), tool("b", "Bash", "pnpm test", at: 10), text("t", at: 12)]
    let receipt = Receipt(id: "r1", at: 5, onPhone: true, text: "x")
    let blocks = transcriptBlocks(items, receipts: [receipt], turnOpen: false)
    #expect(blocks.map(\.id) == ["u", "fold-a", "t"])
    guard case .fold(let fold) = blocks[1] else { Issue.record("no fold"); return }
    #expect(fold.entries.map(\.id) == ["a", "r1", "b"])
  }

  @Test func aTurnWithoutItsUserMessageIsMeasuredFromItsFirstEntry() {
    let items = [tool("a", "Read", "a.ts", at: 1000), text("t", at: 4000)]
    let blocks = transcriptBlocks(items, receipts: [], turnOpen: false)
    #expect(blocks.map(\.id) == ["fold-a", "t"])
    guard case .fold(let fold) = blocks[0] else { Issue.record("no fold"); return }
    #expect(fold.ms == 3000)
  }

  @Test func workedForSaysSecondsMinutesAndHours() {
    #expect(workedFor(59_000) == "工作了 59 秒")
    #expect(workedFor(75_000) == "工作了 1 分 15 秒")
    #expect(workedFor(3_725_000) == "工作了 1 小时 2 分")
  }

  @Test func messageTimeIsTheTimeTodayAndTheDateBefore() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let locale = Locale(identifier: "en_GB")
    func ms(_ day: Int, _ hour: Int, _ minute: Int) -> Double {
      calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!.timeIntervalSince1970 * 1000
    }
    let now = ms(23, 20, 0)
    #expect(messageTime(ms(23, 19, 41), now: now, calendar: calendar, locale: locale) == "19:41")
    #expect(messageTime(ms(22, 19, 41), now: now, calendar: calendar, locale: locale).contains("22"))
    #expect(messageTime(ms(22, 19, 41), now: now, calendar: calendar, locale: locale).contains("19:41"))
    #expect(messageTime(ms(22, 19, 41), now: now, calendar: calendar, locale: locale) != "19:41")
  }

  @Test func aReceiptAfterTheFinalTextDoesNotTakeTheReplyAway() {
    let items = [user("u", at: 1), tool("a", "Read", "a.ts", at: 2), text("t", at: 3)]
    let receipt = Receipt(id: "r1", at: 5, onPhone: true, text: "x")
    let blocks = transcriptBlocks(items, receipts: [receipt], turnOpen: false)
    #expect(blocks.map(\.id) == ["u", "fold-a", "t"])
    guard case .fold(let fold) = blocks[1], case .reply = blocks[2] else { Issue.record("shape"); return }
    #expect(fold.entries.map(\.id) == ["a", "r1"])
  }
}
