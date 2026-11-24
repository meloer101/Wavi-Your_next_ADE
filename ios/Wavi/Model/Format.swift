// What the screens show, derived from what Wavi sends (PRD F22): a session's conversation kept in step with the pages
// and pushes of src/main/remote/feed.ts, the session list's groups (Figma 45B), diff rows, short times and the
// permission sheet's words. Pure; WaviTests/FormatTests.swift.
import Foundation

/// The part of a session's conversation the phone has: items `start` … `start + items.count - 1`.
struct Feed: Equatable, Sendable {
  var start: Int
  var items: [ChatItem]
}

/// A page from `watch` / `feed`, or a push: replaces, extends or rewrites the end of what the phone has.
func applyFeed(_ feed: Feed?, start: Int, items: [ChatItem], reset: Bool = false) -> Feed {
  guard let feed, !reset else { return Feed(start: start, items: items) }
  let end = feed.start + feed.items.count
  // A gap (the phone missed pushes) or something before what it has: take the update as the new truth.
  if start > end || start < feed.start { return Feed(start: start, items: items) }
  return Feed(start: feed.start, items: Array(feed.items.prefix(start - feed.start)) + items)
}

/// An older page (ending where the feed starts) goes in front.
func prependFeed(_ feed: Feed, start: Int, items: [ChatItem]) -> Feed {
  guard start + items.count == feed.start else { return feed }
  return Feed(start: start, items: items + feed.items)
}

struct SessionGroup: Identifiable, Sendable {
  struct Row: Identifiable, Sendable {
    let session: RemoteSession
    /// Only in 等你处理, where rows of several projects mix.
    let projectName: String?
    var id: String { session.id }
  }
  /// 等你处理's group (rows of several projects, its count in the attention colour).
  static let needsYouId = "waiting"
  let id: String
  let title: String
  let rows: [Row]
}

/// 等你处理 first (with each row's project), then one group per project in the window's order; newest first (45B).
func groupSessions(_ list: RemoteSessionList) -> [SessionGroup] {
  let names = Dictionary(list.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
  let waiting = list.sessions.filter { $0.status == .needsYou }.sorted { ($0.since ?? $0.activity) > ($1.since ?? $1.activity) }
  var groups: [SessionGroup] = []
  if !waiting.isEmpty {
    groups.append(SessionGroup(id: SessionGroup.needsYouId, title: String(localized: "等你处理"), rows: waiting.map { .init(session: $0, projectName: names[$0.projectId]) }))
  }
  for project in list.projects {
    let rows = list.sessions.filter { $0.projectId == project.id && $0.status != .needsYou }.sorted { $0.activity > $1.activity }
    if !rows.isEmpty { groups.append(SessionGroup(id: project.id, title: project.name, rows: rows.map { .init(session: $0, projectName: nil) })) }
  }
  return groups
}

/// Figma 91D: how long a turn has run — tenths under a minute (`4.3s`), then `1m 05s`, then `1h 02m`.
func runClock(_ ms: Double) -> String {
  let t = max(0, ms)
  if t < 60_000 { return String(format: "%.1fs", (t / 100).rounded(.down) / 10) }
  let s = Int(t / 1000)
  if s < 3600 { return String(format: "%dm %02ds", s / 60, s % 60) }
  return String(format: "%dh %02dm", s / 3600, s / 60 % 60)
}

/// Figma 91′: the running turn's last row, there from the moment a message is sent until the turn ends or waits on the
/// user — what the agent does now (nil: 思考中) and since when; `startsTurn` puts the agent's mark above it.
struct RunRow: Equatable {
  let action: String?
  let since: Double
  let startsTurn: Bool
}

/// A running session's row: its turn's start (`turnStart`), the agent's mark only right after the user's message (one
/// sent from the phone meanwhile waits on the Mac and does not start a turn). Before the Mac says it runs, a message
/// still sending makes the row, counted from the send.
func runRow(session: RemoteSession, turnStart: Double?, sending: [ChatItem], lastIsUser: Bool) -> RunRow? {
  if session.status == .running {
    return RunRow(action: session.action, since: turnStart ?? session.since ?? session.activity, startsTurn: lastIsUser)
  }
  guard session.status != .needsYou, let first = sending.first else { return nil }
  return RunRow(action: nil, since: first.at, startsTurn: true)
}

/// Each session's turn start: kept while it runs or waits on the user, taken from `since` when a turn begins, dropped
/// when it ends.
func nextTurnStarts(_ previous: [String: Double], sessions: [RemoteSession]) -> [String: Double] {
  var next: [String: Double] = [:]
  for session in sessions where session.status == .running || session.status == .needsYou {
    next[session.id] = previous[session.id] ?? session.since ?? session.activity
  }
  return next
}

/// `45s` / `3m` / `2h` / `4d`.
func shortAge(_ ms: Double) -> String {
  let s = max(0, Int(ms / 1000))
  if s < 60 { return "\(s)s" }
  if s < 3600 { return "\(s / 60)m" }
  if s < 86400 { return "\(s / 3600)h" }
  return "\(s / 86400)d"
}

/// The notice over a list that is not live (Figma 62B): how old what it shows is. Nothing heard yet: no age to give.
func staleNotice(heardAt: Double?, now: Double) -> String {
  guard let heardAt else { return String(localized: "显示的不是最新的状态") }
  let minutes = Int(max(0, now - heardAt) / 60000)
  if minutes < 1 { return String(localized: "显示的是 1 分钟内的状态") }
  if minutes < 60 { return String(localized: "显示的是 \(minutes) 分钟前的状态") }
  return String(localized: "显示的是 \(minutes / 60) 小时前的状态")
}

/// The right-hand time of a session row: how long it has waited, or how long since it last did something.
func rowTime(_ session: RemoteSession, now: Double) -> String {
  if session.status == .needsYou { return String(localized: "已等 \(shortAge(now - (session.since ?? session.activity)))") }
  return shortAge(now - session.activity)
}

enum DiffRow: Equatable, Sendable {
  case hunk(String)
  case line(sign: Character, old: Int?, new: Int?, code: String)
}

/// Hunks (Edit / Write `structuredPatch`) → numbered rows, as 45D draws them.
func hunkRows(_ hunks: [DiffHunk]) -> [DiffRow] {
  var rows: [DiffRow] = []
  for hunk in hunks {
    let oldCount = hunk.lines.filter { !$0.hasPrefix("+") }.count
    let newCount = hunk.lines.filter { !$0.hasPrefix("-") }.count
    rows.append(.hunk("@@ -\(hunk.oldStart),\(oldCount) +\(hunk.newStart),\(newCount) @@"))
    var o = hunk.oldStart
    var n = hunk.newStart
    for line in hunk.lines {
      let code = String(line.dropFirst())
      switch line.first {
      case "+": rows.append(.line(sign: "+", old: nil, new: n, code: code)); n += 1
      case "-": rows.append(.line(sign: "-", old: o, new: nil, code: code)); o += 1
      default: rows.append(.line(sign: " ", old: o, new: n, code: code)); o += 1; n += 1
      }
    }
  }
  return rows
}

/// `git diff` text (a file of Git · 变更) → the same rows; header lines before the first hunk are dropped.
func unifiedRows(_ text: String) -> [DiffRow] {
  var rows: [DiffRow] = []
  var o = 0
  var n = 0
  var inHunk = false
  let head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
  for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
    if let m = line.wholeMatch(of: head) {
      o = Int(m.1) ?? 0
      n = Int(m.2) ?? 0
      inHunk = true
      rows.append(.hunk(line))
      continue
    }
    if !inHunk || line.hasPrefix("\\") { continue }
    let code = String(line.dropFirst())
    if line.hasPrefix("+") { rows.append(.line(sign: "+", old: nil, new: n, code: code)); n += 1 }
    else if line.hasPrefix("-") { rows.append(.line(sign: "-", old: o, new: nil, code: code)); o += 1 }
    else if line.hasPrefix(" ") { rows.append(.line(sign: " ", old: o, new: n, code: code)); o += 1; n += 1 }
  }
  return rows
}

/// `src/auth/session.ts` → `session.ts` and `src/auth/`.
func splitPath(_ path: String) -> (name: String, dir: String) {
  guard let slash = path.lastIndex(of: "/") else { return (path, "") }
  return (String(path[path.index(after: slash)...]), String(path[...slash]))
}

/// The last line worth showing under a Bash row (45C: `✓ 12 passed (1.4s)`).
func lastLine(_ output: String?) -> String? {
  (output ?? "").split(separator: "\n").map { String($0).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }
    .last { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
}

/// Tailscale's CGNAT range 100.64.0.0/10: how the top of 45B names the way it is connected.
func viaOf(_ url: String) -> String { Link.isTailscale(url) ? "Tailscale" : String(localized: "局域网") }

/// The connection under a screen title (Figma 59 Mobile/ConnectionTitle, 62A–62D): where the Mac is reached, or what is
/// wrong in words; `dropped` once a link that was open went away.
struct ConnectionWords: Equatable, Sendable {
  enum Tone: Sendable { case quiet, warning, danger }
  let text: String
  let tone: Tone
}

func connectionWords(_ link: LinkState, mac: String, dropped: Bool) -> ConnectionWords {
  switch link {
  case .open(let url): return ConnectionWords(text: "\(mac) · \(viaOf(url))", tone: .quiet)
  case .connecting: return ConnectionWords(text: dropped ? String(localized: "连接断了，正在重连") : String(localized: "正在连接 \(mac)"), tone: .quiet)
  case .refused: return ConnectionWords(text: String(localized: "\(mac) 不认识这台手机"), tone: .danger)
  case .offline(let reason):
    let text = switch reason {
    case .macAsleep: String(localized: "\(mac) 已睡眠或离线")
    case .waviNotRunning: String(localized: "Mac 上的 Wavi 没有打开")
    case .tailscaleOff: String(localized: "连不上 · 检查这台手机的 Tailscale")
    case .noNetwork: String(localized: "这台手机没有网络")
    case .macOutdated: String(localized: "Mac 上的 Wavi 需要更新")
    case .phoneOutdated: String(localized: "这台手机上的 Wavi 需要更新")
    case .unknown: String(localized: "连不上 \(mac)")
    }
    return ConnectionWords(text: text, tone: .warning)
  }
}

/// 设置's hero (Figma 110D) under the Mac's name: `Tailscale · 已连接` while the link is open, the words of `connectionWords`
/// (what is wrong, or that it is connecting) otherwise.
func connectionStatusText(_ link: LinkState, words: ConnectionWords) -> String {
  if case .open(let url) = link { return String(localized: "\(viaOf(url)) · 已连接") }
  return words.text
}

/// The dot before it: done while the link is open, error when the Mac does not know this phone, warning otherwise
/// (connecting, or the Mac cannot be reached: the amber of the connection line under the screen titles). The words carry the state too: the dot is never the only signal.
enum LinkDot: Equatable { case done, warning, error }

func linkDot(_ link: LinkState) -> LinkDot {
  switch link {
  case .open: .done
  case .refused: .error
  case .connecting, .offline: .warning
  }
}

/// 45E's title: what the agent wants to do.
func permissionTitle(_ tool: String) -> String {
  switch tool {
  case "Bash": return String(localized: "运行命令")
  case "Edit", "MultiEdit", "Write", "NotebookEdit": return String(localized: "修改文件")
  case "WebFetch": return String(localized: "访问网页")
  case "WebSearch": return String(localized: "搜索网页")
  default: return String(localized: "使用 \(tool)")
  }
}

/// The line in 45E's command box: the command, the file or the address; the summary otherwise.
func permissionSubject(_ input: [String: JSONValue], summary: String) -> String {
  for key in ["command", "file_path", "notebook_path", "url", "query", "pattern"] {
    if let value = input[key]?.string, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return value }
  }
  return summary
}

/// 总是允许 pnpm add: what the rule the agent offered covers.
func allowAlwaysLabel(_ rules: [PermissionRule]?) -> String {
  guard let rules, let rule = rules.first else { return String(localized: "总是允许") }
  let what = (rule.content ?? rule.tool).replacingOccurrences(of: ":*", with: "", options: [.anchored, .backwards]).replacingOccurrences(of: "domain:", with: "", options: .anchored)
  return rules.count > 1 ? String(localized: "总是允许 \(what) 等 \(rules.count) 项") : String(localized: "总是允许 \(what)")
}

/// A plan's title and body, split as the Mac's plan card splits them (src/renderer/gui/model.ts `planParts`): the title
/// is the plan's own name — its first heading with the 「计划:」 / 「Plan:」 prefix taken off — or 「计划」 when it names
/// itself nothing; the rest is the body. On the phone the title sits under a head that already says 等你确认计划 (Figma
/// 100A / 100B), so it is the name alone; `namedTitle` is the form for a line without that head.
struct PlanParts: Equatable {
  let title: String
  let body: String
  /// The title is the plan's own name, not 「计划」 standing in for one.
  let named: Bool

  /// 「计划：<the name>」, for a line with no head above it (a receipt's); 「计划」 when it names itself nothing.
  var namedTitle: String { named ? String(localized: "计划：\(title)") : title }
}

func planParts(_ plan: String) -> PlanParts {
  let lines = plan.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  guard let at = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else {
    return PlanParts(title: String(localized: "计划"), body: "", named: false)
  }
  let first = lines[at].trimmingCharacters(in: .whitespaces)
  let body = lines[(at + (headingName(first) == nil ? 0 : 1))...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
  guard let name = headingName(first), !name.isEmpty else {
    return PlanParts(title: String(localized: "计划"), body: body, named: false)
  }
  return PlanParts(title: name, body: body, named: true)
}

/// The prompt a receipt names by: `receiptText` (TranscriptGroups.swift) reads a permission's summary or a question's
/// text, and a plan has neither — its title goes in a question's place, so a plan's receipt reads like a question's.
func receiptNaming(_ prompt: RemotePrompt) -> RemotePrompt {
  guard prompt.kind == "plan" else { return prompt }
  var copy = prompt
  copy.questions = [AgentQuestion(header: nil, question: planParts(prompt.plan ?? "").namedTitle, multiSelect: false, options: [])]
  return copy
}

/// `## 计划：登录改成 Set-Cookie` on its own → `登录改成 Set-Cookie`; null when the line is not a heading.
private func headingName(_ line: String) -> String? {
  let marks = line.prefix { $0 == "#" }
  guard (1...6).contains(marks.count), line.dropFirst(marks.count).first == " " else { return nil }
  let name = line.dropFirst(marks.count).trimmingCharacters(in: .whitespaces)
  for prefix in ["计划:", "计划：", "Plan:"] where name.lowercased().hasPrefix(prefix.lowercased()) {
    return String(name.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
  }
  return name
}

/// `<prefix>/<adjective>-<noun>` not in `taken` (src/shared/new-session.ts `generateBranchName`, its words from Shared.json).
func generateBranchName(prefix: String, taken: Set<String>) -> String {
  let words = Shared.data.branchWords
  func make(_ suffix: String) -> String {
    let name = "\(words.adjectives.randomElement() ?? "new")-\(words.nouns.randomElement() ?? "branch")\(suffix)"
    return prefix.isEmpty ? name : "\(prefix)/\(name)"
  }
  for _ in 0..<20 {
    let name = make("")
    if !taken.contains(name) { return name }
  }
  for n in 2... {
    let name = make("-\(n)")
    if !taken.contains(name) { return name }
  }
  return make("")
}
