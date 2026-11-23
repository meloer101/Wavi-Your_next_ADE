// An agent's reply is Markdown (PRD F22, Figma 104A / 104A′): parsed by swift-markdown (cmark-gfm: CommonMark plus
// tables, task lists and strikethrough, Apache-2.0, THIRD_PARTY_NOTICES.md) and drawn block by block here — the library
// only parses, a page of the feed is redrawn too often to parse again on every body call (see `parsedBlocks`).
//
// A path in inline code (`src/a.ts:42`) is a chip that opens the file (PRD v1.229 ②): its line suffix is not shown, the
// tap is a link with a scheme of our own (`wavi-file:`), answered by `openFileRef` — the push happens in RootView.
import Foundation
import Markdown
import SwiftUI
import UIKit

// swift-markdown has its own Text, Table, Image and Link (the syntax tree's); the reply is drawn with SwiftUI's.
private typealias Text = SwiftUI.Text
private typealias Image = SwiftUI.Image

// MARK: - File paths in inline code

/// A path an agent printed in inline code, with the line it names: `src/a.ts`, `src/a.ts:42`, `src/a.ts#L42`.
struct FileRef: Hashable, Sendable {
  /// As written, relative to the session's folder or absolute; no line suffix.
  let path: String
  let line: Int?
  let column: Int?
}

/// Its file's name, which is what a chip shows.
func fileRefName(_ path: String) -> String {
  path.split(separator: "/").last.map(String.init) ?? path
}

private let maxFileRefLength = 1024

/// The extensions a bare name (`index.ts`, no `/`) must have to be a file; a path with a folder keeps any extension.
private let bareFileExtensions: Set<String> = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "swift", "kt", "java", "py", "rb", "go", "rs", "c", "h", "cc",
  "cpp", "hpp", "m", "mm", "cs", "php", "sh", "zsh", "bash", "yml", "yaml", "toml", "xml", "html", "css", "scss", "less", "sql",
  "txt", "lock", "plist", "xcstrings", "gradle", "vue", "svelte", "astro"
]

/// The file a whole inline code span names, or nil when it is not one (PRD v1.229 ②, after the desktop's
/// `findPathCandidates` narrowed to paths with a file extension — Orca's rule: miss one rather than link prose).
/// A path has no spaces, keeps a `:line[:col]` or `#Lline` suffix that the chip hides, and is shown as the file.
func fileRef(inCode code: String) -> FileRef? {
  var body = code.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !body.isEmpty, body.utf8.count <= maxFileRefLength else { return nil }
  guard !body.contains(where: \.isWhitespace) else { return nil }
  if body.hasPrefix("@") { body.removeFirst() } // agents mention files as @src/a.ts
  while let last = body.last, ".,;:!?".contains(last) { body.removeLast() }
  var line: Int?
  var column: Int?
  // `:42`, `:42:5`, `:42-50`, `#L42`, `#L10-L20`: the line is the first number; a range's end is not kept.
  if let suffix = body.wholeMatch(of: /^(.*?)(?::(\d+)(?::(\d+)|-\d+)?|#L(\d+)(?:-L?\d+)?)$/) {
    body = String(suffix.1)
    line = Int(suffix.2 ?? suffix.4 ?? "")
    column = suffix.3.flatMap { Int($0) }
  }
  // A colon left over is a scheme or `error:`, not a path; a path has a letter, a file's extension, and never climbs out
  // of the folder it is relative to (the Mac checks that again).
  guard !body.contains(":"), body.contains(where: \.isLetter), !body.hasPrefix("~") else { return nil }
  let segments = body.split(separator: "/", omittingEmptySubsequences: true)
  guard !segments.contains(".."), segments.contains(where: { $0 != "." }) else { return nil }
  guard let ext = body.firstMatch(of: /\.([A-Za-z0-9]{1,12})$/)?.1 else { return nil }
  // `console.log`, `user.name`, `Array.map`, `example.com` have an extension too: without a folder in front, only a real
  // source / config / doc extension makes a file.
  guard body.contains("/") || bareFileExtensions.contains(ext.lowercased()) else { return nil }
  return FileRef(path: body, line: line.flatMap { $0 > 0 ? $0 : nil }, column: column.flatMap { $0 > 0 ? $0 : nil })
}

// MARK: - Blocks

/// One inline run of a paragraph, heading or table cell, before it is drawn.
enum MarkdownInline: Hashable, Sendable {
  case text(String)
  case code(String)
  case strong([MarkdownInline])
  case emphasis([MarkdownInline])
  case strikethrough([MarkdownInline])
  case link(destination: String, [MarkdownInline])
  case lineBreak
}

/// One block of a reply, as `MarkdownText` draws it.
struct MarkdownBlock: Hashable, Sendable {
  enum Kind: Hashable, Sendable {
    case paragraph([MarkdownInline])
    case heading(level: Int, [MarkdownInline])
    case quote([MarkdownInline])
    case code(language: String?, code: String)
    /// A GitHub table: the header's cells, then each row's (padded or cut to the header's count).
    case table(header: [[MarkdownInline]], rows: [[[MarkdownInline]]])
    case rule
  }
  let kind: Kind
  /// A list's nesting: 0 at the margin, 22 more per level.
  var level = 0
  /// A list item's marker (`•`, `◦`, `▪`, or `1.`); nil outside a list.
  var marker: String?
  /// A task list item: true when its box is ticked.
  var checked: Bool?
}

/// `text` parsed into the blocks above. Every call parses (tests and the shots want that); the views use
/// `parsedBlocks`, which keeps the result per text.
func markdownBlocks(_ text: String) -> [MarkdownBlock] {
  markdownBlocks(Document(parsing: text))
}

func markdownBlocks(_ document: Document) -> [MarkdownBlock] {
  document.blockChildren.flatMap { blocks(of: $0, level: 0) }
}

private let bullets = ["•", "◦", "▪"]

private func blocks(of markup: BlockMarkup, level: Int) -> [MarkdownBlock] {
  switch markup {
  case let paragraph as Paragraph:
    return [MarkdownBlock(kind: .paragraph(inlines(of: paragraph)), level: level)]
  case let heading as Heading:
    return [MarkdownBlock(kind: .heading(level: heading.level, inlines(of: heading)), level: level)]
  case let code as CodeBlock:
    // The parser's text ends with the newline of the last line; drawn, that is an empty line under the code.
    let text = code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code
    return [MarkdownBlock(kind: .code(language: code.language?.isEmpty == false ? code.language : nil, code: text), level: level)]
  case let rule as ThematicBreak:
    _ = rule
    return [MarkdownBlock(kind: .rule, level: level)]
  case let quote as BlockQuote:
    // One bar around each run of the quote's paragraphs and headings; a block inside it that cannot be words (a list, code,
    // a table) is emitted where it stands, so the document order is kept.
    var out: [MarkdownBlock] = []
    var words: [MarkdownInline] = []
    func flush() {
      if !words.isEmpty { out.append(MarkdownBlock(kind: .quote(words), level: level)) }
      words = []
    }
    for child in quote.blockChildren {
      switch child {
      case let paragraph as Paragraph:
        if !words.isEmpty { words.append(.lineBreak) }
        words += inlines(of: paragraph)
      case let heading as Heading:
        if !words.isEmpty { words.append(.lineBreak) }
        words += inlines(of: heading)
      default:
        flush()
        out += blocks(of: child, level: level)
      }
    }
    flush()
    return out
  case let table as Markdown.Table:
    return [MarkdownBlock(kind: tableKind(table), level: level)]
  case let list as UnorderedList:
    return listBlocks(list, level: level)
  case let list as OrderedList:
    return listBlocks(list, level: level)
  case let html as HTMLBlock:
    return [MarkdownBlock(kind: .paragraph([.text(html.rawHTML.trimmingCharacters(in: .whitespacesAndNewlines))]))]
  default:
    // Anything else the parser knows (a block directive, a custom block): its words, rather than nothing.
    let text = markup.format().trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? [] : [MarkdownBlock(kind: .paragraph([.text(text)]))]
  }
}

private func tableKind(_ table: Markdown.Table) -> MarkdownBlock.Kind {
  let header: [[MarkdownInline]] = table.head.cells.map { inlines(of: $0) }
  let rows: [[[MarkdownInline]]] = table.body.rows.map { row in
    let cells: [[MarkdownInline]] = row.cells.map { inlines(of: $0) }
    let padding: [[MarkdownInline]] = Array(repeating: [], count: max(header.count - cells.count, 0))
    return Array((cells + padding).prefix(header.count))
  }
  return .table(header: header, rows: rows)
}

private func listBlocks(_ list: any ListItemContainer, level: Int) -> [MarkdownBlock] {
  let ordered = list as? OrderedList
  let start = ordered.map { Int($0.startIndex) } ?? 1
  var out: [MarkdownBlock] = []
  for (index, item) in list.listItems.enumerated() {
    let marker = ordered == nil ? bullets[min(level, bullets.count - 1)] : "\(start + index)."
    let checked = item.checkbox.map { $0 == .checked }
    var first = true
    for child in item.blockChildren {
      switch child {
      case let nested as UnorderedList:
        out += listBlocks(nested, level: level + 1)
      case let nested as OrderedList:
        out += listBlocks(nested, level: level + 1)
      case let paragraph as Paragraph:
        out.append(MarkdownBlock(kind: .paragraph(inlines(of: paragraph)), level: first ? level : level + 1, marker: first ? marker : nil, checked: first ? checked : nil))
        first = false
      default:
        // A second paragraph, code, a quote, a table inside an item: its own block, aligned with the item's text (one level
        // in), without the marker again.
        out += blocks(of: child, level: level + 1)
        first = false
      }
    }
    if first {
      // An item with nothing in it still takes its line.
      out.append(MarkdownBlock(kind: .paragraph([]), level: level, marker: marker, checked: checked))
    }
  }
  return out
}

private func inlines(of container: some InlineContainer) -> [MarkdownInline] {
  container.inlineChildren.flatMap { inline(of: $0) }
}

private func inline(of markup: InlineMarkup) -> [MarkdownInline] {
  switch markup {
  case let text as Markdown.Text:
    return text.string.isEmpty ? [] : [.text(text.string)]
  case let code as InlineCode:
    return [.code(code.code)]
  case let strong as Strong:
    return [.strong(inlines(of: strong))]
  case let emphasis as Emphasis:
    return [.emphasis(inlines(of: emphasis))]
  case let strike as Strikethrough:
    return [.strikethrough(inlines(of: strike))]
  case let link as Markdown.Link:
    return [.link(destination: link.destination ?? "", inlines(of: link))]
  case let image as Markdown.Image:
    // An image is not fetched: its alt text is the words it would have had.
    return inlines(of: image)
  case is SoftBreak, is LineBreak:
    return [.lineBreak]
  case let html as InlineHTML:
    return [.text(html.rawHTML)]
  default:
    return [.text(markup.format())]
  }
}

// MARK: - Parsed once per text

/// The blocks of a reply, kept by its text: the feed redraws a page of the conversation whenever anything changes,
/// and parsing a long reply again each time is what the cache is for.
final class ParsedReplies: @unchecked Sendable {
  private let cache = NSCache<NSString, Box>()

  static let shared = ParsedReplies()

  final class Box: @unchecked Sendable {
    let blocks: [MarkdownBlock]
    init(_ blocks: [MarkdownBlock]) { self.blocks = blocks }
  }

  private init() {
    // A conversation's worth of replies; the oldest go first.
    cache.countLimit = 200
  }

  func blocks(for text: String) -> [MarkdownBlock] {
    if let box = cache.object(forKey: text as NSString) { return box.blocks }
    let blocks = markdownBlocks(text)
    cache.setObject(Box(blocks), forKey: text as NSString)
    return blocks
  }
}

/// `text`'s blocks, from the cache (parsed the first time).
func parsedBlocks(_ text: String) -> [MarkdownBlock] {
  ParsedReplies.shared.blocks(for: text)
}

// MARK: - Inline runs

/// JetBrains Mono at the size the code in a reply is drawn at, scaled with the text around it.
private let codeFont: Font = .custom("JetBrainsMono-Regular", size: 14, relativeTo: .callout)

private struct InlineStyle {
  var bold = false
  var italic = false
  var strike = false
  var link: URL?
  /// Whether a file path is a chip / a link to the file page: false where nothing answers the tap (no session).
  var files = true
  /// The chip's icon is drawn on its own background, which follows the colour scheme.
  var dark = true
}

private enum InlinePiece {
  case runs(AttributedString)
  /// A path in inline code: drawn with its icon, tappable.
  case chip(FileRef, dark: Bool)
}

private func runs(_ text: String, _ style: InlineStyle) -> AttributedString {
  var out = AttributedString(text)
  var intent: InlinePresentationIntent = []
  if style.bold { intent.insert(.stronglyEmphasized) }
  if style.italic { intent.insert(.emphasized) }
  if !intent.isEmpty { out.inlinePresentationIntent = intent }
  if style.strike { out.strikethroughStyle = .single }
  if let link = style.link {
    out.link = link
    // Figma 104A: a link is the text's own colour with an underline — colour means status only.
    out.foregroundColor = .textPrimary
    out.underlineStyle = .single
  }
  return out
}

private func pieces(of node: MarkdownInline, _ style: InlineStyle) -> [InlinePiece] {
  switch node {
  case .text(let text):
    return text.isEmpty ? [] : [.runs(runs(text, style))]
  case .lineBreak:
    return [.runs(runs("\n", style))]
  case .strong(let children):
    var bold = style
    bold.bold = true
    return children.flatMap { pieces(of: $0, bold) }
  case .emphasis(let children):
    var italic = style
    italic.italic = true
    return children.flatMap { pieces(of: $0, italic) }
  case .strikethrough(let children):
    var strike = style
    strike.strike = true
    return children.flatMap { pieces(of: $0, strike) }
  case .link(let destination, let children):
    // Another destination than a web page, a mail address or a file in the session is drawn as plain text.
    var linked = style
    linked.link = markdownLinkURL(destination, files: style.files)
    return children.flatMap { pieces(of: $0, linked) }
  case .code(let code):
    if style.files, let ref = fileRef(inCode: code) { return [.chip(ref, dark: style.dark)] }
    var inline = runs(code, style)
    inline.font = codeFont
    inline.backgroundColor = .fillSubtle
    return [.runs(inline)]
  }
}

/// The inline runs of a paragraph, heading or cell as one `Text`, so they wrap as prose. A chip is a piece of its own:
/// its icon is an image, which the text attributes cannot carry (a `Text(Image(…))` interpolation can).
private func markdownText(_ inlines: [MarkdownInline], files: Bool, dark: Bool) -> Text {
  var out: [Text] = []
  var runs = AttributedString()
  func flush() {
    if !runs.characters.isEmpty { out.append(Text(runs)); runs = AttributedString() }
  }
  func add(_ piece: InlinePiece) {
    switch piece {
    case .runs(let text): runs += text
    case .chip(let ref, let dark):
      flush()
      out.append(chip(ref, dark: dark))
    }
  }
  for node in inlines { pieces(of: node, InlineStyle(files: files, dark: dark)).forEach(add) }
  flush()
  return out.isEmpty ? Text("") : out.dropFirst().reduce(out[0], +)
}

/// A link's destination as a URL to open: web pages and mail go to the system, a file path in the session opens the file
/// page (`[a.ts](src/a.ts:12)`), anything else is nil.
func markdownLinkURL(_ destination: String, files: Bool) -> URL? {
  let lowered = destination.lowercased()
  if lowered.hasPrefix("http://") || lowered.hasPrefix("https://") || lowered.hasPrefix("mailto:") {
    return URL(string: destination) ?? destination.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap { URL(string: $0) }
  }
  guard files, let ref = fileRef(inCode: destination.removingPercentEncoding ?? destination) else { return nil }
  return ref.url
}

/// A chip: the file icon and the name on one `fillSubtle` background. The icon is an image, which text attributes cannot
/// paint a background behind, so the background is part of the image (one per colour scheme, 14 pt icon, as tall as the
/// line); the name's run has the same background, with thin spaces for the padding. VoiceOver reads "文件 name".
private func chip(_ ref: FileRef, dark: Bool) -> Text {
  var name = runs("\u{2009}" + fileRefName(ref.path) + "\u{2009}", InlineStyle())
  name.font = codeFont
  name.backgroundColor = .fillSubtle
  name.foregroundColor = .textPrimary
  if let url = ref.url { name.link = url }
  let icon = Image(fileChipIcon(dark: dark), scale: chipIconScale, label: Text("文件"))
  return Text(icon).baselineOffset(-4) + Text(name)
}

private let chipIconScale: CGFloat = 3

/// The icon on its background, drawn for one colour scheme (`Color.fillSubtle` and `textSecondary` are translucent, so the
/// background is not baked into a single image for both).
private func fileChipIcon(dark: Bool) -> CGImage {
  cachedChipIcons[dark ? 1 : 0]
}

private let cachedChipIcons: [CGImage] = [UIUserInterfaceStyle.light, .dark].map { style in
  let traits = UITraitCollection(userInterfaceStyle: style)
  let size = CGSize(width: 22, height: 19)
  let format = UIGraphicsImageRendererFormat()
  format.scale = chipIconScale
  let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
    UIColor(Color.fillSubtle).resolvedColor(with: traits).setFill()
    UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), byRoundingCorners: [.topLeft, .bottomLeft], cornerRadii: CGSize(width: 6, height: 6)).fill()
    if let source = UIImage(named: "Icons/file")?.withRenderingMode(.alwaysTemplate) {
      let tint = UIColor(Color.textSecondary).resolvedColor(with: traits)
      source.withTintColor(tint, renderingMode: .alwaysOriginal).draw(in: CGRect(x: 5, y: 2.5, width: 14, height: 14))
    }
  }
  return image.cgImage ?? UIImage().cgImage!
}

// MARK: - Chips open a file

/// A chip's link: `wavi-file:?path=…&line=…`, answered by `openFileRef` rather than by a browser.
extension FileRef {
  var url: URL? {
    var components = URLComponents()
    components.scheme = "wavi-file"
    components.queryItems = [URLQueryItem(name: "path", value: path)] + (line.map { [URLQueryItem(name: "line", value: "\($0)")] } ?? [])
    return components.url
  }

  init?(_ url: URL) {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false), components.scheme == "wavi-file" else { return nil }
    let items = components.queryItems ?? []
    guard let path = items.first(where: { $0.name == "path" })?.value, !path.isEmpty else { return nil }
    self.init(path: path, line: items.first(where: { $0.name == "line" })?.value.flatMap(Int.init), column: nil)
  }
}

/// The session a reply belongs to, for the chips in it.
private struct FileSessionKey: EnvironmentKey {
  static let defaultValue: String? = nil
}

/// Opens the file a chip names: RootView pushes the file page onto the stack.
private struct OpenFileRefKey: EnvironmentKey {
  static let defaultValue: @MainActor (String, FileRef) -> Void = { _, _ in }
}

extension EnvironmentValues {
  var fileSession: String? {
    get { self[FileSessionKey.self] }
    set { self[FileSessionKey.self] = newValue }
  }

  var openFileRef: @MainActor (String, FileRef) -> Void {
    get { self[OpenFileRefKey.self] }
    set { self[OpenFileRefKey.self] = newValue }
  }
}

// MARK: - The reply

/// The agent's Markdown, drawn (Figma 104A / 104A′): paragraphs and headings, lists indented 22 a level, task list
/// boxes, quotes behind a 2-wide bar, a hairline for a thematic break, fenced code with its language and a copy
/// button, tables (header in medium, a hairline under each row, scrolling sideways when wider than the reply).
struct MarkdownText: View {
  let text: String
  @Environment(\.fileSession) private var session
  @Environment(\.openFileRef) private var openFile

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(parsedBlocks(text).enumerated()), id: \.offset) { _, block in
        MarkdownBlockView(block: block)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .tint(Color.textPrimary)
    .environment(\.openURL, OpenURLAction { url in
      guard let ref = FileRef(url), let session else { return .systemAction }
      openFile(session, ref)
      return .handled
    })
  }
}

private struct MarkdownBlockView: View {
  let block: MarkdownBlock
  /// A path is a chip only where a tap can open it: a reply in a session, not the plan sheet over one.
  @Environment(\.fileSession) private var session
  @Environment(\.colorScheme) private var scheme

  private func words(_ inlines: [MarkdownInline]) -> Text { markdownText(inlines, files: session != nil, dark: scheme == .dark) }

  var body: some View {
    switch block.kind {
    case .paragraph(let inlines):
      row(words(inlines))
    case .heading(let level, let inlines):
      words(inlines)
        .font(headingFont(level))
        .foregroundStyle(Color.textPrimary)
        .padding(.top, 4)
        .padding(.leading, indent)
    case .quote(let inlines):
      HStack(alignment: .top, spacing: 10) {
        Rectangle().fill(Color.lineStrong).frame(width: 2)
        words(inlines).font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textSecondary)
      }
      .fixedSize(horizontal: false, vertical: true)
      .padding(.leading, indent)
    case .code(let language, let code):
      MarkdownCodeBlock(language: language, code: code).padding(.leading, indent)
    case .table(let header, let rows):
      MarkdownTable(header: header, rows: rows).padding(.leading, indent)
    case .rule:
      Rectangle().fill(Color.hairline).frame(height: 1).padding(.vertical, 8)
    }
  }

  private var indent: CGFloat { CGFloat(min(block.level, 6)) * 22 }

  private func headingFont(_ level: Int) -> Font {
    // 20 / 18 / 16, each scaled with the text style it is nearest to.
    switch level {
    case 1: .system(size: UIFontMetrics(forTextStyle: .title3).scaledValue(for: 20), weight: .semibold)
    case 2: .system(size: UIFontMetrics(forTextStyle: .body).scaledValue(for: 18), weight: .semibold)
    default: .system(size: UIFontMetrics(forTextStyle: .callout).scaledValue(for: 16), weight: .semibold)
    }
  }

  @ViewBuilder private func row(_ content: Text) -> some View {
    let text = content.font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textPrimary)
    if block.checked != nil {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        CheckBox(done: block.checked == true)
        if block.checked == true { text.foregroundStyle(Color.textSecondary) } else { text }
      }
      .padding(.leading, indent)
    } else if let marker = block.marker {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Group {
          if marker == "▪" {
            // The UI font has no ▪ glyph (it drew a missing-glyph box): a 5 pt square on the text's centre line.
            Rectangle().fill(Color.textSecondary).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 5 }
          } else {
            Text(marker).font(.ui(.callout)).foregroundStyle(Color.textSecondary)
          }
        }
        .frame(minWidth: 16, alignment: .leading)
        text
      }
      .padding(.leading, indent)
    } else {
      text.padding(.leading, indent)
    }
  }
}

/// A task list item's box: 16×16, solid with a check when done, an outline when not.
private struct CheckBox: View {
  let done: Bool

  var body: some View {
    Group {
      if done {
        RoundedRectangle(cornerRadius: 4).fill(Color.textPrimary)
          .overlay(Icon("check", size: 11).foregroundStyle(Color.bgApp).dynamicTypeSize(.large))
      } else {
        RoundedRectangle(cornerRadius: 4).strokeBorder(Color.lineStrong, lineWidth: 1.5)
      }
    }
    .frame(width: 16, height: 16)
    .accessibilityLabel(done ? String(localized: "已完成") : String(localized: "未完成"))
  }
}

/// Fenced code: the language on the left of a header row, a copy button on the right, the code scrolling sideways
/// (Figma 104A).
private struct MarkdownCodeBlock: View {
  let language: String?
  let code: String
  @State private var copies = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(language ?? "").font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1)
        Spacer(minLength: 0)
        Button {
          UIPasteboard.general.string = code
          copies += 1
        } label: {
          CopyGlyph().foregroundStyle(Color.textSecondary).frame(width: 16, height: 16).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(String(localized: "复制代码"))
        .sensoryFeedback(.impact(weight: .light), trigger: copies)
      }
      .padding(.horizontal, 12)
      .padding(.top, 10)
      .padding(.bottom, 6)
      ScrollView(.horizontal, showsIndicators: false) {
        Text(code).font(.mono(.caption)).lineSpacing(4).foregroundStyle(Color.textPrimary).padding(.horizontal, 12).padding(.bottom, 12).textSelection(.enabled)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: 12))
  }
}

/// Two overlapped rounded squares, at the desktop's 1.75 stroke: the copy button's mark (the phone's icon set comes from
/// the desktop's Hugeicons list, and has no copy glyph yet).
private struct CopyGlyph: View {
  var body: some View {
    Path { path in
      path.addRoundedRect(in: CGRect(x: 1, y: 4, width: 10, height: 11), cornerSize: CGSize(width: 2.5, height: 2.5))
      path.move(to: CGPoint(x: 5, y: 4))
      path.addLine(to: CGPoint(x: 5, y: 3))
      path.addQuadCurve(to: CGPoint(x: 6.8, y: 1.2), control: CGPoint(x: 5, y: 1.2))
      path.addLine(to: CGPoint(x: 12.8, y: 1.2))
      path.addQuadCurve(to: CGPoint(x: 14.6, y: 3), control: CGPoint(x: 14.6, y: 1.2))
      path.addLine(to: CGPoint(x: 14.6, y: 9))
      path.addQuadCurve(to: CGPoint(x: 12.8, y: 10.8), control: CGPoint(x: 14.6, y: 10.8))
      path.addLine(to: CGPoint(x: 11, y: 10.8))
    }
    .stroke(style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
  }
}

/// A Markdown table: columns as wide as their text, between 48 and 220 (a longer cell wraps), the whole table scrolling
/// sideways when it is wider than the reply, fading out at its right edge while there is more to the right. Each
/// column's width is measured first and every cell is laid out at that width: inside a sideways ScrollView nothing
/// proposes a width, so a Grid sized its rows for one-line cells while the cells wrapped at 220, and the rows overlapped.
private struct MarkdownTable: View {
  let header: [[MarkdownInline]]
  let rows: [[[MarkdownInline]]]
  /// Each column's widest cell on one line.
  @State private var natural: [Int: CGFloat] = [:]
  @State private var available: CGFloat = 0
  /// Scrolled to the right end: the last column is then fully readable and the fade goes.
  @State private var atEnd = false
  @Environment(\.fileSession) private var session
  @Environment(\.colorScheme) private var scheme

  private static let spacing: CGFloat = 12

  private func width(_ column: Int) -> CGFloat { min(max(natural[column] ?? 48, 48), 220) }

  var body: some View {
    let columns = Array(header.indices)
    let total = columns.map(width).reduce(0, +) + Self.spacing * CGFloat(max(columns.count - 1, 0))
    ScrollView(.horizontal, showsIndicators: false) {
      VStack(alignment: .leading, spacing: 0) {
        row(header, header: true)
        Rectangle().fill(Color.lineStrong).frame(width: total, height: 1)
        ForEach(Array(rows.enumerated()), id: \.offset) { index, cells in
          row(cells, header: false)
          if index < rows.count - 1 { Rectangle().fill(Color.hairline).frame(width: total, height: 1) }
        }
      }
      .background(alignment: .topLeading) {
        HStack(alignment: .top, spacing: 0) {
          ForEach(columns, id: \.self) { column in
            VStack(alignment: .leading, spacing: 0) {
              cell(header[column], header: true)
              ForEach(Array(rows.enumerated()), id: \.offset) { _, cells in cell(cells[column], header: false) }
            }
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { natural[column] = $0 }
          }
        }
        .hidden()
      }
    }
    // Wider than the reply: the right edge fades, so a cut cell reads as more to the right rather than as the end.
    .overlay(alignment: .trailing) {
      if natural.count == columns.count && total > available && !atEnd {
        LinearGradient(colors: [Color.bgApp.opacity(0), Color.bgApp], startPoint: .leading, endPoint: .trailing)
          .frame(width: 32)
          .allowsHitTesting(false)
      }
    }
    .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.x + $0.containerSize.width >= $0.contentSize.width - 1 } action: { _, end in atEnd = end }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { available = $0 }
  }

  private func row(_ cells: [[MarkdownInline]], header: Bool) -> some View {
    HStack(alignment: .top, spacing: Self.spacing) {
      ForEach(Array(cells.enumerated()), id: \.offset) { column, inlines in
        cell(inlines, header: header).fixedSize(horizontal: false, vertical: true).frame(width: width(column), alignment: .leading)
      }
    }
    .padding(.vertical, 6)
  }

  private func cell(_ inlines: [MarkdownInline], header: Bool) -> some View {
    markdownText(inlines, files: session != nil, dark: scheme == .dark).font(.ui(.subheadline, medium: header)).foregroundStyle(Color.textPrimary)
  }
}
