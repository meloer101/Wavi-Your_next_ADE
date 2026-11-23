// The file an agent's reply points at, read-only (PRD F22 v1.229 ②, Figma 104A): the Mac reads it inside the session's
// folder and the phone draws it with its line numbers, both ways, at the line the chip named.
import SwiftUI

struct FileView: View {
  let session: String
  let path: String
  let line: Int?
  @Environment(AppModel.self) private var model
  @State private var preview: RemoteFilePreview?
  @State private var error: String?

  var body: some View {
    Group {
      if let preview {
        switch preview.kind {
        case "text": FileText(text: preview.text ?? "", line: line)
        case "binary": EmptyState(title: String(localized: "这个文件是二进制文件，不能在这里显示"))
        case "too-large": EmptyState(title: String(localized: "这个文件太大，不能在这里显示"))
        default: EmptyState(title: String(localized: "这个文件不在会话目录里"))
        }
      } else if let error {
        EmptyState(title: error)
      } else {
        Spinner(color: .textSecondary).frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityLabel("正在读取文件")
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) {
        VStack(spacing: 2) {
          Text(fileRefName(path)).font(.ui(.headline)).foregroundStyle(Color.textPrimary).lineLimit(1)
          Text(path).font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1)
        }
      }
    }
    .task {
      let result = await model.call(.file(session: session, path: path))
      if let data = result.decode(RemoteFilePreview.self) { preview = data } else { error = result.error ?? String(localized: "没有读到文件") }
    }
  }
}

/// The file as numbered lines, never wrapped: the view scrolls both ways, from the top left (as the diff view does), and
/// opens at `line` when the chip named one.
private struct FileText: View {
  let text: String
  let line: Int?
  @ScaledMetric(relativeTo: .caption) private var gutter: CGFloat = 36
  @State private var widest: CGFloat = 0

  var body: some View {
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    GeometryReader { geo in
      ScrollViewReader { proxy in
        ScrollView([.horizontal, .vertical]) {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, code in
              HStack(spacing: 0) {
                Text("\(index + 1)").frame(width: gutter, alignment: .trailing).foregroundStyle(Color.textSecondary)
                Text(String(code)).foregroundStyle(Color.textPrimary).fixedSize().padding(.trailing, 16)
              }
              .frame(minWidth: geo.size.width, maxWidth: .infinity, minHeight: 20, alignment: .leading)
              .id(index + 1)
            }
          }
          .font(.mono(.caption))
          .frame(width: max(widest + gutter, geo.size.width), alignment: .leading)
          .background(alignment: .topLeading) {
            // The widest line lays itself out once, so the sideways scroll reaches every line's end.
            if let longest = lines.max(by: { $0.count < $1.count }) {
              Text(String(longest)).font(.mono(.caption)).lineLimit(1).fixedSize().hidden()
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { widest = $0 }
            }
          }
        }
        .onAppear { if let line { proxy.scrollTo(line, anchor: .center) } }
      }
    }
  }
}
