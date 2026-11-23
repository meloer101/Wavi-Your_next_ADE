// Components.swift: Markdown tables (Figma 64A) next to the other blocks; MyAvatar.swift: the middle square.
import Foundation
import Testing
@testable import Wavi

@Suite struct MarkdownTests {
  @Test func aGitHubTableIsOneBlock() {
    let text = "三种方案：\n\n| 方案 | 续期时机 |\n|---|:---:|\n| 定时器 | 到期前 5 分钟 |\n| 401 拦截 |\n\n结论"
    #expect(markdownBlocks(text) == [
      .paragraph("三种方案："),
      .table(header: ["方案", "续期时机"], rows: [["定时器", "到期前 5 分钟"], ["401 拦截", ""]]),
      .paragraph("结论")
    ])
  }

  @Test func pipesWithoutADividerStayText() {
    #expect(markdownBlocks("a | b\nc | d") == [.paragraph("a | b\nc | d")])
  }

  @Test func aNestedItemKnowsItsLevel() {
    let text = "1. **目标**：a\n2. 文件：\n   - `ipc.ts`\n     - 联合类型\n   - `updates.ts`\n3. 风险\n- 新列表"
    #expect(markdownBlocks(text) == [
      .item(marker: "1.", text: "**目标**：a", level: 0),
      .item(marker: "2.", text: "文件：", level: 0),
      .item(marker: "•", text: "`ipc.ts`", level: 1),
      .item(marker: "•", text: "联合类型", level: 2),
      .item(marker: "•", text: "`updates.ts`", level: 1),
      .item(marker: "3.", text: "风险", level: 0),
      .item(marker: "•", text: "新列表", level: 0)
    ])
  }

  @Test func anEscapedPipeStaysInItsCell() {
    #expect(tableCells("| a \\| b | c |") == ["a | b", "c"])
  }

  @Test func theAvatarIsTheMiddleSquare() {
    #expect(squareCrop(CGSize(width: 400, height: 300)) == CGRect(x: 50, y: 0, width: 300, height: 300))
    #expect(squareCrop(CGSize(width: 300, height: 500)) == CGRect(x: 0, y: 100, width: 300, height: 300))
  }
}
