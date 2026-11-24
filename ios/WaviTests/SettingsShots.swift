// 设置's screenshots (Figma 105A–105D, PRD F22 v1.231): the session list with its avatar button, the settings page at the top
// and scrolled, in dark and light. The repo has no stand-in Mac, so this test is the host (a written cache under an unconnected
// AppModel). `test-results/settings/` when the shell names WAVI_SHOT_DIR, the simulator's temporary folder otherwise, the
// paths in the test log. The title's dialog (105B) and the theme menu (105D) are system surfaces in their own windows that a
// window capture does not contain: they are looked at in the simulator.
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Wavi

private let pairing = Pairing(device: "settings-shot", secret: WaviCrypto.b64u(Data(repeating: 7, count: 32)),
  macName: "MacBook Pro", urls: ["ws://127.0.0.1:9"])

private let now = Date().timeIntervalSince1970 * 1000
private let minute: Double = 60_000

private func session(_ id: String, _ title: String, _ status: SessionStatus, project: String = "p1", branch: String, activity: Double,
  since: Double? = nil, action: String? = nil) -> RemoteSession {
  RemoteSession(id: id, projectId: project, title: title, agent: "claude", status: status, action: action, since: since,
    activity: activity, branch: branch, model: nil, reply: nil, ship: nil, shipNotice: nil)
}

private let sessions = RemoteSessionList(
  projects: [RemoteProject(id: "p1", name: "acme-web"), RemoteProject(id: "p2", name: "terminal-reborn")],
  sessions: [
    session("s1", "移除 localStorage 读写", .needsYou, branch: "jacob/drop-local-storage", activity: now - 2 * minute, since: now - 2 * minute,
      action: "等你确认：运行 pnpm lint"),
    session("s2", "会话过期自动续期", .running, branch: "jacob/session-refresh", activity: now - 3 * minute, action: "编辑 src/auth/refresh.ts"),
    session("s3", "Git 图谱布局", .idle, project: "p2", branch: "graph-layout", activity: now - 60 * minute, action: "空闲")
  ])

private struct Host<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View { NavigationStack { content } }
}

@MainActor private func model() async -> AppModel {
  let cache = PhoneCache(root: FileManager.default.temporaryDirectory.appendingPathComponent("wavi-settings-shots", isDirectory: true))
  cache.saveSessions(sessions, heardAt: now, scope: PhoneCache.scope(pairing))
  await cache.flush()
  return AppModel(pairing: pairing, cache: cache, connects: false)
}

private func shotFolder() -> URL {
  let fallback = FileManager.default.temporaryDirectory
  guard let wanted = ProcessInfo.processInfo.environment["WAVI_SHOT_DIR"], !wanted.isEmpty else { return fallback }
  let url = URL(fileURLWithPath: wanted, isDirectory: true)
  return (try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)) == nil ? fallback : url
}

/// `scrollTo`: how far the page is scrolled before the frame is taken (a scroll view in the hierarchy).
@MainActor
private func shot<V: View>(_ view: V, _ style: UIUserInterfaceStyle, named name: String, scrolled: Bool = false) async throws {
  let size = CGSize(width: 402, height: 874)
  let model = await model()
  guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
    Issue.record("\(name): no window scene to draw in")
    return
  }
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(origin: .zero, size: size)
  window.overrideUserInterfaceStyle = style
  let host = UIHostingController(rootView: view.environment(model))
  host.view.backgroundColor = .clear
  window.rootViewController = host
  window.makeKeyAndVisible()
  try await Task.sleep(for: .milliseconds(600))
  if scrolled, let scroll = firstScrollView(in: host.view) {
    scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)), animated: false)
    try await Task.sleep(for: .milliseconds(300))
  }
  host.view.layoutIfNeeded()
  let image = UIGraphicsImageRenderer(size: size).image { _ in
    window.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
  }
  let path = shotFolder().appendingPathComponent("\(name).png")
  try image.pngData()?.write(to: path)
  print("SHOT \(name): \(path.path) \(Int(size.width))x\(Int(size.height))")
  window.isHidden = true
}

private func firstScrollView(in view: UIView) -> UIScrollView? {
  if let scroll = view as? UIScrollView, scroll.contentSize.height > 0 { return scroll }
  for sub in view.subviews { if let found = firstScrollView(in: sub) { return found } }
  return nil
}

/// A picture to stand in for the one the user chose: two colours, so the crop and the circle show.
private func samplePicture() -> Data {
  let image = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200)).image { context in
    UIColor(red: 0.95, green: 0.55, blue: 0.2, alpha: 1).setFill()
    context.fill(CGRect(x: 0, y: 0, width: 300, height: 200))
    UIColor(red: 0.2, green: 0.35, blue: 0.8, alpha: 1).setFill()
    context.cgContext.fillEllipse(in: CGRect(x: 90, y: 30, width: 120, height: 120))
  }
  return image.jpegData(compressionQuality: 0.9)!
}

@Suite @MainActor struct SettingsShots {
  @Test func listAndSettings() async throws {
    for (style, name) in [(UIUserInterfaceStyle.dark, "dark"), (.light, "light")] {
      try await shot(Host { SessionsView() }, style, named: "sessions-avatar-\(name)")
      try await shot(Host { AppSettingsView() }, style, named: "settings-\(name)")
      // 105A with a picture chosen: the button is the picture alone, no glass around it.
      #expect(await MyAvatar.shared.set(samplePicture()))
      try await shot(Host { SessionsView() }, style, named: "sessions-avatar-set-\(name)")
      try await shot(Host { AppSettingsView() }, style, named: "settings-avatar-set-\(name)")
      MyAvatar.shared.remove()
      try await shot(Host { AppSettingsView() }, style, named: "settings-scrolled-\(name)", scrolled: true)
    }
  }
}
