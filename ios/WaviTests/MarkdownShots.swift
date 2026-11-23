// An agent's Markdown reply drawn to PNGs, dark and light (PRD F22 会话页, Figma 104A / 104A′): paragraphs with inline
// code and a file chip, a link, bold, italics, strikethrough, headings, a table with long cells, a nested list, a task
// list, a quote and fenced code. `test-results/markdown/` when the shell names WAVI_SHOT_DIR, the simulator's temporary
// folder otherwise.
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Wavi

let markdownSample = """
这次改名还有一个附带影响：`electron-builder.yml:68` 的 `publish: provider: github` 没有写 owner 和 repo，会从 `repository` 推断。读文件 `src/main/remote/index.ts:362` 里的 `case 'diff'`，或看[electron-builder 文档](https://www.electron.build/publish)和 ~~旧的 release 说明~~，**加粗的结论**和 *斜体备注* 都在这里。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run check`（typecheck、lint、依赖规则、全量单测） | 已验证：296 个测试文件、3945 passed、1 skipped |
| `docs/PRD.md` 里 v1.229 那一条 | 已核对：② 只加不改协议 |

### 待办

- [x] 读 `docs/PRD.md` 的 v1.229 一行
- [ ] 把 `ios/project.yml` 的依赖补上
- [ ] 跑 `xcodebuild test`（iPhone 17 Pro）

### 第二部分：方案 3（M 档，等你确认）

1. **目标**：检查更新失败时（没联网、超时、GitHub 返回 403/404），弹窗显示「无法检查更新」。
2. **要改的文件**：
   - `src/shared/ipc.ts`（扩展）：`checkForUpdates` 的返回类型改成联合类型
   - `src/main/updates.ts`：失败时返回 `{ status: 'error' }`
     - 这一层嵌套说明第三个缩进层级
3. **风险**：`src/main/remote/wire-samples.test.ts` 里的样例要跟着改。

```ts
export async function readPreview(root: unknown, path: unknown): Promise<FilePreview> {
  const realRoot = await resolveRoot(root)
  return { kind: 'text', text: data.toString('utf8'), size: info.size }
}
```

> 这是读配置得出的结论，还没有在真实发版中验证。

---

最后一段，没有列表也没有表格。
"""

@MainActor
private func shot<V: View>(_ view: V, _ style: UIUserInterfaceStyle, named name: String) async throws {
  guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
    Issue.record("\(name): no window scene to draw in")
    return
  }
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(x: 0, y: 0, width: 402, height: 1800)
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
