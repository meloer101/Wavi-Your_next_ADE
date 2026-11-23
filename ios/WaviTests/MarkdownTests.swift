// Views/Markdown.swift: a reply parsed by swift-markdown into the blocks the views draw, and the file paths in its inline
// code (PRD F22 v1.229 ②). MyAvatar.swift: the middle square.
import Foundation
import Testing
@testable import Wavi

@Suite struct MarkdownTests {
  @Test func aGitHubTableIsOneBlock() {
    let text = "三种方案：\n\n| 方案 | 续期时机 |\n|---|:---:|\n| 定时器 | 到期前 5 分钟 |\n| 401 拦截 |\n\n结论"
    #expect(markdownBlocks(text) == [
      .init(kind: .paragraph([.text("三种方案：")])),
      .init(kind: .table(header: [[.text("方案")], [.text("续期时机")]], rows: [[[.text("定时器")], [.text("到期前 5 分钟")]], [[.text("401 拦截")], []]])),
      .init(kind: .paragraph([.text("结论")]))
    ])
  }

  @Test func pipesWithoutADividerStayText() {
    #expect(markdownBlocks("a | b\nc | d") == [.init(kind: .paragraph([.text("a | b"), .lineBreak, .text("c | d")]))])
  }

  @Test func aNestedItemKnowsItsLevel() {
    let text = "1. **目标**：a\n2. 文件：\n   - `ipc.ts`\n     - 联合类型\n   - `updates.ts`\n3. 风险\n- 新列表"
    let blocks = markdownBlocks(text)
    // Bullets change shape with the level: • then ◦ then ▪.
    #expect(blocks.map(\.marker) == ["1.", "2.", "◦", "▪", "◦", "3.", "•"])
    #expect(blocks.map(\.level) == [0, 0, 1, 2, 1, 0, 0])
    #expect(blocks.first?.kind == .paragraph([.strong([.text("目标")]), .text("：a")]))
    #expect(blocks[2].kind == .paragraph([.code("ipc.ts")]))
  }

  @Test func taskListsCarryTheirBoxes() {
    let blocks = markdownBlocks("- [x] 读 PRD\n- [ ] 写代码")
    #expect(blocks.map(\.checked) == [true, false])
    #expect(blocks.map(\.marker) == ["•", "•"])
    #expect(blocks.first?.kind == .paragraph([.text("读 PRD")]))
  }

  @Test func anOrderedListKeepsItsNumbers() {
    let blocks = markdownBlocks("3. 第三步\n4. 第四步")
    #expect(blocks.map(\.marker) == ["3.", "4."])
  }

  @Test func headingsKeepTheirLevel() {
    let blocks = markdownBlocks("# 一\n\n### 三")
    #expect(blocks.map(\.kind) == [.heading(level: 1, [.text("一")]), .heading(level: 3, [.text("三")])])
  }

  @Test func fencedCodeKeepsItsLanguageAndLines() {
    let blocks = markdownBlocks("```ts\nconst a = 1\n  const b = 2\n```")
    #expect(blocks == [.init(kind: .code(language: "ts", code: "const a = 1\n  const b = 2\n"))])
  }

  @Test func inlineMarkdownIsRuns() {
    let blocks = markdownBlocks("**粗**、*斜*、~~删~~、[文档](https://example.com) 和 `code`")
    #expect(blocks == [
      .init(kind: .paragraph([
        .strong([.text("粗")]), .text("、"), .emphasis([.text("斜")]), .text("、"), .strikethrough([.text("删")]),
        .text("、"), .link(destination: "https://example.com", [.text("文档")]), .text(" 和 "), .code("code")
      ]))
    ])
  }

  @Test func anImageShowsItsAltText() {
    #expect(markdownBlocks("看图 ![失败截图](/tmp/a.png) 就懂") == [.init(kind: .paragraph([.text("看图 "), .text("失败截图"), .text(" 就懂")]))])
  }

  @Test func aQuoteAndARuleAreTheirOwnBlocks() {
    let blocks = markdownBlocks("> 一句引用\n\n---\n")
    #expect(blocks == [.init(kind: .quote([.text("一句引用")])), .init(kind: .rule)])
  }

  @Test func softBreaksStayBreaks() {
    #expect(markdownBlocks("一行\n两行") == [.init(kind: .paragraph([.text("一行"), .lineBreak, .text("两行")]))])
  }

  @Test func theSameTextIsParsedOnce() {
    #expect(parsedBlocks("# 同一个回复") == [.init(kind: .heading(level: 1, [.text("同一个回复")]))])
    #expect(parsedBlocks("# 同一个回复") == parsedBlocks("# 同一个回复"))
  }

  // MARK: - The file paths chips are for

  @Test func aPathInInlineCodeIsAFile() {
    #expect(fileRef(inCode: "src/main/remote/index.ts") == FileRef(path: "src/main/remote/index.ts", line: nil, column: nil))
    #expect(fileRef(inCode: "PRD.md") == FileRef(path: "PRD.md", line: nil, column: nil))
    #expect(fileRef(inCode: "src/main/remote/index.ts:42") == FileRef(path: "src/main/remote/index.ts", line: 42, column: nil))
    #expect(fileRef(inCode: "src/a.ts:42:5") == FileRef(path: "src/a.ts", line: 42, column: 5))
    #expect(fileRef(inCode: "src/a.ts#L42") == FileRef(path: "src/a.ts", line: 42, column: nil))
    #expect(fileRef(inCode: "  ./ios/project.yml  ") == FileRef(path: "./ios/project.yml", line: nil, column: nil))
    #expect(fileRef(inCode: "@src/a.ts") == FileRef(path: "src/a.ts", line: nil, column: nil))
    #expect(fileRef(inCode: "src/a.ts:42.") == FileRef(path: "src/a.ts", line: 42, column: nil))
    // A path from the session's folder's top level is as long as it gets.
    #expect(fileRef(inCode: "docs/说明.md") == FileRef(path: "docs/说明.md", line: nil, column: nil))
  }

  @Test func proseInInlineCodeIsNotAFile() {
    for code in ["npm run check", "and/or", "src/app", "error: not found", "localhost:3000", "a", "", "    ", "`" + "x".padding(toLength: 2000, withPad: "x", startingAt: 0) + "`", "~/notes.md", "../a.ts", "./"] {
      #expect(fileRef(inCode: code) == nil, "\(code)")
    }
  }

  @Test func aChipShowsItsFileName() {
    #expect(fileRefName("src/main/remote/index.ts") == "index.ts")
    #expect(fileRefName("./ios/project.yml") == "project.yml")
    #expect(fileRefName("PRD.md") == "PRD.md")
  }

  @Test func aChipLinkRoundTrips() throws {
    let ref = FileRef(path: "docs/说明 1.md", line: 42, column: nil)
    let url = try #require(ref.url)
    #expect(url.scheme == "wavi-file")
    #expect(FileRef(url) == ref)
    #expect(FileRef(URL(string: "https://example.com")!) == nil)
  }

  @Test func theAvatarIsTheMiddleSquare() {
    #expect(squareCrop(CGSize(width: 400, height: 300)) == CGRect(x: 50, y: 0, width: 300, height: 300))
    #expect(squareCrop(CGSize(width: 300, height: 500)) == CGRect(x: 0, y: 100, width: 300, height: 300))
  }
}
