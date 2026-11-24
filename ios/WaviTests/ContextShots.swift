// The context ring and its sheet drawn to PNGs, dark and light (PRD F22 v1.230 ④, Figma 104C1 / 104C2; the sheet is Figma 108
// since v1.232): the 会话设置 row with the ring in its normal state and in its high state, and the sheet's three states. `test-results/context/` when the shell names WAVI_SHOT_DIR, the simulator's temporary folder otherwise.
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Wavi

private let settings = SessionSettings(
  items: [
    .init(kind: "model", current: "opus", values: [.init(value: "opus", label: "Opus 5.5")]),
    .init(kind: "effort", current: "high", values: [.init(value: "high", label: "高")]),
    .init(kind: "permission", current: "default", values: [.init(value: "default", label: "询问")])
  ],
  locked: nil, readOnly: nil)

private func session(_ context: RemoteContext?, settings: SessionSettings? = settings) -> RemoteSession {
  RemoteSession(
    id: "s1", projectId: "p1", title: "会话过期自动续期", agent: "claude", status: .idle, action: nil, since: nil,
    activity: 0, branch: nil, model: nil, reply: nil, ship: nil, shipNotice: nil, settings: settings, context: context)
}

private let normal = RemoteContext(percent: 42, usedTokens: 84_000, windowTokens: 200_000, markPercent: 92, high: false)
private let high = RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: 200_000, markPercent: 92, high: true)

/// The row as SessionView draws it.
private struct Row: View {
  let session: RemoteSession

  var body: some View {
    HStack(spacing: 8) {
      if let settings = session.settings { SettingsPill(session: session, settings: settings) }
      Spacer(minLength: 0)
      if let context = session.context { ContextRing(session: session.id, context: context) }
    }
    .padding(.horizontal, Metric.margin)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity)
    .background(Color.bgApp)
    .ignoresSafeArea()
    .environment(AppModel(pairing: nil, cache: PhoneCache(root: FileManager.default.temporaryDirectory.appendingPathComponent("wavi-context-shots", isDirectory: true)), connects: false))
  }
}

@MainActor
private func shot<V: View>(_ view: V, _ style: UIUserInterfaceStyle, named name: String, height: CGFloat) async throws {
  guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
    Issue.record("\(name): no window scene to draw in")
    return
  }
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(x: 0, y: 0, width: 402, height: height)
  window.overrideUserInterfaceStyle = style
  let host = UIHostingController(rootView: view)
  window.rootViewController = host
  window.makeKeyAndVisible()
  try await Task.sleep(for: .milliseconds(400))
  host.view.layoutIfNeeded()
  let image = UIGraphicsImageRenderer(size: window.bounds.size).image { window.layer.render(in: $0.cgContext) }
  let folder = ProcessInfo.processInfo.environment["WAVI_SHOT_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    ?? FileManager.default.temporaryDirectory
  try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  let path = folder.appendingPathComponent("context-\(name).png")
  try image.pngData()?.write(to: path)
  print("SHOT \(name): \(path.path)")
  window.isHidden = true
}

@Suite @MainActor struct ContextShots {
  private let styles: [(UIUserInterfaceStyle, String)] = [(.dark, "dark"), (.light, "light")]

  @Test func theRowInItsNormalState() async throws {
    for (style, name) in styles { try await shot(Row(session: session(normal)), style, named: "row-normal-\(name)", height: 64) }
  }

  @Test func theRowInItsHighState() async throws {
    for (style, name) in styles { try await shot(Row(session: session(high)), style, named: "row-high-\(name)", height: 64) }
  }

  @Test func theRowWithTheRingAlone() async throws {
    for (style, name) in styles { try await shot(Row(session: session(high, settings: nil)), style, named: "row-ring-only-\(name)", height: 64) }
  }

  /// Figma 108A / 108B / 108C, dark and light: the context sheet with the plan windows; at 86 % with 「放进 /compact」; without
  /// plan windows. The system draws the real sheet's glass and grabber, which a window capture of the content does not
  /// have: the content sits in a bg/sheet container with a grabber drawn like the system's.
  @Test func theSheetInFigma108sThreeStates() async throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    func at(_ day: Int, _ hour: Int, _ minute: Int) -> Double {
      calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!.timeIntervalSince1970 * 1000
    }
    // A Saturday noon: 23:30 is today, Tuesday 10:00 reads 周二.
    let now = at(21, 12, 0)
    let usage = { (five: Double, seven: Double) in
      RemoteVendorUsage(vendor: "claude", plan: "Max", windows: [
        .init(minutes: 300, scope: nil, percent: five, resetsAt: at(21, 23, 30)),
        .init(minutes: 10_080, scope: nil, percent: seven, resetsAt: at(24, 10, 0)),
        // Never drawn on the phone (PRD v1.232).
        .init(minutes: 10_080, scope: "Sonnet", percent: 55, resetsAt: at(24, 10, 0))
      ])
    }
    let states: [(String, RemoteContext, RemoteVendorUsage?)] = [
      ("108A", RemoteContext(percent: 11, usedTokens: 115_000, windowTokens: 1_000_000, markPercent: 97, high: false), usage(7, 2)),
      ("108B", RemoteContext(percent: 86, usedTokens: 172_000, windowTokens: 200_000, markPercent: 90, high: true), usage(63, 41)),
      ("108C", RemoteContext(percent: 31, usedTokens: 62_000, windowTokens: 200_000, markPercent: 90, high: false), nil)
    ]
    for (style, name) in styles {
      for (state, context, usage) in states {
        let sheet = ContextSheetContent(context: context, agent: "claude", usage: usage, now: now) {}
          .frame(width: 386)
          .fixedSize(horizontal: false, vertical: true)
          .background(Color.bgSheet, in: RoundedRectangle(cornerRadius: 38))
          .overlay(alignment: .top) { Capsule().fill(Color.fillStrong).frame(width: 36, height: 5).padding(.top, 12) }
          .overlay(RoundedRectangle(cornerRadius: 38).strokeBorder(Color.hairline))
          .padding(8)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
          .background(Color.bgApp)
        try await shot(sheet, style, named: "sheet-\(state)-\(name)", height: 874)
      }
    }
  }
}
