// The context ring's text (PRD F22 v1.230 ④): tokens, window labels, reset times and what 「放进 /compact」 does to the
// composer's text. The scheme runs these in Chinese.
import Foundation
import Testing
@testable import Wavi

private var calendar: Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
  return calendar
}

private let zh = Locale(identifier: "zh")
private let en = Locale(identifier: "en")

private func at(_ day: Int, _ hour: Int, _ minute: Int, month: Int = 11) -> Double {
  var parts = DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute)
  parts.timeZone = calendar.timeZone
  return calendar.date(from: parts)!.timeIntervalSince1970 * 1000
}

/// 2026-11-23 (Monday) 10:00 in Shanghai.
private let now = at(23, 10, 0)

@Suite struct ContextTests {
  @Test func tokensHaveOneDecimalBelowTenThousandAndNoneAbove() {
    #expect(tokenText(850) == "850")
    #expect(tokenText(1_000) == "1k")
    #expect(tokenText(1_500) == "1.5k")
    #expect(tokenText(2_049) == "2k")
    #expect(tokenText(9_949) == "9.9k")
    #expect(tokenText(9_950) == "10k")
    #expect(tokenText(10_000) == "10k")
    #expect(tokenText(172_400) == "172k")
    #expect(tokenText(200_000) == "200k")
    #expect(tokenText(1_200_000) == "1.2M")
    #expect(tokenText(12_000_000) == "12M")
    #expect(tokenText(-5) == "0")
  }

  @Test func theTitleNeedsBothCountsAndThePercentIsClamped() {
    #expect(contextTitle(RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: 200_000, markPercent: nil, high: true)) == "172k / 200k")
    #expect(contextTitle(RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: nil, markPercent: nil, high: true)) == nil)
    #expect(percentText(85.6) == "86%")
    #expect(percentText(140) == "100%")
    #expect(percentText(-3) == "0%")
  }

  @Test func windowLabelsFollowTheDesktops() {
    #expect(windowLabel(vendor: "claude", minutes: 300, scope: nil) == "5 小时")
    #expect(windowLabel(vendor: "claude", minutes: 10_080, scope: nil) == "7 天")
    #expect(windowLabel(vendor: "codex", minutes: 10_080, scope: nil) == "每周")
    #expect(windowLabel(vendor: "codex", minutes: 300, scope: nil) == "5 小时")
    #expect(windowLabel(vendor: "claude", minutes: 10_080, scope: "Sonnet") == "7 天 · Sonnet")
    #expect(windowLabel(vendor: "claude", minutes: 90, scope: nil) == "90 分钟")
  }

  @Test func aResetIsTodayThisWeekOrADate() {
    #expect(resetText(at(23, 17, 22), now: now, calendar: calendar, locale: zh) == "17:22 重置")
    #expect(resetText(at(23, 11, 5), now: now, calendar: calendar, locale: zh) == "11:05 重置")
    // Friday 27 Nov is within the week.
    #expect(resetText(at(27, 9, 0), now: now, calendar: calendar, locale: zh) == "周五 9:00 重置")
    #expect(resetText(at(27, 9, 0), now: now, calendar: calendar, locale: en).contains("Fri"))
    // Seven days or more away: month and day, no clock.
    let later = resetText(at(1, 9, 0, month: 12), now: now, calendar: calendar, locale: zh)
    #expect(later == "12月1日重置")
  }

  @Test func theVendorIsNamedNotTheAgent() {
    #expect(vendorName("claude") == "Claude")
    #expect(vendorName("codex") == "Codex")
  }

  @Test func onlyClaudeAndCodexHavePlanWindows() {
    #expect(usageVendor("claude") == "claude")
    #expect(usageVendor("codex") == "codex")
    #expect(usageVendor("gemini") == nil)
    #expect(usageVendor("shell") == nil)
  }

  @Test func insertingReplacesAnEmptyDraftAndAppendsOnANewLineToAWrittenOne() {
    #expect(inserting("/compact", into: "") == "/compact")
    #expect(inserting("/compact", into: "  \n ") == "/compact")
    #expect(inserting("/compact", into: "先看看这个") == "先看看这个\n/compact")
    #expect(inserting("/compact", into: "先看看这个\n") == "先看看这个\n/compact")
  }

  @MainActor @Test func theModelHoldsAnInsertUntilTheComposerTakesIt() {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wavi-context-\(UUID().uuidString)", isDirectory: true)
    let model = AppModel(pairing: nil, cache: PhoneCache(root: root), connects: false)
    model.insert("/compact", into: "s1")
    #expect(model.pendingInsert == ["s1": "/compact"])
    model.insertTaken("s1")
    #expect(model.pendingInsert.isEmpty)
  }
}
