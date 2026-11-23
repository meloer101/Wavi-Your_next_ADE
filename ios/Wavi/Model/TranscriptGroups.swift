// How the conversation is laid out (Figma 62E): consecutive tool calls fold into one line that says what they did, a
// finished turn that changed files ends with its totals, and an answered prompt leaves a line where it was answered.
// Done on the phone from the transcript items, so the Mac's parser (src/shared/transcript-chat.ts) does not change.
// Pure; WaviTests/TranscriptGroupsTests.swift.
import Foundation

/// A permission or question answered while the phone watched: where (this phone, or the Mac) and what.
struct Receipt: Equatable, Sendable, Identifiable {
  let id: String
  let at: Double
  let onPhone: Bool
  let text: String
}

/// Two or more tool calls in a row.
struct ToolRun: Equatable, Sendable {
  let id: String
  let items: [ChatItem]
  let summary: String
  let running: Bool
  let added: Int
  let removed: Int
  /// Off when the turn's totals come at its end (said once).
  var showCounts: Bool
}

/// What a finished turn changed: files, lines, and the tool calls with the diffs.
struct TurnChange: Equatable, Sendable {
  let id: String
  let files: Int
  let added: Int
  let removed: Int
  let tools: [String]
}

enum TranscriptBlock: Equatable, Sendable, Identifiable {
  case item(ChatItem)
  case tools(ToolRun)
  case turn(TurnChange)
  case receipt(Receipt)

  var id: String {
    switch self {
    case .item(let item): item.id
    case .tools(let run): run.id
    case .turn(let turn): turn.id
    case .receipt(let receipt): receipt.id
    }
  }
}

private let editTools: Set<String> = ["Edit", "Write", "MultiEdit", "NotebookEdit"]
private let readTools: Set<String> = ["Read", "NotebookRead"]
private let searchTools: Set<String> = ["Grep", "Glob", "LS", "WebSearch", "WebFetch"]
private let commandTools: Set<String> = ["Bash", "BashOutput"]

/// 读了 2 个文件，搜索了 1 次，改了 1 个文件，跑了 1 条命令.
func toolSummary(_ items: [ChatItem]) -> String {
  func distinct(_ names: Set<String>) -> Int { Set(items.filter { names.contains($0.name ?? "") }.map { $0.diff?.path ?? $0.arg ?? $0.id }).count }
  func count(_ names: Set<String>) -> Int { items.filter { names.contains($0.name ?? "") }.count }
  let known = editTools.union(readTools).union(searchTools).union(commandTools)
  let parts: [(Int, (Int) -> String)] = [
    (distinct(readTools), { String(localized: "读了 \($0) 个文件") }),
    (count(searchTools), { String(localized: "搜索了 \($0) 次") }),
    (distinct(editTools), { String(localized: "改了 \($0) 个文件") }),
    (count(commandTools), { String(localized: "跑了 \($0) 条命令") }),
    (items.filter { !known.contains($0.name ?? "") }.count, { String(localized: "调用了 \($0) 次其他工具") })
  ]
  return parts.filter { $0.0 > 0 }.map { $0.1($0.0) }.joined(separator: String(localized: "，", comment: "Between the items of a list"))
}

/// The line left after an answer (Figma 59 Mobile/Receipt).
func receiptText(_ prompt: RemotePrompt, decision: String?, onPhone: Bool) -> String {
  let subject = prompt.kind == "permission" ? (prompt.summary ?? "") : (prompt.questions?.first?.question ?? "")
  // Whole phrases: the word order differs between languages.
  if prompt.kind != "permission" {
    return onPhone ? String(localized: "在这台手机上回答 · \(subject)") : String(localized: "在 Mac 上回答 · \(subject)")
  }
  if !onPhone { return String(localized: "在 Mac 上处理 · \(subject)") }
  switch decision {
  case "deny": return String(localized: "在这台手机上拒绝 · \(subject)")
  case "allow-always": return String(localized: "在这台手机上总是允许 · \(subject)")
  default: return String(localized: "在这台手机上允许 · \(subject)")
  }
}

/// The item kinds `FeedRow` draws.
private let shownKinds: Set<String> = ["user", "text", "thinking", "tool", "system"]

/// `turnOpen`: the agent is still at the last turn (no totals for it yet).
func transcriptBlocks(_ items: [ChatItem], receipts: [Receipt], turnOpen: Bool) -> [TranscriptBlock] {
  // Answers go after the last item or answer that came before them.
  // A line of a type the Mac does not know (`unknown`, or a kind newer than this app) has nothing to show: it is left out
  // rather than drawn as a placeholder row.
  var entries: [TranscriptBlock] = items.filter { shownKinds.contains($0.kind) }.map { .item($0) }
  for receipt in receipts.sorted(by: { $0.at < $1.at }) {
    let index = entries.lastIndex {
      switch $0 {
      case .item(let item): item.at <= receipt.at
      case .receipt(let earlier): earlier.at <= receipt.at
      default: false
      }
    }.map { $0 + 1 } ?? 0
    entries.insert(.receipt(receipt), at: index)
  }
  // Turns start at each message of the user's.
  var turns: [[TranscriptBlock]] = [[]]
  for entry in entries {
    if case .item(let item) = entry, item.kind == "user", !(turns.last?.isEmpty ?? true) { turns.append([]) }
    turns[turns.count - 1].append(entry)
  }
  var out: [TranscriptBlock] = []
  for (index, turn) in turns.enumerated() {
    let edits = turn.compactMap { entry -> ChatItem? in
      if case .item(let item) = entry, item.kind == "tool", editTools.contains(item.name ?? ""), item.diff != nil { return item }
      return nil
    }
    let finished = index < turns.count - 1 || !turnOpen
    let totals = finished && !edits.isEmpty
    var run: [ChatItem] = []
    func flush() {
      if run.count >= 2 {
        let diffs = run.compactMap(\.diff)
        out.append(.tools(ToolRun(id: "run-\(run[0].id)", items: run, summary: toolSummary(run), running: run.contains { $0.state == "running" },
          added: diffs.reduce(0) { $0 + $1.added }, removed: diffs.reduce(0) { $0 + $1.removed }, showCounts: !totals)))
      } else if let only = run.first {
        out.append(.item(only))
      }
      run = []
    }
    for entry in turn {
      if case .item(let item) = entry, item.kind == "tool" {
        run.append(item)
      } else {
        flush()
        out.append(entry)
      }
    }
    flush()
    if totals, case .item(let first) = turn.first {
      let diffs = edits.compactMap(\.diff)
      out.append(.turn(TurnChange(id: "turn-\(first.id)", files: Set(diffs.map(\.path)).count, added: diffs.reduce(0) { $0 + $1.added },
        removed: diffs.reduce(0) { $0 + $1.removed }, tools: edits.map(\.id))))
    }
  }
  return out
}
