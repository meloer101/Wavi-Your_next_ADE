// The context ring and its sheet drawn to PNGs, dark and light (PRD F22 v1.230 ④, Figma 104C1 / 104C2 / 104C3): the 会话设置
// row with the ring in its normal state and in its high state, and the sheet's content with Claude's plan windows and
// 「放进 /compact」. `test-results/context/` when the shell names WAVI_SHOT_DIR, the simulator's temporary folder otherwise.
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

  @Test func theSheetWithClaudeUsageAndCompact() async throws {
    let now = Date().timeIntervalSince1970 * 1000
    let usage = RemoteVendorUsage(vendor: "claude", plan: "Max", windows: [
      .init(minutes: 300, scope: nil, percent: 42, resetsAt: now + 3 * 3_600_000),
      .init(minutes: 10_080, scope: nil, percent: 18, resetsAt: now + 4 * 24 * 3_600_000)
    ])
    for (style, name) in styles {
      let sheet = ContextSheetContent(context: high, agent: "claude", usage: usage, now: now) {}
        .frame(width: 402, height: 340)
        .background(Color.bgSheet, in: UnevenRoundedRectangle(topLeadingRadius: Metric.radiusSheetTop, topTrailingRadius: Metric.radiusSheetTop))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background(Color.bgApp)
      try await shot(sheet, style, named: "sheet-\(name)", height: 400)
    }
  }
}
