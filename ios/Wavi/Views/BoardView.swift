// 看板 (PRD F22 v1.227, Figma 103 / 103′): the second tab. A segmented 进度 | GitHub at the top — remembered on this phone
// — and under it the desktop board's two pages. 进度 is the sessions grouped by status, each a card in its status colour:
// sections one under the other on a phone, five equal columns in landscape. GitHub is each project's open issues and PRs
// through the Mac's gh: a row opens the item, and from there the item can be opened on GitHub or handed to an agent.
import SwiftUI

/// Which page of 看板 is open; the last one is remembered on this phone (@AppStorage in RootView).
enum BoardPage: String {
  case progress, github
}

/// What WaviTests/BoardShots hands a screen in place of a Mac (the repo has no stand-in Mac): the answers the screen would
/// have received, the sessions it would list and whether the link is open. A screen uses what it was given and asks the
/// Mac for the rest.
struct BoardFixture {
  var connected = true
  var sessions: RemoteSessionList?
  var board: GitHubBoard?
  var detail: BoardDetail?
  var start: GitHubStart?
  var info: NewSessionView.Info?
  var models: NewSessionView.AgentModels?
}

struct BoardView: View {
  @Environment(AppModel.self) private var model
  @Binding var page: BoardPage
  var fixture: BoardFixture?

  /// The GitHub list's own state, kept while the other page is open: the scope picked here and what the Mac answered.
  @State private var scope: BoardScope = .all
  @State private var board: GitHubBoard?
  @State private var failure: String?
  /// Which scope is being asked for and whether its answer is still wanted: two taps in a row leave two requests in
  /// flight, and the first one's answer must not land under the second one's tabs (BoardRequest).
  @State private var request = BoardRequest()

  var body: some View {
    GeometryReader { proxy in
      let landscape = proxy.size.width > proxy.size.height
      VStack(spacing: 0) {
        Picker("看板", selection: $page) {
          Text("进度").tag(BoardPage.progress)
          Text("GitHub").tag(BoardPage.github)
        }
        .pickerStyle(.segmented)
        .frame(width: 176)
        .padding(.top, 4)
        .padding(.bottom, 8)
        switch page {
        case .progress: progress(landscape: landscape)
        case .github: github
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .background(Color.bgApp)
    .toolbar(.hidden, for: .navigationBar)
    .onAppear {
      if let data = fixture?.board, board == nil { board = data }
    }
    // `connected` is part of the id: with the Mac back after a drop the page asks again (its first request may have died
    // with the link), instead of leaving the spinner up for ever.
    .task(id: "\(page.rawValue) \(scope.rawValue) \(connected)") {
      guard page == .github, connected, fixture?.board == nil else { return }
      // Asking for the scope already on screen again (the page came back) keeps what the Mac answered.
      guard request.asked != scope.rawValue || board == nil else { return }
      await load()
    }
  }

  // MARK: 进度

  /// The Mac's session list (a test's own when it gave one) and whether the link to the Mac is open.
  private var list: RemoteSessionList { fixture?.sessions ?? model.sessions }
  private var connected: Bool { fixture?.connected ?? model.isOpen }

  @ViewBuilder private func progress(landscape: Bool) -> some View {
    let now = Date().timeIntervalSince1970 * 1000
    if boardGroups(list).isEmpty {
      if connected {
        EmptyState(title: String(localized: "Mac 上还没有会话"))
      } else if model.link == .connecting {
        ScrollView { Spinner(color: .textSecondary).frame(maxWidth: .infinity).padding(.top, 80).accessibilityLabel("正在读取会话") }
      } else {
        EmptyState(title: model.connection.text, action: String(localized: "重试")) { model.wake() }
      }
    } else {
      VStack(spacing: 0) {
        if !connected {
          // 62B: the list stays, under a line that says how old it is.
          Notice(tone: .warning, message: staleNotice(heardAt: model.heardAt, now: now), action: String(localized: "重试")) { model.wake() }
            .padding(.horizontal, Metric.margin)
            .padding(.bottom, 4)
        }
        ProgressBoard(list: list, now: now, landscape: landscape, stale: !connected)
          .refreshable { await model.refresh() }
      }
    }
  }

  // MARK: GitHub

  @ViewBuilder private var github: some View {
    if !connected {
      // 62B / 103I: the board does not keep GitHub's answers; without the Mac it says so.
      EmptyState(title: String(localized: "连上 Mac 后才能看 GitHub"), action: String(localized: "重试")) { model.wake() }
    } else if let failure, isInvalidRequest(failure) {
      EmptyState(title: String(localized: "Mac 上的 Wavi 要更新"), action: String(localized: "重试")) { Task { await load(force: true) } }
    } else if let failure {
      EmptyState(title: failure, action: String(localized: "重试")) { Task { await load(force: true) } }
    } else if let board, board.gh == "missing" || board.gh == "signed-out" {
      GHProblem(missing: board.gh == "missing") { Task { await load(force: true) } }
    } else if let board, board.gh == "ready" || board.projects != nil {
      let sections = boardSections(board, projects: list.projects, sessions: list.sessions, scope: scope)
      GitHubList(sections: sections, scope: $scope, now: Date().timeIntervalSince1970 * 1000, loading: request.loading) { await load(force: true) }
    } else {
      ScrollView {
        Spinner(color: .textSecondary).frame(maxWidth: .infinity).padding(.top, 80).accessibilityLabel("正在读取 GitHub")
      }
      .refreshable { await load(force: true) }
    }
  }

  /// `github-board`, 45 s: the Mac may be asking gh for every project (its own answer is cached for a minute unless
  /// `force`, which pull-to-refresh and 重新检查 send). The scope is read once, before the wait: an answer for a scope that
  /// is no longer on screen (全部 then 请我审阅, quickly) is dropped, and it does not clear the spinner either.
  private func load(force: Bool = false) async {
    let asking = scope.rawValue
    request.begin(asking)
    let result = await model.call(.githubBoard(scope: asking, force: force), timeout: 45)
    guard request.settle(asking) else { return }
    if let data = result.decode(GitHubBoard.self) {
      board = data
      failure = nil
    } else {
      // No message either (an answer that was not a board): say it failed rather than spin for ever.
      failure = result.error ?? String(localized: "没有读到 GitHub")
    }
  }
}

// MARK: - 进度

/// 等你处理 → 出错 → 待审阅 → 运行中 → 空闲 (→ 已退出): the desktop board's columns as sections, each card in its column's
/// colour. 空闲 starts folded; tapping a section's title folds or opens it. Landscape draws the same groups as equal
/// columns, every card three single lines (Figma 103′C).
struct ProgressBoard: View {
  let list: RemoteSessionList
  let now: Double
  var landscape = false
  /// The Mac is not reachable: the cards are what it last said (62B), so they are dimmed.
  var stale = false

  /// Folded sections by key; 空闲 starts folded (PRD F22 v1.227 ②). Landscape always shows every card: a column has room,
  /// and folding one there would hide a whole column.
  @State private var folded: Set<String> = [BoardGroupKey.idle.rawValue]

  var body: some View {
    let groups = boardGroups(list)
    if landscape {
      columns(groups)
    } else {
      sections(groups)
    }
  }

  private func sections(_ groups: [BoardGroup]) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(groups) { group in
          title(group, top: 20)
          if !folded.contains(group.key.rawValue) {
            ForEach(group.cards) { card in
              NavigationLink(value: Route.session(card.session.id)) { ProgressCardView(card: card, now: now, stale: stale) }
                .buttonStyle(.plain)
            }
          }
        }
      }
      .padding(.bottom, 40)
    }
  }


  /// The columns scroll as one (Figma 103′C): a short screen with six running sessions has more cards than a column can
  /// show, and one scroll for the whole row of columns keeps their tops level.
  private func columns(_ groups: [BoardGroup]) -> some View {
    ScrollView {
      HStack(alignment: .top, spacing: 12) {
        ForEach(groups) { group in
          VStack(alignment: .leading, spacing: 8) {
            title(group, top: 0)
            ForEach(group.cards) { card in
              NavigationLink(value: Route.session(card.session.id)) { CompactCardView(card: card, stale: stale) }
                .buttonStyle(.plain)
            }
          }
          .frame(maxWidth: .infinity, alignment: .topLeading)
        }
      }
      .padding(.horizontal, Metric.margin)
      .padding(.top, 4)
      .padding(.bottom, 40)
    }
  }

  /// The section title: the group's label and its count in neutral colours, as the desktop's column headers (Figma 103′B).
  /// In portrait tapping it folds or opens the section; a landscape column always shows its cards.
  @ViewBuilder private func title(_ group: BoardGroup, top: CGFloat) -> some View {
    if landscape {
      header(group, top: top)
    } else {
      Button {
        if folded.contains(group.key.rawValue) { folded.remove(group.key.rawValue) } else { folded.insert(group.key.rawValue) }
      } label: {
        header(group, top: top)
      }
      .buttonStyle(.plain)
    }
  }

  private func header(_ group: BoardGroup, top: CGFloat) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(group.label).font(.ui(.headline)).foregroundStyle(Color.textPrimary)
      Text("\(group.cards.count)").font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, landscape ? 0 : Metric.margin)
    .padding(.top, top)
    .padding(.bottom, 8)
    .contentShape(Rectangle())
    .accessibilityAddTraits(.isHeader)
  }
}

/// A card in 进度 · portrait (Figma 103′B): the glyph and title with the time, 项目 › 分支, what it is doing, this turn's
/// checks and `+N −M`, on the status's fill; the quieter lines in its `-meta` colour.
struct ProgressCardView: View {
  let card: BoardCard
  let now: Double
  var stale = false

  var body: some View {
    let tone = card.tone
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 8) {
        StatusGlyph(status: card.session.status)
        Text(card.session.title).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
        Spacer(minLength: 4)
        Text(rowTime(card.session, now: now)).font(.ui(.footnote)).monospacedDigit().foregroundStyle(Color.cardMeta(tone))
      }
      if !card.whereLine.isEmpty {
        Text(card.whereLine).font(.ui(.footnote)).foregroundStyle(Color.cardMeta(tone)).lineLimit(1)
      }
      if !card.summary.isEmpty {
        Text(card.summary).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(2)
      }
      if let line = card.checksLine {
        checksLineText(line, tone: tone).font(.ui(.footnote)).lineLimit(1)
      }
      if let stat = card.session.stat {
        Text(statText(stat)).font(.mono(.caption, medium: true)).foregroundStyle(Color.cardMeta(tone))
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.card(tone), in: RoundedRectangle(cornerRadius: Metric.radiusCard))
    .opacity(stale ? 0.55 : 1)
    .padding(.horizontal, Metric.margin)
    .padding(.bottom, 8)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// A card in 进度 · landscape (Figma 103′C): the status glyph and exactly three single lines, truncated — title, 项目 › 分支,
/// and what it is doing or, when this turn ran checks, the checks. No time and no `+N −M`: a short screen has no room for
/// them (PRD v1.227 ②).
struct CompactCardView: View {
  let card: BoardCard
  var stale = false

  var body: some View {
    let tone = card.tone
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        // The same glyph as portrait: status is never colour alone (Figma 103′C).
        StatusGlyph(status: card.session.status)
        Text(card.session.title).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
        Spacer(minLength: 0)
      }
      if !card.whereLine.isEmpty {
        Text(card.whereLine).font(.ui(.footnote)).foregroundStyle(Color.cardMeta(tone)).lineLimit(1)
      }
      let third = card.landscapeThirdLine
      if card.checksLine != nil {
        checksLineText(third, tone: tone).font(.ui(.footnote)).lineLimit(1)
      } else if !third.isEmpty {
        Text(third).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1)
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.card(tone), in: RoundedRectangle(cornerRadius: Metric.radiusCard))
    .opacity(stale ? 0.55 : 1)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

// MARK: - GitHub

/// gh itself cannot answer (Figma 103H): what to do on the Mac, and 重新检查.
struct GHProblem: View {
  let missing: Bool
  let recheck: () -> Void

  var body: some View {
    VStack(spacing: 8) {
      Text(missing ? String(localized: "还没有安装 gh") : String(localized: "gh 还没有登录"))
        .font(.ui(.title3)).foregroundStyle(Color.textPrimary).multilineTextAlignment(.center)
      Text(missing ? String(localized: "看 GitHub 需要 GitHub CLI：在 Mac 的终端装上 gh 后运行 gh auth login") : String(localized: "在 Mac 的终端运行 gh auth login"))
        .font(.ui(.subheadline)).foregroundStyle(Color.textSecondary).multilineTextAlignment(.center)
      Button(String(localized: "重新检查"), action: recheck)
        .buttonStyle(.wavi)
        .frame(width: 160)
        .padding(.top, 8)
    }
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// The scope tabs and the projects' issues and PRs (Figma 103D): text tabs 全部 / 指派给我 / 我创建的 / 请我审阅, then each
/// project with its Issue and PR rows. Pull to refresh asks the Mac again past its cache.
struct GitHubList: View {
  let sections: [BoardSection]
  @Binding var scope: BoardScope
  let now: Double
  var loading = false
  let refresh: () async -> Void

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 24) {
          ForEach(BoardScope.allCases, id: \.self) { option in
            Button { scope = option } label: {
              VStack(spacing: 6) {
                Text(option.label).font(.ui(.subheadline, medium: option == scope))
                  .foregroundStyle(option == scope ? Color.textPrimary : Color.textSecondary)
                Rectangle().fill(option == scope ? Color.textPrimary : Color.clear).frame(height: 2)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(option == scope ? .isSelected : [])
          }
          Spacer(minLength: 0)
          if loading { Spinner(color: .textSecondary) }
        }
        .padding(.horizontal, Metric.margin)
        .padding(.bottom, 4)
        ForEach(sections) { section in
          project(section)
        }
        if sections.isEmpty {
          Text(scope == .review ? String(localized: "没有请你审阅的 PR") : String(localized: "没有打开的 issue 和 PR"))
            .font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
            .padding(.horizontal, Metric.margin)
            .padding(.top, 24)
        }
      }
      .padding(.bottom, 40)
    }
    .refreshable { await refresh() }
  }

  @ViewBuilder private func project(_ section: BoardSection) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(section.name).font(.ui(.headline)).foregroundStyle(Color.textPrimary).lineLimit(1)
      if let repo = section.repo {
        Text(repo).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, Metric.margin)
    .padding(.top, 24)
    .padding(.bottom, 4)
    if section.state == "ok" {
      if !section.issues.isEmpty {
        subHeader("Issue", count: section.issues.count)
        ForEach(section.issues) { row in item(row) }
      }
      if !section.prs.isEmpty {
        subHeader("PR", count: section.prs.count)
        ForEach(section.prs) { row in item(row) }
      }
      if section.issues.isEmpty && section.prs.isEmpty {
        Text(scope == .review ? String(localized: "没有请你审阅的 PR") : String(localized: "没有打开的 issue 和 PR"))
          .font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
          .padding(.horizontal, Metric.margin)
          .padding(.top, 8)
      }
    } else if section.state == "not-github" {
      Text(String(localized: "不在 GitHub 上")).font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
        .padding(.horizontal, Metric.margin).padding(.top, 8)
    } else if let message = section.message {
      Text(String(localized: "查询失败：\(message)")).font(.ui(.subheadline)).foregroundStyle(Color.noticeDanger)
        .padding(.horizontal, Metric.margin).padding(.top, 8)
    }
  }

  private func subHeader(_ label: String, count: Int) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(label).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textSecondary)
      Text("\(count)").font(.ui(.subheadline)).foregroundStyle(Color.textSecondary)
    }
    .padding(.horizontal, Metric.margin)
    .padding(.top, 16)
    .padding(.bottom, 2)
    .accessibilityAddTraits(.isHeader)
  }

  private func item(_ row: BoardRow) -> some View {
    NavigationLink(value: Route.github(project: row.projectId, kind: row.item.kind, number: row.item.number)) {
      GitHubRowView(row: row, now: now)
    }
    .buttonStyle(RowStyle())
  }
}

/// One row of 看板 · GitHub (Figma 103D): the GitHub-style glyph, the title and the age; under it `#n` with the labels,
/// a PR's review tags, its checks and the comments — or the session working on it.
struct GitHubRowView: View {
  let row: BoardRow
  let now: Double

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 10) {
        Icon(glyph, size: 16).foregroundStyle(Color.textSecondary)
        Text(row.item.title).font(.ui(.callout)).foregroundStyle(Color.textPrimary).lineLimit(1)
        Spacer(minLength: 8)
        Text(shortAge(now - row.item.updatedAt)).font(.ui(.footnote)).monospacedDigit().foregroundStyle(Color.textSecondary)
      }
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("#\(row.item.number)").font(.mono(.caption)).foregroundStyle(Color.textSecondary)
        ForEach(Array(meta.enumerated()), id: \.offset) { _, piece in
          if piece.leadingDot { Text("·").font(.ui(.footnote)).foregroundStyle(Color.textSecondary) }
          metaText(piece)
        }
        Spacer(minLength: 8)
        if let session = row.session {
          HStack(spacing: 6) {
            StatusGlyph(status: session.status)
            Text(String(localized: "处理中 · \(session.title)")).font(.ui(.footnote)).lineLimit(1)
          }
          .foregroundStyle(Color.textSecondary)
        }
      }
      .lineLimit(1)
    }
    .padding(.horizontal, Metric.margin)
    .padding(.vertical, 10)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  /// The marks of a row, each after a `·` except the first (which follows the number).
  private struct Piece {
    let meta: BoardMeta
    let leadingDot: Bool
  }

  private var meta: [Piece] {
    let pieces = rowMeta(row)
    // The labels are one run: `#139 bug`, then `· 3 条评论` (Figma 103D).
    return pieces.enumerated().map { Piece(meta: $1, leadingDot: $0 > 0) }
  }

  private func metaText(_ piece: Piece) -> some View {
    let color: Color = piece.meta.mark == .x ? .statusError : piece.meta.tone == .attention ? .statusAttention : .textSecondary
    return HStack(spacing: 2) {
      if let mark = piece.meta.mark {
        Icon(mark == .check ? "check" : mark == .x ? "x" : "circle", size: 12)
          .foregroundStyle(mark == .x ? Color.statusError : Color.textSecondary)
      }
      if piece.meta.mark != .check && piece.meta.mark != .circle {
        Text(piece.meta.text).font(.ui(.footnote)).foregroundStyle(color)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(piece.meta.text)
  }

  private var glyph: String {
    if row.item.kind != "pr" { return "circle-dot" }
    return row.pr?.draft == true ? "git-pull-request-draft" : "git-pull-request"
  }
}
