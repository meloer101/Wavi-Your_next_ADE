// The app's 设置 page (PRD F22 v1.231, Figma 105): the pure parts — what 主题 and 启动时打开 store and hand to the app, the
// cache's size text, 清除本机缓存 (it empties the folder and leaves the cache usable), and the card switch's default.
// The confirmation before 取消配对 is a SwiftUI dialog (`AppSettingsView.unpairing`); the unit tests do not draw views, so it
// is checked in the screenshots' run and by reading the view, not here.
import Foundation
import SwiftUI
import Testing
@testable import Wavi

private func tempCache() -> PhoneCache {
  PhoneCache(root: FileManager.default.temporaryDirectory.appendingPathComponent("wavi-settings-tests/\(UUID().uuidString)", isDirectory: true))
}

private func session(_ id: String) -> RemoteSession {
  RemoteSession(id: id, projectId: "p1", title: "会话 \(id)", agent: "claude", status: .running, action: nil, since: 0,
    activity: 1_000, branch: "main", model: nil, reply: nil, ship: nil, shipNotice: nil)
}

private let card = activityState(sessions: [session("s1")], prompts: [], now: 9_000)!

private let list = RemoteSessionList(projects: [RemoteProject(id: "p1", name: "terminal-reborn")], sessions: [session("s1")])

@Suite struct AppSettingsTests {
  @Test func themeMapsToAColorScheme() {
    #expect(AppTheme.system.scheme == nil)
    #expect(AppTheme.light.scheme == .light)
    #expect(AppTheme.dark.scheme == .dark)
    #expect(AppTheme(rawValue: "dark")?.scheme == .dark)
    // A stored value this version does not know has no case; @AppStorage then reads the declared default, 跟随系统 (the
    // property wrapper itself is not exercised here).
    #expect(AppTheme(rawValue: "sepia") == nil)
  }

  @Test func startTabFallsBackToSessions() {
    #expect(StartTab.stored("board").tab == .board)
    #expect(StartTab.stored("sessions").tab == .sessions)
    #expect(StartTab.stored("settings").tab == .sessions)
    #expect(StartTab.stored("").tab == .sessions)
    #expect(StartTab.stored(nil).tab == .sessions)
  }

  @Test func cacheSizeReadsLikeTheFigmaRow() {
    #expect(cacheSizeText(12_000_000).hasPrefix("12"))
    #expect(cacheSizeText(12_000_000).contains("MB"))
    #expect(cacheSizeText(0).hasPrefix("0"))
    #expect(cacheSizeText(0) != cacheSizeText(12_000_000))
  }

  @Test func clearingTheCacheEmptiesItAndLeavesItUsable() async {
    let cache = tempCache()
    let scope = PhoneCache.scope(Pairing(device: "p", secret: WaviCrypto.b64u(Data(repeating: 3, count: 32)), macName: "Mac", urls: []))
    #expect(cache.size() == 0)
    cache.saveSessions(list, heardAt: 1, scope: scope)
    cache.saveConversation(Feed(start: 0, items: [ChatItem(kind: "text", id: "i0", at: 0, text: "t")]), scope: scope, session: "s1")
    await cache.flush()
    #expect(cache.size() > 0)
    #expect(cache.sessions(scope) != nil)

    await cache.wipe()
    #expect(cache.size() == 0)
    #expect(cache.sessions(scope) == nil)
    #expect(cache.conversation(scope, "s1") == nil)

    // Not 取消配对: the same pairing's next list is cached again.
    cache.saveSessions(list, heardAt: 2, scope: scope)
    await cache.flush()
    #expect(cache.sessions(scope)?.heardAt == 2)
    cache.clearAll()
  }

  @Test func aWriteStillWaitingWhenTheCacheIsClearedDoesNotComeBack() async {
    let cache = tempCache()
    let scope = "scope"
    cache.saveSessions(list, heardAt: 1, scope: scope)
    await cache.wipe()
    await cache.flush()
    #expect(cache.sessions(scope) == nil)
  }

  @MainActor @Test func theCardSwitchDefaultsToOn() {
    let defaults = UserDefaults.standard
    let before = defaults.object(forKey: "activity.enabled")
    defer { defaults.set(before, forKey: "activity.enabled") }
    defaults.removeObject(forKey: "activity.enabled")
    #expect(LiveActivities.enabled)
    defaults.set(false, forKey: "activity.enabled")
    #expect(!LiveActivities.enabled)
    defaults.set(true, forKey: "activity.enabled")
    #expect(LiveActivities.enabled)
  }

  /// ActivityKit does not run in a test, so a card on screen is stood in for by what the instance remembers of it
  /// (`shown`, `pushedAt`); what is asserted is the instance's own bookkeeping, not the system's card.
  @MainActor @Test func withTheSwitchOffACardIsNotShown() {
    let defaults = UserDefaults.standard
    let before = defaults.object(forKey: "activity.enabled")
    defer { defaults.set(before, forKey: "activity.enabled") }
    defaults.set(false, forKey: "activity.enabled")
    let activities = LiveActivities()
    activities.show(card, mac: "Mac")
    #expect(activities.current == nil)
    #expect(activities.pushedAt == nil)
  }

  @MainActor @Test func aCardShownAgainAfterTheSwitchWasOffIsNotTakenForTheOldOne() {
    let defaults = UserDefaults.standard
    let before = defaults.object(forKey: "activity.enabled")
    defer { defaults.set(before, forKey: "activity.enabled") }
    defaults.set(true, forKey: "activity.enabled")
    let activities = LiveActivities()
    // The card is on screen, sent a moment ago: the same card again is not sent (show returns early, pushedAt stays).
    activities.shown = card
    let sentAt = Date()
    activities.pushedAt = sentAt
    activities.show(card, mac: "Mac")
    #expect(activities.pushedAt == sentAt)

    // Switch off (the Mac may be offline: nothing else arrives to clear it), then on: the same card is shown again.
    activities.reset()
    #expect(activities.current == nil)
    #expect(activities.pushedAt == nil)
    activities.show(card, mac: "Mac")
    #expect(activities.pushedAt != nil)
  }
}
