// An agent's Markdown reply drawn to PNGs, dark and light (PRD F22 会话页): tables with long cells, inline code, links,
// nested lists. `test-results/markdown/` when the shell names WAVI_SHOT_DIR, the simulator's temporary folder otherwise.
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Wavi

let markdownSample = """
这次改名还有一个附带影响：`electron-builder.yml:68` 的 `publish: provider: github` 没有写 owner 和 repo，会从 `repository` 推断。详见 [electron-builder 文档](https://www.electron.build/publish)。

### 验证

| 检查 | 结果 |
|---|---|
| `npm run check`（typecheck、lint、依赖规则、全量单测） | 已验证：296 个测试文件、3945 passed、1 skipped |
| `npx playwright test e2e/settings.spec.ts --project=parallel`（含「更新」弹窗版本号那条） | 已验证：11 passed、0 failed |
| architecture-reviewer 独立 review | 已完成。3 条意见我都核对了，结论见下表 |

| review 意见 | 我的核对 |
|---|---|
| pty daemon、iPhone、ACP 这 3 处还在用外壳的 `app.getVersion()`，每次调用都同步读文件 | `daemon/wire.ts:12` 里声明了 appVersion，只有 `src/preload` 读它 |
| README、CHANGELOG 里还是旧仓库名 | README.md 有 5 处，CHANGELOG.md:76 用于显示 |

### 第二部分：方案 3（M 档，等你确认）

1. **目标**：检查更新失败时（没联网、超时、GitHub 返回 403/404），弹窗显示「无法检查更新」。
2. **要改的文件**：
   - `src/shared/ipc.ts`（扩展）：`checkForUpdates` 的返回类型改成联合类型
   - `src/main/updates.ts`：失败时返回 `{ status: 'error' }`

> 这是读配置得出的结论，还没有在真实发版中验证。
"""

@MainActor
private func shot<V: View>(_ view: V, _ style: UIUserInterfaceStyle, named name: String) async throws {
  guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
    Issue.record("\(name): no window scene to draw in")
    return
  }
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(x: 0, y: 0, width: 402, height: 1400)
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
  let path = folder.appendingPathComponent("markdown-\(name).png")
  try image.pngData()?.write(to: path)
  print("SHOT \(name): \(path.path)")
  window.isHidden = true
}

@Suite @MainActor struct MarkdownShots {
  @Test func aLongReply() async throws {
    let reply = ScrollView { MarkdownText(text: markdownSample).padding(.horizontal, Metric.margin).padding(.vertical, 16) }
      .background(Color.bgApp)
    for (style, name) in [(UIUserInterfaceStyle.dark, "dark"), (.light, "light")] {
      try await shot(reply, style, named: name)
    }
  }
}
