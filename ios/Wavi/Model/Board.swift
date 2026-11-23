// 看板 (PRD F22 v1.229, Figma 103 / 103′): 进度's groups and cards in the desktop board's order and colours
// (src/renderer/overview/model.ts), and 看板 · GitHub's projects, rows and an item's page (src/renderer/overview/
// github-model.ts, GitHubBoard.tsx, GitHubDetail.tsx). Pure; WaviTests/BoardTests.swift.
import SwiftUI

// MARK: - 进度

/// The desktop board's columns, in its order (overview/model.ts `GROUP_ORDER`): most pressing first.
enum BoardGroupKey: String, CaseIterable, Sendable {
  case needsYou = "needs_you", error, doneUnread = "done_unread", running, idle, exited

  init(_ status: SessionStatus) {
    switch status {
    case .needsYou: self = .needsYou
    case .error: self = .error
    case .doneUnread: self = .doneUnread
    case .running: self = .running
    case .idle: self = .idle
    case .exited: self = .exited
    }
  }

  /// The section title. 待审阅 is the board's word for a finished turn (Shared.json's status word is 已完成), so it is a
  /// key of its own; the others are the status words the whole app uses.
  var label: String {
    switch self {
    case .needsYou: String(localized: "等你处理")
    case .error: String(localized: "出错")
    case .doneUnread: String(localized: "待审阅")
    case .running: String(localized: "运行中")
    case .idle: String(localized: "空闲")
    case .exited: String(localized: "已退出")
    }
  }
}

/// The desktop's status→tone (`cardOf` in overview/model.ts): exited takes idle's colour.
func cardTone(_ key: BoardGroupKey) -> CardTone {
  switch key {
  case .needsYou: .attention
  case .error: .error
  case .doneUnread: .review
  case .running: .working
  case .idle, .exited: .idle
  }
}

struct BoardCard: Identifiable, Sendable {
  let session: RemoteSession
  /// Only sessions of another project than the one around them (the phone never groups by project, but a card says
  /// where it lives either way).
  let projectName: String?
  var id: String { session.id }
  var tone: CardTone { cardTone(BoardGroupKey(session.status)) }

  /// `项目 › 分支`, the desktop card's 项目 › 分支 line; only the project when the branch is unknown.
  var whereLine: String { [projectName, session.branch].compactMap { $0 }.joined(separator: " › ") }

  /// What the session is doing, asking or reporting: the current action while it has one, else what it last replied
  /// (the desktop's `summaryOf`, overview/model.ts), else the status word — a landscape card always has its three rows.
  var summary: String {
    if let action = session.action, !action.isEmpty { return action }
    if session.status == .idle || session.status == .doneUnread, let reply = session.reply, !reply.isEmpty { return reply }
    return BoardGroupKey(session.status).label
  }

  /// 这一轮的检查 when this turn (or the previous one) ran or skipped some, like the desktop's checks line.
  var checksLine: String? { session.checks.map(checksText) }

  /// The third row of a landscape card (103′C): the checks when there are any, else the summary — three single lines is
  /// all a short screen has room for.
  var landscapeThirdLine: String { checksLine ?? summary }
}

struct BoardGroup: Identifiable, Sendable {
  let key: BoardGroupKey
  let cards: [BoardCard]
  var id: String { key.rawValue }
  var label: String { key.label }
}

/// The sections the phone draws: the desktop's column order, only the ones with sessions (an empty column has nothing to
/// say on a phone). Within a section the one active last comes first, as Figma 103′B / 103′C show them.
func boardGroups(_ list: RemoteSessionList) -> [BoardGroup] {
  let names = Dictionary(list.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
  var byKey: [BoardGroupKey: [RemoteSession]] = [:]
  for session in list.sessions { byKey[BoardGroupKey(session.status), default: []].append(session) }
  return BoardGroupKey.allCases.compactMap { key in
    guard let sessions = byKey[key], !sessions.isEmpty else { return nil }
    let sorted = sessions.sorted { $0.activity > $1.activity }
    return BoardGroup(key: key, cards: sorted.map { BoardCard(session: $0, projectName: names[$0.projectId]) })
  }
}

/// `测试 ✓ · lint ✗ · 类型 未跑`, the desktop's `checksText` (src/shared/turn-checks.ts): each kind that ran this turn,
/// in the desktop's order, with its mark; 没跑检查 when the turn edited files and ran none.
func checksText(_ checks: RemoteChecks) -> String {
  guard !checks.kinds.isEmpty else { return String(localized: "没跑检查") }
  return checks.kinds.map { "\(checkKindLabel($0.kind)) \(checkMark($0.status))" }.joined(separator: " · ")
}

/// The short name of a kind of check (KIND_LABEL in turn-checks.ts).
func checkKindLabel(_ kind: String) -> String {
  switch kind {
  case "test": String(localized: "测试")
  case "lint": "lint"
  case "typecheck": String(localized: "类型")
  case "build": String(localized: "构建")
  default: kind
  }
}

/// pass / fail / unknown / not-run (turn-checks.ts `mark`).
func checkMark(_ status: String) -> String {
  switch status {
  case "pass": "✓"
  case "fail": "✗"
  case "unknown": "?"
  case "not-run": String(localized: "未跑")
  default: status
  }
}

/// A card's checks line as the card draws it: the marks unchanged, a failed check in the error colour (the rest in the
/// card's quieter line colour), as Figma 103′B shows it.
func checksLineText(_ line: String, tone: CardTone) -> Text {
  var out = AttributedString(line)
  out.foregroundColor = Color.cardMeta(tone)
  var from = line.startIndex
  while let found = line.range(of: "✗", range: from..<line.endIndex) {
    if let lower = AttributedString.Index(found.lowerBound, within: out), let upper = AttributedString.Index(found.upperBound, within: out) {
      out[lower..<upper].foregroundColor = .statusError
    }
    from = found.upperBound
  }
  return Text(out)
}

/// `+N −M` (both sides, the desktop card's stat line; the Mac leaves it out when both are 0).
func statText(_ stat: RemoteStat) -> String { "+\(stat.added) −\(stat.removed)" }

// MARK: - GitHub

/// The scope tabs over every project (github-board.ts `BOARD_SCOPES`): text tabs, no filter box.
enum BoardScope: String, CaseIterable, Sendable {
  case all, assigned, mine, review

  var label: String {
    switch self {
    case .all: String(localized: "全部")
    case .assigned: String(localized: "指派给我")
    case .mine: String(localized: "我创建的")
    case .review: String(localized: "请我审阅")
    }
  }
}

/// 看板 · GitHub's loading state: the scope last asked for and whether its answer is still wanted. Two taps in a row (全部
/// then 请我审阅) leave two requests in flight, and the Mac may answer them in either order: the answer to a scope that is
/// no longer on screen is dropped, and settling it leaves the spinner up for the request the screen is waiting for.
struct BoardRequest: Equatable {
  /// The scope of the request whose answer the screen wants; nil before the first one.
  private(set) var asked: String?
  private(set) var loading = false

  /// A request for `scope` starts: from here its answer is the one that belongs on screen.
  mutating func begin(_ scope: String) {
    asked = scope
    loading = true
  }

  /// `scope` answered: true when the answer still belongs on screen (false: the scope changed meanwhile — drop it).
  @discardableResult mutating func settle(_ scope: String) -> Bool {
    guard asked == scope else { return false }
    loading = false
    return true
  }
}

/// A row of a project's list. `pr` is set for a PR (its own fields); `session` is the session working on it, if any.
struct BoardRow: Identifiable, Sendable {
  let projectId: String
  let item: BoardItem
  let pr: BoardPr?
  let session: RemoteSession?
  var id: String { "\(item.kind)-\(item.number)" }
}

struct BoardSection: Identifiable, Sendable {
  let projectId: String
  let name: String
  /// `acme/web`; nil for a project that is not on GitHub or could not be read.
  let repo: String?
  /// ok / not-github / error
  let state: String
  let message: String?
  let issues: [BoardRow]
  let prs: [BoardRow]
  var id: String { projectId }
}

/// The projects as the list draws them: the Mac's order (the session list's), each with its issues and PRs. `scope` is
/// what the Mac was asked for: 请我审阅 has no issues.
func boardSections(_ board: GitHubBoard, projects: [RemoteProject], sessions: [RemoteSession], scope: BoardScope) -> [BoardSection] {
  let names = Dictionary(projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
  let linked = linkedSessions(sessions)
  return (board.projects ?? []).map { entry in
    let project = entry.board
    let repo = project.repo.map { "\($0.owner)/\($0.name)" }
    func key(_ kind: String, _ number: Int) -> String? {
      project.repo.map { linkKey(GitHubLink(repo: "\($0.host)/\($0.owner)/\($0.name)", kind: kind, number: number)) }
    }
    let issues = scope == .review ? [] : (project.issues ?? []).map { item in
      BoardRow(projectId: entry.project, item: item, pr: nil, session: key(item.kind, item.number).flatMap { linked[$0] })
    }
    let prs = (project.prs ?? []).map { pr in
      BoardRow(projectId: entry.project, item: BoardItem(kind: pr.kind, number: pr.number, title: pr.title, url: pr.url, author: pr.author,
        labels: pr.labels, comments: pr.comments, updatedAt: pr.updatedAt), pr: pr, session: key(pr.kind, pr.number).flatMap { linked[$0] })
    }
    return BoardSection(projectId: entry.project, name: names[entry.project] ?? entry.project, repo: repo, state: project.state,
      message: project.message, issues: issues, prs: prs)
  }
}

/// A link's key in `linkedSessions`: the repository without case, the kind and the number (github-model.ts `linkKey`).
func linkKey(_ link: GitHubLink) -> String { "\(link.repo.lowercased())#\(link.kind)#\(link.number)" }

/// The session handling each item: among the sessions that work on it, the one active last.
func linkedSessions(_ sessions: [RemoteSession]) -> [String: RemoteSession] {
  var out: [String: RemoteSession] = [:]
  for session in sessions {
    guard let link = session.github else { continue }
    let key = linkKey(link)
    if let best = out[key], best.activity >= session.activity { continue }
    out[key] = session
  }
  return out
}

/// What a row says after its `#n` and labels: a PR's 草稿 / 待你审阅 / 已批准 / 要求修改 (github-model.ts `prTags`).
enum MetaTone: Sendable { case plain, quiet, attention }

struct BoardMeta: Sendable {
  /// Which mark comes before the words, if any.
  enum Mark: Sendable, Equatable { case check, x, circle }
  let text: String
  let tone: MetaTone
  var mark: Mark?
}

func prTags(_ pr: BoardPr) -> [BoardMeta] {
  var tags: [BoardMeta] = []
  if pr.draft { tags.append(BoardMeta(text: String(localized: "草稿"), tone: .quiet)) }
  if pr.reviewRequestedFromMe { tags.append(BoardMeta(text: String(localized: "待你审阅"), tone: .attention)) }
  else if pr.review == "approved" { tags.append(BoardMeta(text: String(localized: "已批准"), tone: .plain)) }
  else if pr.review == "changes-requested" { tags.append(BoardMeta(text: String(localized: "要求修改"), tone: .attention)) }
  return tags
}

/// The checks' mark: ✓ all passed, ✗ with how many failed, ○ still running; nil without checks (github-model.ts `checksMark`).
func checksMeta(_ pr: BoardPr) -> BoardMeta? {
  let checks = pr.checks
  switch checks.state {
  case "none": return nil
  case "failing": return BoardMeta(text: String(localized: "\(checks.failing.count) 失败"), tone: .plain, mark: .x)
  case "passing": return BoardMeta(text: String(localized: "检查通过"), tone: .plain, mark: .check)
  case "pending": return BoardMeta(text: String(localized: "检查进行中"), tone: .plain, mark: .circle)
  default: return nil
  }
}

/// Everything a row draws after its number, before the session that works on it: its labels (at most three, as the
/// desktop; one run, so a row stays one line), then a PR's tags, its checks and its comments.
func rowMeta(_ row: BoardRow) -> [BoardMeta] {
  var out: [BoardMeta] = []
  let labels = row.item.labels.prefix(3).joined(separator: " ")
  if !labels.isEmpty { out.append(BoardMeta(text: labels, tone: .quiet)) }
  if let pr = row.pr {
    out += prTags(pr)
    if let checks = checksMeta(pr) { out.append(checks) }
  }
  if row.session == nil, row.item.comments > 0 {
    out.append(BoardMeta(text: String(localized: "\(row.item.comments) 条评论"), tone: .quiet))
  }
  return out
}

// MARK: - An item's page

/// `打开` / `已合并` / `已关闭`.
func detailStateText(_ state: String) -> String {
  switch state {
  case "merged": String(localized: "已合并")
  case "closed": String(localized: "已关闭")
  default: String(localized: "打开")
  }
}

/// `12 分钟前` / `3 天前` / `刚刚`: how long ago something happened on GitHub.
func ageText(_ ms: Double, now: Double) -> String {
  let minutes = Int(max(0, now - ms) / 60_000)
  if minutes < 1 { return String(localized: "刚刚") }
  if minutes < 60 { return String(localized: "\(minutes) 分钟前") }
  if minutes < 24 * 60 { return String(localized: "\(minutes / 60) 小时前") }
  return String(localized: "\(minutes / (24 * 60)) 天前")
}

/// `打开 · jacob 3 天前 · bug · 指派给 jacob`, the line under an item's title (Figma 103E / 103F). A PR says whose review
/// it waits for or what the review said (待你审阅 / 已批准 / 要求修改) after its labels.
func detailMetaText(_ detail: BoardDetail, now: Double) -> String {
  var parts = [detailStateText(detail.state), "\(detail.author) \(ageText(detail.createdAt, now: now))"]
  parts += detail.labels
  if let pr = detail.pr {
    if let review = reviewText(pr.review) { parts.append(review) }
  }
  if !detail.assignees.isEmpty { parts.append(String(localized: "指派给 \(detail.assignees.joined(separator: ", "))")) }
  return parts.joined(separator: " · ")
}

func reviewText(_ review: String?) -> String? {
  switch review {
  case "approved": String(localized: "已批准")
  case "changes-requested": String(localized: "要求修改")
  case "review-required": String(localized: "待你审阅")
  default: nil
  }
}

/// `mira/token-expiry → main · +42 −18 · 3 个文件`, a PR's line under its meta (Figma 103F).
func detailBranchText(_ pr: BoardDetailPr) -> String {
  var parts = ["\(pr.headRef) → \(pr.baseRef)", "+\(pr.additions) −\(pr.deletions)", String(localized: "\(pr.changedFiles) 个文件")]
  if pr.crossRepo { parts.append(String(localized: "来自 fork")) }
  return parts.joined(separator: " · ")
}

/// What a check's row says on the right: how long it took, how long ago it failed, or that it is still going.
func checkRightText(_ check: BoardDetailPr.Check, now: Double) -> String {
  switch check.verdict {
  case "pending": return String(localized: "进行中")
  case "failed":
    guard let at = check.completedAt ?? check.startedAt else { return String(localized: "失败") }
    return String(localized: "\(ageText(at, now: now))失败")
  default:
    guard let start = check.startedAt, let end = check.completedAt, end > start else { return "" }
    return runClock(end - start)
  }
}

// MARK: - An old Mac
/// Whether the Mac answered that it does not know a command: what a Mac older than 看板 says (src/main/remote/
/// server.ts: `parsePhoneRequest` returns null for a type it does not parse, and the server answers the `invalid` message
/// of its own language). The phone then says the Mac's Wavi needs an update instead of showing the Mac's text.
func isInvalidRequest(_ error: String) -> Bool {
  // The server's two texts, `pick(M).invalid` in src/main/remote/server.ts: 无效的请求 / Invalid request.
  error == "无效的请求" || error == "Invalid request"
}

/// The line for an `ok:false` answer: the old-Mac line only for the server's invalid-request text, the Mac's own words
/// otherwise, and a plain failure when it said nothing.
func detailFailure(_ message: String?) -> String {
  guard let message, !message.isEmpty else { return String(localized: "没有读到") }
  return isInvalidRequest(message) ? String(localized: "Mac 上的 Wavi 要更新") : message
}
