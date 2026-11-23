// 会话页 · 聊天视图 (Figma 61B, states 62F and 63C1–63C4): the session's conversation from its transcript, newest at the
// bottom; what the agent is doing right now (its text reaches the transcript only once a block is written, PRD §6.16);
// the composer floating over it as glass; and the sheet for what it waits for. The 变更 capsule opens Git · 变更.
import SwiftUI

struct SessionView: View {
  let id: String
  @Environment(AppModel.self) private var model
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var changed: Int?
  /// Figma 98′: the message flying in from the composer, over the conversation and the composer.
  @State private var flight: Shot?

  var body: some View {
    let session = model.session(id)
    Group {
      if let session {
        feed(session)
      } else if model.isOpen {
        EmptyState(title: String(localized: "这个会话已经不在 Mac 上"), action: String(localized: "回到会话列表")) { model.showList() }
      } else {
        EmptyState(title: model.connection.text, action: String(localized: "重试")) { model.wake() }
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) { title(session) }
      if let changed {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(value: Route.changes(id)) {
            HStack(spacing: 8) {
              Icon("git-branch")
              Text("\(changed)").font(.ui(.callout, medium: true)).monospacedDigit()
            }
            .foregroundStyle(Color.textPrimary)
          }
          .accessibilityLabel("变更")
        }
      }
    }
    // Coming back from a tool, Git · 变更 or the camera, the feed is still the one on screen (RootView unwatches when the
    // session leaves the navigation path).
    .task(id: id) { if model.watching != id { await model.watch(id) } }
    .task(id: model.isOpen) {
      guard model.isOpen, let data = await model.call(.changes(session: id)).decode(GitChanges.self) else { return }
      changed = data.uncommitted.count + data.committed.count
    }
  }

  private func title(_ session: RemoteSession?) -> some View {
    VStack(spacing: 2) {
      Text(session?.title ?? String(localized: "会话")).font(.ui(.headline)).foregroundStyle(Color.textPrimary).lineLimit(1)
      if let session {
        HStack(spacing: 8) {
          StatusGlyph(status: session.status)
          let project = model.sessions.projects.first { $0.id == session.projectId }?.name
          let place = [project, session.branch].compactMap { $0 }.joined(separator: " · ")
          if !place.isEmpty { Text(place).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1) }
          AgentMark(agent: session.agent, size: 14)
        }
      }
    }
  }

  private func feed(_ session: RemoteSession) -> some View {
    let conversation = model.conversation
    let prompts = model.prompts.filter { $0.sessionId == id }.sorted { $0.createdAt < $1.createdAt }
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        if conversation?.loading == true { Spinner(color: .textSecondary).frame(maxWidth: .infinity).accessibilityLabel("正在读取更早的消息") }
        let blocks = transcriptBlocks(conversation?.feed.items ?? [], receipts: model.receipts[id] ?? [],
          turnOpen: session.status == .running || session.status == .needsYou)
        ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
          VStack(alignment: .leading, spacing: 8) {
            // A fold carries the mark on its own row (104B1); the other blocks have it above them.
            let starts = startsTurn(blocks, at: index)
            if starts, !isFold(block) { AgentAvatar(agent: session.agent) }
            BlockRow(block: block, session: id, agent: starts ? session.agent : nil)
          }
          .onAppear { if index == 0 { Task { await model.loadOlder() } } }
        }
        let sending = model.sending[id] ?? []
        let run = runRow(session: session, turnStart: model.turnStarts[id], sending: sending, lastIsUser: blocks.last.map(isUser) ?? true)
        // A running turn's row ends its turn, above messages sent meanwhile (they wait on the Mac); a message that
        // starts a turn has the row under it.
        if session.status == .running, let run { RunTurn(run: run, agent: session.agent) }
        ForEach(sending) { item in
          SendingRow(item: item, session: id, flying: flight?.item.id == item.id,
                     land: model.launch?.id == item.id || flight?.item.id == item.id ? { land(item, words: $0) } : nil)
        }
        if session.status != .running, let run { RunTurn(run: run, agent: session.agent) }
      }
      .padding(.horizontal, Metric.margin)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      // Taps on the conversation put the keyboard away (a short one does not scroll, so dragging cannot).
      .contentShape(Rectangle())
      .onTapGesture { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
    }
    // A short conversation starts at the top; a long one opens at its end and stays there as it grows.
    .defaultScrollAnchor(.top, for: .alignment)
    .defaultScrollAnchor(.bottom, for: .initialOffset)
    .defaultScrollAnchor(.bottom, for: .sizeChanges)
    // 46′: text never runs under the title; the system's harder edge instead of the soft blur.
    .scrollEdgeEffectStyle(.hard, for: .top)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaBar(edge: .top) {
      // Without a link the conversation stays as it was, under a line that says so (62F).
      if !model.isOpen {
        Group {
          if model.link == .connecting {
            Notice(tone: .info, message: model.connection.text)
          } else {
            Notice(tone: .warning, message: model.connection.text, action: String(localized: "重试")) { model.wake() }
          }
        }
        .padding(.horizontal, Metric.margin)
        .padding(.bottom, 4)
      }
    }
    .safeAreaBar(edge: .bottom) {
      VStack(spacing: 8) {
        PromptBar(prompts: prompts)
        if let settings = session.settings, !settings.items.isEmpty {
          SettingsPill(session: session, settings: settings).padding(.horizontal, Metric.margin)
        }
        Composer(session: id, running: session.status == .running)
      }
    }
    .overlay(alignment: .topLeading) {
      GeometryReader { proxy in
        if let flight {
          let origin = proxy.frame(in: .global).origin
          FlyingCopy(shot: flight, session: id) { if self.flight?.item.id == flight.item.id { self.flight = nil } }
            .offset(x: flight.words.minX - 12 - origin.x, y: flight.words.minY - 8 - origin.y)
        }
      }
      .allowsHitTesting(false)
    }
  }

  /// Figma 98′ / 98D: where the message just sent landed (its words, global points). The first time, it flies in from
  /// where it was in the composer or fades in; while it flies, the place it lands moves with the conversation.
  private func land(_ item: ChatItem, words: CGRect) {
    if flight?.item.id == item.id {
      flight?.words = words
      return
    }
    guard let launch = model.launch, launch.id == item.id else { return }
    model.launched(item.id)
    let line = UIFont.preferredFont(forTextStyle: .callout).lineHeight + 5
    if case .fly(let dx, let dy) = Flight.of(from: launch.from, to: words.origin, height: words.height, line: line, reduced: reduceMotion) {
      flight = Shot(item: item, words: words, dx: dx, dy: dy)
    }
  }
}

/// A message flying in (Figma 98′): what it is, where its words land, and how far off it starts.
private struct Shot {
  let item: ChatItem
  var words: CGRect
  let dx: CGFloat
  let dy: CGFloat
}

/// Figma 98′ / 98D: a copy of the bubble that springs from the composer to where the message lands (--motion-spring:
/// ζ 0.7, 380 ms), its fill coming in from 60 ms (200 ms ease-out); drawn at the 60% of a message still sending.
private struct FlyingCopy: View {
  let shot: Shot
  let session: String
  let done: () -> Void
  @State private var home = false
  @State private var filled = false

  var body: some View {
    UserBubble(item: shot.item, session: session, filled: filled)
      .frame(width: shot.words.width + 24, alignment: .leading)
      .offset(x: home ? 0 : shot.dx, y: home ? 0 : shot.dy)
      .opacity(0.6)
      .accessibilityHidden(true)
      .onAppear {
        withAnimation(.spring(duration: 0.38, bounce: 0.3)) { home = true } completion: { done() }
        withAnimation(.easeOut(duration: 0.2).delay(0.06)) { filled = true }
      }
  }
}

/// A message of yours on its way to the Mac: drawn at once at 60% until the transcript has it, fading in (150 ms). The
/// one just sent reports where its words land (`land`); while its copy flies (`flying`) only the picture shows, fading
/// in from 60 ms (Figma 98′).
private struct SendingRow: View {
  let item: ChatItem
  let session: String
  let flying: Bool
  let land: ((CGRect) -> Void)?
  @State private var shown = false
  @State private var pictured = false

  var body: some View {
    UserRow(item: item, session: session, bubble: flying ? 0 : 1, picture: pictured ? 1 : 0, onWords: land)
      .opacity(shown ? 0.6 : 0)
      .onAppear {
        withAnimation(.easeOut(duration: 0.15)) { shown = true }
        withAnimation(.easeOut(duration: 0.2).delay(0.06)) { pictured = true }
      }
  }
}

/// What you sent: your picture alone on its row, the bubble under it on the right (Figma 61B).
private struct UserRow: View {
  let item: ChatItem
  let session: String
  var bubble: Double = 1
  var picture: Double = 1
  /// The time and copy under the bubble (104B1): on the conversation's own rows, not on a message still sending.
  var meta = false
  var onWords: ((CGRect) -> Void)?

  var body: some View {
    VStack(alignment: .trailing, spacing: 8) {
      MyAvatarView().opacity(picture)
      HStack {
        Spacer(minLength: 48)
        UserBubble(item: item, session: session, onWords: onWords).opacity(bubble)
      }
      if meta { MessageMeta(item: item) }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }
}

/// Your words (and how many pictures went with them) in the bubble. `filled` off: the words without the fill (a copy
/// taking off from the composer, Figma 98′A). `onWords`: where the words are on screen, as they move.
private struct UserBubble: View {
  let item: ChatItem
  let session: String
  var filled = true
  var onWords: ((CGRect) -> Void)?

  var body: some View {
    let words = VStack(alignment: .leading, spacing: 4) {
      if let text = item.text, !text.isEmpty { UserText(text: text, key: "\(session)/\(item.id)") }
      if let images = item.images, images > 0 { Text("\(images) 张图片").font(.ui(.footnote)).foregroundStyle(Color.textSecondary) }
    }
    Group {
      if let onWords {
        words.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { onWords($0) }
      } else {
        words
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Color.fillStrong.opacity(filled ? 1 : 0), in: RoundedRectangle(cornerRadius: Metric.radiusGroup))
  }
}

/// The run row with the agent's mark above it when it starts the turn.
private struct RunTurn: View {
  let run: RunRow
  let agent: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if run.startsTurn { AgentAvatar(agent: agent) }
      RunLine(run: run)
    }
  }
}

/// Figma 91′: what the agent does now (or 思考中) and the turn's clock, a changed digit rolling into place.
private struct RunLine: View {
  let run: RunRow
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 8) {
      Text(run.action ?? String(localized: "思考中")).font(.ui(.subheadline)).lineLimit(1)
      TimelineView(.periodic(from: .now, by: 0.1)) { context in
        let clock = runClock(context.date.timeIntervalSince1970 * 1000 - run.since)
        Text(clock).font(.mono(.footnote)).monospacedDigit()
          .contentTransition(reduceMotion ? .identity : .numericText())
          .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: clock)
          .accessibilityHidden(true)
      }
    }
    .foregroundStyle(Color.textPrimary)
  }
}

/// The agent's first block after a message of the user's (or the first on screen) carries its mark above it.
private func isUser(_ block: TranscriptBlock) -> Bool { if case .item(let item) = block { item.kind == "user" } else { false } }

private func isFold(_ block: TranscriptBlock) -> Bool { if case .fold = block { true } else { false } }

private func startsTurn(_ blocks: [TranscriptBlock], at index: Int) -> Bool {
  if case .receipt = blocks[index] { return false }
  guard !isUser(blocks[index]) else { return false }
  return index == 0 || isUser(blocks[index - 1])
}

/// The agent's mark in a 24 solid circle, alone on its row (Figma 64A).
struct AgentAvatar: View {
  let agent: String
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = 24

  var body: some View {
    AgentMark(agent: agent, size: side * 0.58, color: .solidOn)
      .frame(width: side, height: side)
      .background(Color.solidFill, in: Circle())
  }
}

/// My avatar, alone on its row on the right; nothing when none is set (Figma 64A).
private struct MyAvatarView: View {
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = 24

  var body: some View {
    if let image = MyAvatar.shared.image {
      Image(uiImage: image).resizable().scaledToFill().frame(width: side, height: side).clipShape(Circle())
        .accessibilityHidden(true)
    }
  }
}

/// One block of the conversation (Figma 62E): an item, a folded run of tool calls, a turn's totals or an answer.
struct BlockRow: View {
  let block: TranscriptBlock
  let session: String
  /// The agent whose mark goes beside a fold that starts its turn.
  var agent: String?
  /// A fold drawn open (the screenshots of 104B2).
  var foldOpen = false

  var body: some View {
    switch block {
    case .item(let item): FeedRow(item: item, session: session)
    case .fold(let fold): FoldRow(fold: fold, session: session, agent: agent, open: foldOpen)
    case .reply(let item):
      VStack(alignment: .leading, spacing: 8) {
        MarkdownText(text: item.text ?? "")
        MessageMeta(item: item)
      }
    case .tools(let run): ToolGroupRow(run: run, session: session)
    case .turn(let turn):
      NavigationLink(value: Route.turn(session: session, tools: turn.tools)) { TurnRow(turn: turn) }.buttonStyle(.plain)
    case .receipt(let receipt): ReceiptRow(receipt: receipt)
    }
  }
}

private struct ReceiptRow: View {
  let receipt: Receipt

  var body: some View {
    HStack(spacing: 8) {
      Icon(receipt.onPhone ? "smartphone" : "square-terminal", size: 14)
      Text(receipt.text).font(.ui(.footnote)).lineLimit(1)
    }
    .foregroundStyle(Color.textSecondary)
    .frame(maxWidth: .infinity)
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// Under a message of yours and under a finished turn's reply (Figma 104B): when it was written, and a button that copies
/// its text (a reply's Markdown source). Right-aligned under your bubble, left-aligned under a reply.
private struct MessageMeta: View {
  let item: ChatItem
  @State private var copies = 0

  var body: some View {
    HStack(spacing: 8) {
      Text(messageTime(item.at, now: Date().timeIntervalSince1970 * 1000)).font(.ui(.caption)).monospacedDigit()
      Button {
        UIPasteboard.general.string = item.text ?? ""
        copies += 1
      } label: {
        Icon("copy", size: 16).frame(minWidth: 24, minHeight: 24).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(String(localized: "复制"))
      .sensoryFeedback(.impact(weight: .light), trigger: copies)
    }
    .foregroundStyle(Color.textSecondary)
    .frame(maxWidth: .infinity, alignment: item.kind == "user" ? .trailing : .leading)
  }
}

/// Figma 104B1 / 104B2: a finished turn's process as one line, 「工作了 1 分 15 秒 ›」, with the agent's mark on the same row
/// when it starts the turn; opened, the process in an inset box, in order.
struct FoldRow: View {
  let fold: TurnFold
  let session: String
  let agent: String?
  @State private var open: Bool

  init(fold: TurnFold, session: String, agent: String?, open: Bool = false) {
    self.fold = fold
    self.session = session
    self.agent = agent
    _open = State(initialValue: open)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Button { open.toggle() } label: {
        HStack(spacing: 8) {
          if let agent { AgentAvatar(agent: agent) }
          Text(workedFor(fold.ms)).font(.ui(.subheadline))
          Icon("chevron-right", size: 14).rotationEffect(.degrees(open ? 90 : 0))
        }
        .foregroundStyle(Color.textSecondary)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(workedFor(fold.ms))
      .accessibilityValue(open ? String(localized: "已展开") : String(localized: "已收起"))
      if open {
        VStack(alignment: .leading, spacing: 4) {
          ForEach(fold.entries) { entry in
            switch entry {
            case .item(let item) where item.kind == "text":
              Text(item.text ?? "").font(.ui(.subheadline)).lineSpacing(4).foregroundStyle(Color.textSecondary).padding(.vertical, 4)
            case .item(let item) where item.kind == "tool":
              NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item, compact: true) }.buttonStyle(.plain)
            case .item(let item): FeedRow(item: item, session: session)
            case .receipt(let receipt): ReceiptRow(receipt: receipt)
            default: EmptyView()
            }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
      }
    }
  }
}

/// Consecutive tool calls as one line that says what they did; open, the calls in an inset box that scrolls on its own
/// past 156 (a running run starts open).
private struct ToolGroupRow: View {
  let run: ToolRun
  let session: String
  @State private var open: Bool?
  @State private var height: CGFloat = 0

  var body: some View {
    let expanded = open ?? run.running
    VStack(alignment: .leading, spacing: 8) {
      Button { open = !expanded } label: {
        HStack(spacing: 8) {
          Icon("chevron-right", size: 14).rotationEffect(.degrees(expanded ? 90 : 0))
          Text(run.summary).font(.ui(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
          if run.showCounts { Counts(added: run.added, removed: run.removed) }
        }
        .foregroundStyle(Color.textSecondary)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityValue(expanded ? String(localized: "已展开") : String(localized: "已收起"))
      if expanded {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(run.items) { item in
              NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item, compact: true) }.buttonStyle(.plain)
            }
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 4)
          .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .frame(height: min(max(height, 1), 156))
        .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
      }
    }
  }
}

/// The end of a turn that changed files: one place to see what it changed (Figma 59 Mobile/TurnSummary).
private struct TurnRow: View {
  let turn: TurnChange

  var body: some View {
    HStack(spacing: 8) {
      Icon("file", size: 16).foregroundStyle(Color.textPrimary)
      Text("这一轮改了 \(turn.files) 个文件").font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary)
      Spacer(minLength: 0)
      Counts(added: turn.added, removed: turn.removed)
      Icon("chevron-right", size: 14).foregroundStyle(Color.textSecondary)
    }
    .padding(12)
    .background(Color.fillSubtle, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// One item of the conversation: the user's bubble, the agent's Markdown, thinking (folded), one row per tool call
/// (tap for 45D), system lines, and 未识别的条目 so an unknown line never breaks the rest.
struct FeedRow: View {
  let item: ChatItem
  let session: String
  @State private var open = false

  var body: some View {
    switch item.kind {
    case "user":
      UserRow(item: item, session: session, meta: true)
    case "text":
      MarkdownText(text: item.text ?? "")
    case "thinking":
      VStack(alignment: .leading, spacing: 8) {
        Button { open.toggle() } label: {
          HStack(spacing: 8) {
            Icon("chevron-right", size: 14).rotationEffect(.degrees(open ? 90 : 0))
            Text("思考\(item.ms.map { " \(max(1, Int(($0 / 1000).rounded())))s" } ?? "")").font(.ui(.subheadline))
          }
          .foregroundStyle(Color.textSecondary)
          .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityValue(open ? String(localized: "已展开") : String(localized: "已收起"))
        if open, let text = item.text { Text(text).font(.ui(.subheadline)).lineSpacing(4).foregroundStyle(Color.textSecondary).padding(.leading, 24) }
      }
    case "tool":
      NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item) }.buttonStyle(.plain)
    case "system":
      Text(item.text ?? "").font(.ui(.footnote)).foregroundStyle(Color.textSecondary).frame(maxWidth: .infinity)
    default:
      Text("未识别的条目").font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
    }
  }
}

/// Figma 96′A: the words of a message of yours. A long one opens folded to its first 8 lines, the last two fading, over
/// 「展开」; opened, 「收起」 at its foot folds it again. Folded only when that hides 3 lines or more (11 lines or more:
/// taller than its first 10), like the desktop (96A). Whether it is open is kept in the model while the app runs. The
/// conversation keeps its bottom still as it changes size, so the button stays where it was.
private struct UserText: View {
  let text: String
  /// Session and message id.
  let key: String
  @Environment(AppModel.self) private var model
  @State private var whole: CGFloat = 0
  @State private var firstTen: CGFloat = 0

  private func words() -> some View { Text(text).font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textPrimary) }

  var body: some View {
    let open = model.openMessages.contains(key)
    let foldable = firstTen > 0 && whole > firstTen + 1
    let folded = foldable && !open
    VStack(alignment: .leading, spacing: 4) {
      words()
        .lineLimit(folded ? 8 : nil)
        // Eight lines: the last two are the bottom quarter.
        .mask {
          LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: folded ? 0.75 : 1), .init(color: folded ? .clear : .black, location: 1)],
                         startPoint: .top, endPoint: .bottom)
        }
        .background(alignment: .top) {
          ZStack(alignment: .top) {
            words().fixedSize(horizontal: false, vertical: true)
              .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { whole = $0 }
            words().lineLimit(10).fixedSize(horizontal: false, vertical: true)
              .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { firstTen = $0 }
          }
          .hidden()
        }
      if foldable {
        Button { model.setMessageOpen(key, !open) } label: {
          HStack(spacing: 4) {
            Text(open ? "收起" : "展开")
            Icon("chevron-down", size: 12).rotationEffect(.degrees(open ? 180 : 0))
          }
          .font(.ui(.footnote))
          .foregroundStyle(Color.textPrimary)
          .padding(.vertical, 4)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(open ? String(localized: "已展开") : String(localized: "已收起"))
      }
    }
  }
}

private struct ToolLine: View {
  let item: ChatItem
  /// Inside a run's box: no MiniDiff.
  var compact = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        ToolMark(state: item.state)
        Text(item.name ?? "").font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary)
        Text(item.arg ?? "").font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
        if let diff = item.diff { Counts(added: diff.added, removed: diff.removed) }
      }
      if item.diff == nil, let tail = lastLine(item.output) {
        Text(tail).font(.mono(.caption)).foregroundStyle(item.state == "error" ? Color.statusError : Color.textSecondary).lineLimit(1)
      }
      if !compact, let diff = item.diff, item.name != "Write", let hunk = diff.hunks.first {
        MiniDiff(lines: miniLines(hunk.lines))
      }
    }
    .padding(.vertical, 4)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  /// A few lines of an Edit's first hunk, from one line before its first change (a hunk opens with 3 of context).
  private func miniLines(_ lines: [String]) -> [String] {
    let first = lines.firstIndex { $0.hasPrefix("+") || $0.hasPrefix("-") } ?? 0
    let from = max(0, first - 1)
    return Array(lines[from..<min(lines.count, from + 6)])
  }
}

/// A tool call's state (Figma 59 Mobile/ToolRow): a turning arc while it runs, a check when done, ✗ in the error colour.
/// Not a session status, so done is neutral.
struct ToolMark: View {
  let state: String?

  var body: some View {
    switch state {
    case "running": Spinner(color: .textSecondary).accessibilityLabel("运行中")
    case "error": Icon("x", size: 14).foregroundStyle(Color.statusError).frame(width: 14, height: 14).accessibilityLabel("出错")
    default: Icon("check", size: 14).foregroundStyle(Color.textSecondary).frame(width: 14, height: 14).accessibilityLabel("完成")
    }
  }
}
