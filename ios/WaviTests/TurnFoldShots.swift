// A finished turn folded into 「工作了 …」, drawn to PNGs, dark and light, folded and opened (PRD F22 会话页 v1.230 ③, Figma
// 104B1 / 104B2 / 104B1′ / 104B2′): the user's message with its time and copy, the fold beside the agent's mark, the final
// reply with its time and copy, the turn's totals. `test-results/turn-fold/` when the shell names WAVI_SHOT_DIR, the
// simulator's temporary folder otherwise.
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Wavi

@MainActor
private func shot<V: View>(_ view: V, _ style: UIUserInterfaceStyle, named name: String) async throws {
  guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
    Issue.record("\(name): no window scene to draw in")
    return
  }
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(x: 0, y: 0, width: 402, height: 700)
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
  let path = folder.appendingPathComponent("turn-fold-\(name).png")
  try image.pngData()?.write(to: path)
  print("SHOT \(name): \(path.path)")
  window.isHidden = true
}

private func diff(_ path: String, _ added: Int, _ removed: Int) -> ToolDiff { ToolDiff(path: path, hunks: [], added: added, removed: removed, truncated: false) }

private func sampleItems(now: Double) -> [ChatItem] {
  let start = now - 75_000
  return [
    ChatItem(kind: "user", id: "u", at: start, text: "三种续期方案各有什么取舍？列个表给我。"),
    ChatItem(kind: "thinking", id: "k", at: start + 4_000, text: "要先找到续期的入口。", ms: 4000),
    ChatItem(kind: "text", id: "m", at: start + 6_000, text: "先看现在的续期逻辑在哪。"),
    ChatItem(kind: "tool", id: "a", at: start + 10_000, name: "Read", arg: "src/auth/session.ts", state: "ok"),
    ChatItem(kind: "tool", id: "b", at: start + 20_000, name: "Grep", arg: "refreshToken", state: "ok"),
    ChatItem(kind: "tool", id: "c", at: start + 40_000, name: "Edit", arg: "session.ts", state: "ok", diff: diff("session.ts", 24, 3)),
    ChatItem(kind: "tool", id: "d", at: start + 60_000, name: "Bash", arg: "xcodebuild test", state: "ok"),
    ChatItem(kind: "text", id: "t", at: now, text: "改好了：`src/session.ts` 到期前 5 分钟用 `scheduleRefresh(at:)` 续期，\n失败三次退回登录页。\n\n**没改**：`client.ts`，请求层保持原样。")
  ]
}

@Suite @MainActor struct TurnFoldShots {
  @Test func aFinishedTurn() async throws {
    let now = Date().timeIntervalSince1970 * 1000
    let blocks = transcriptBlocks(sampleItems(now: now), receipts: [], turnOpen: false)
    // The Edit's diff makes the totals row; without the full diff it is still drawn.
    #expect(blocks.contains { if case .fold = $0 { true } else { false } })
    for (open, label) in [(false, "folded"), (true, "open")] {
      let feed = NavigationStack {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
              BlockRow(block: block, session: "s1", agent: index == 1 ? "claude" : nil, foldOpen: open)
            }
          }
          .padding(.horizontal, Metric.margin)
          .padding(.vertical, 8)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.bgApp)
      }
      .environment(AppModel())
      .environment(\.fileSession, "s1")
      for (style, name) in [(UIUserInterfaceStyle.dark, "dark"), (.light, "light")] {
        try await shot(feed, style, named: "\(label)-\(name)")
      }
    }
  }
}
