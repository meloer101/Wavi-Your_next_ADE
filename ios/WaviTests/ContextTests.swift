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

private final class Marker {}

/// A list of the vectors the Mac writes into remote-wire-samples.json.
private func vectors(_ key: String) throws -> [JSONValue] {
  let url = try #require(Bundle(for: Marker.self).url(forResource: "remote-wire-samples", withExtension: "json"))
  let root = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
  guard case .object(let all)? = root["vectors"], case .array(let list)? = all[key] else { throw VectorMissing(key: key) }
  return list
}

private struct VectorMissing: Error { let key: String }

/// 2026-11-23 (Monday) 10:00 in Shanghai.
private let now = at(23, 10, 0)

@Suite struct ContextTests {
  /// The desktop's own outputs (src/main/remote/wire-samples.test.ts writes them from `formatTokens`).
  @Test func tokensReadAsTheDesktopsFormatTokensDoes() throws {
    let tokens = try vectors("tokens")
    #expect(tokens.count >= 10)
    for sample in tokens {
      guard case .number(let count)? = sample["count"], let text = sample["text"]?.string else { Issue.record("bad vector \(sample)"); continue }
      #expect(tokenText(count) == text, "tokenText(\(count))")
    }
    #expect(tokenText(-5) == "0")
  }

  @Test func theTitleNeedsBothCountsAndThePercentIsClamped() {
    #expect(contextTitle(RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: 200_000, markPercent: nil, high: true)) == "172k / 200k")
    #expect(contextTitle(RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: nil, markPercent: nil, high: true)) == nil)
    #expect(percentText(85.6) == "86%")
    #expect(percentText(140) == "100%")
    #expect(percentText(-3) == "0%")
  }

  @Test func theGaugeHas40TicksAndTheCompactionPointIsOneOfThem() {
    func marks(_ percent: Double, _ mark: Double?) -> (filled: Int, mark: Int?) { tickMarks(percent: percent, mark: mark) }
    #expect(marks(0, nil).filled == 0)
    #expect(marks(11, nil).filled == 4)
    // Figma 108B: 86 % is 34 ticks (34.4), the point at 90 % is the 37th tick (index 36).
    #expect(marks(86, 90).filled == 34)
    #expect(marks(86, 90).mark == 36)
    #expect(marks(100, nil).filled == 40)
    #expect(marks(50, nil).mark == nil)
    // Out of range: the gauge never draws more than it has, and the point is at most the last tick.
    #expect(marks(140, 120).filled == 40)
    #expect(marks(140, 120).mark == 39)
    #expect(marks(-5, -5).filled == 0)
    #expect(marks(-5, -5).mark == 0)
    #expect(marks(100, 100).mark == 39)
    // Figma 108A / 108C: 7 % and 2 % windows, 31 % context.
    #expect(marks(7, nil).filled == 3)
    #expect(marks(2, nil).filled == 1)
    #expect(marks(31, 95).filled == 12)
    #expect(marks(31, 95).mark == 38)
  }

  @Test func windowsOfOneModelStayOnTheMac() {
    let all = RemoteVendorUsage(vendor: "claude", plan: "Max", windows: [
      .init(minutes: 300, scope: nil, percent: 7, resetsAt: nil),
      .init(minutes: 10_080, scope: nil, percent: 2, resetsAt: nil),
      .init(minutes: 10_080, scope: "Sonnet", percent: 30, resetsAt: nil)
    ])
    #expect(shownWindows(all).map(\.minutes) == [300, 10_080])
    #expect(shownWindows(all).allSatisfy { $0.scope == nil })
    // Only a model's window left: nothing to show, so the sheet draws no plan block.
    let scoped = RemoteVendorUsage(vendor: "claude", plan: nil, windows: [.init(minutes: 10_080, scope: "Opus", percent: 5, resetsAt: nil)])
    #expect(shownWindows(scoped).isEmpty)
    #expect(shownWindows(RemoteVendorUsage(vendor: "codex", plan: nil, windows: [])).isEmpty)
  }

  /// The desktop's `windowLabel` in Chinese (the scheme runs the tests in Chinese, as the Mac's tests do).
  @Test func windowLabelsAreTheDesktops() throws {
    let labels = try vectors("windowLabels")
    #expect(labels.count >= 6)
    for sample in labels {
      guard let vendor = sample["vendor"]?.string, case .number(let minutes)? = sample["minutes"], let label = sample["label"]?.string else { Issue.record("bad vector \(sample)"); continue }
      #expect(windowLabel(vendor: vendor, minutes: Int(minutes), scope: sample["scope"]?.string) == label, "\(vendor) \(minutes)")
    }
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

  @Test func theSheetShowsTheWindowsOfTheVendorTheMacNamed() {
    let claude = RemoteVendorUsage(vendor: "claude", plan: "Max", windows: [.init(minutes: 300, scope: nil, percent: 42, resetsAt: nil)])
    let codex = RemoteVendorUsage(vendor: "codex", plan: "Plus", windows: [.init(minutes: 10_080, scope: nil, percent: 12, resetsAt: nil)])
    let list = RemoteSessionList(projects: [], sessions: [], usage: [claude, codex])
    func row(_ agent: String, vendor: String?) -> RemoteSession {
      RemoteSession(id: "s", projectId: "p", title: "t", agent: agent, status: .idle, action: nil, since: nil, activity: 0,
        branch: nil, model: nil, reply: nil, ship: nil, shipNotice: nil, usageVendor: vendor)
    }
    #expect(planUsage(for: row("claude", vendor: "claude"), in: list) == claude)
    // The Mac's word, not the agent's name: a terminal where codex runs by hand is a shell session.
    #expect(planUsage(for: row("shell", vendor: "codex"), in: list) == codex)
    // Named none (off the plan, or no windows): none shown, whatever the agent.
    #expect(planUsage(for: row("claude", vendor: nil), in: list) == nil)
    // Named a vendor the list has no windows for.
    #expect(planUsage(for: row("claude", vendor: "claude"), in: RemoteSessionList(projects: [], sessions: [], usage: [codex])) == nil)
    #expect(planUsage(for: row("claude", vendor: "claude"), in: RemoteSessionList(projects: [], sessions: [])) == nil)
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
