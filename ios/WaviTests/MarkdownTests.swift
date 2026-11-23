// Views/Markdown.swift: a reply parsed by swift-markdown into the blocks the views draw, and the file paths in its inline
// code (PRD F22 v1.230). MyAvatar.swift: the middle square.
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
    #expect(blocks == [.init(kind: .code(language: "ts", code: "const a = 1\n  const b = 2"))])
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
    #expect(blocks == [.init(kind: .quote([.text("一句引用")]), quoted: true), .init(kind: .rule)])
  }

  @Test func aQuoteKeepsTheOrderOfWhatIsInsideIt() {
    let blocks = markdownBlocks("> a\n>\n> - x\n>\n> b")
    #expect(blocks.map(\.kind) == [.quote([.text("a")]), .paragraph([.text("x")]), .quote([.text("b")])])
    #expect(blocks.map(\.marker) == [nil, "•", nil])
    // Everything in the quote, the list too, is quoted: one bar for the three.
    #expect(blocks.map(\.quoted) == [true, true, true])
    #expect(quoteGroups(blocks).map(\.quoted) == [true])
    #expect(quoteGroups(blocks).first?.blocks.count == 3)
  }

  @Test func blocksOutsideAQuoteAreNotQuoted() {
    let blocks = markdownBlocks("前\n\n> 引\n\n后")
    #expect(blocks.map(\.quoted) == [false, true, false])
    #expect(quoteGroups(blocks).map(\.quoted) == [false, true, false])
  }

  @Test func blocksInAnItemAlignWithItsText() {
    let blocks = markdownBlocks("- 第一项\n\n  ```ts\n  let a = 1\n  ```\n\n  同一项的第二段\n- 第二项\n  - 嵌套\n\n    嵌套的第二段")
    #expect(blocks.map(\.level) == [0, 1, 1, 0, 1, 2])
    #expect(blocks.map(\.marker) == ["•", nil, nil, "•", "◦", nil])
    #expect(blocks[1].kind == .code(language: "ts", code: "let a = 1"))
    #expect(blocks[2].kind == .paragraph([.text("同一项的第二段")]))
  }

  @Test func anItemThatOpensWithCodeKeepsItsMarker() {
    let blocks = markdownBlocks("- ```ts\n  let a = 1\n  ```\n- [x] done")
    #expect(blocks.map(\.marker) == ["•", nil, "•"])
    #expect(blocks.map(\.level) == [0, 1, 0])
    #expect(blocks[0].kind == .paragraph([]))
    #expect(blocks[1].kind == .code(language: "ts", code: "let a = 1"))
    #expect(blocks.map(\.checked) == [nil, nil, true])
  }

  @Test func aPathLongerThanTheMacTakesIsNotAFile() {
    #expect(fileRef(inCode: String(repeating: "a/", count: 498) + "b.ts") != nil)
    #expect(fileRef(inCode: String(repeating: "a/", count: 499) + "b.ts") == nil)
  }

  @Test func aTableInAnItemIsOneLevelIn() {
    let blocks = markdownBlocks("1. 表：\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |")
    #expect(blocks.map(\.level) == [0, 1])
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
    #expect(fileRef(inCode: "src/a.ts:42-50") == FileRef(path: "src/a.ts", line: 42, column: nil))
    #expect(fileRef(inCode: "src/a.ts#L10-L20") == FileRef(path: "src/a.ts", line: 10, column: nil))
    #expect(fileRef(inCode: "src/a.ts#L10-20") == FileRef(path: "src/a.ts", line: 10, column: nil))
    #expect(fileRef(inCode: "Package.swift") == FileRef(path: "Package.swift", line: nil, column: nil))
    // A folder in front keeps any extension.
    #expect(fileRef(inCode: "assets/logo.svg") == FileRef(path: "assets/logo.svg", line: nil, column: nil))
    // A path from the session's folder's top level is as long as it gets.
    #expect(fileRef(inCode: "docs/说明.md") == FileRef(path: "docs/说明.md", line: nil, column: nil))
  }

  @Test func proseInInlineCodeIsNotAFile() {
    for code in ["npm run check", "and/or", "src/app", "error: not found", "localhost:3000", "a", "", "    ", "`" + "x".padding(toLength: 2000, withPad: "x", startingAt: 0) + "`", "~/notes.md", "../a.ts", "./", "console.log", "user.name", "Array.map", "example.com:8080", "example.com", "foo.bar", "Foo.init", "e.g."] {
      #expect(fileRef(inCode: code) == nil, "\(code)")
    }
  }

  @Test func aChipShowsItsFileName() {
    #expect(fileRefName("src/main/remote/index.ts") == "index.ts")
    #expect(fileRefName("./ios/project.yml") == "project.yml")
    #expect(fileRefName("PRD.md") == "PRD.md")
  }

  @Test func aMarkdownLinkToAFileOpensIt() {
    // Same rules as inline code, after percent-decoding; the web and mail go to the system; anything else is not a link.
    #expect(markdownLinkURL("src/a.ts:12", files: true).flatMap(FileRef.init) == FileRef(path: "src/a.ts", line: 12, column: nil))
    #expect(markdownLinkURL("docs/%E8%AF%B4%E6%98%8E.md", files: true).flatMap(FileRef.init) == FileRef(path: "docs/说明.md", line: nil, column: nil))
    #expect(markdownLinkURL("docs/说明.md", files: true).flatMap(FileRef.init) == FileRef(path: "docs/说明.md", line: nil, column: nil))
    // A path with a space is not a file by the same rules as inline code.
    #expect(markdownLinkURL("docs/a%20b.md", files: true) == nil)
    #expect(markdownLinkURL("https://example.com/a b", files: true)?.scheme == "https")
    #expect(markdownLinkURL("mailto:a@b.c", files: true)?.scheme == "mailto")
    #expect(markdownLinkURL("javascript:alert(1)", files: true) == nil)
    #expect(markdownLinkURL("#section", files: true) == nil)
    #expect(markdownLinkURL("src/a.ts", files: false) == nil)
  }

  @Test func aChipLinkRoundTrips() throws {
    let ref = FileRef(path: "docs/说明 1.md", line: 42, column: nil)
    let url = try #require(ref.url)
    #expect(url.scheme == "wavi-file")
    #expect(FileRef(url) == ref)
    #expect(FileRef(URL(string: "https://example.com")!) == nil)
  }

  // MARK: - The file page

  @Test func wideCharactersCountTwoCells() {
    #expect(displayWidth("abc") == 3)
    #expect(displayWidth("汉字") == 4)
    #expect(displayWidth("あア한") == 6)
    #expect(displayWidth("ＡＢ") == 4)
    // 40 汉字 take 80 cells and beat 60 ASCII characters.
    let wide = String(repeating: "汉", count: 40), ascii = String(repeating: "a", count: 60)
    #expect(displayWidth(wide) > displayWidth(ascii))
    #expect(["x", ascii, wide].max { displayWidth($0) < displayWidth($1) } == wide)
  }

  @Test func aLongLineIsCutWithAnEllipsis() {
    let lines = fileLines("short\n" + String(repeating: "x", count: 5000) + "\n")
    #expect(lines.count == 3)
    #expect(lines[0] == "short")
    #expect(lines[1].count == maxFileLineLength + 1 && lines[1].hasSuffix("…"))
    #expect(lines[2] == "")
    #expect(fileLines(String(repeating: "x", count: maxFileLineLength)) == [String(repeating: "x", count: maxFileLineLength)])
  }

  @Test func theAvatarIsTheMiddleSquare() {
    #expect(squareCrop(CGSize(width: 400, height: 300)) == CGRect(x: 50, y: 0, width: 300, height: 300))
    #expect(squareCrop(CGSize(width: 300, height: 500)) == CGRect(x: 0, y: 100, width: 300, height: 300))
  }
}
