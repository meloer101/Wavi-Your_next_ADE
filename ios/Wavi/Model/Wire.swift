// What the phone and Wavi say to each other (PRD F22): the Swift side of src/shared/remote.ts and the shared types it
// uses (transcript-chat ChatItem, agent-events PendingPrompt, git-graph GitChanges, new-session NewSessionInfo). Field
// names are the JSON's; anything the Mac adds later is ignored, an unknown status reads as idle.
import Foundation

enum SessionStatus: String, Codable, Hashable, Sendable {
  case running, needsYou = "needs_you", doneUnread = "done_unread", idle, error, exited

  init(from decoder: Decoder) throws {
    self = SessionStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .idle
  }

  var label: String { Shared.statusLabel(rawValue) ?? rawValue }
}

struct RemoteProject: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let name: String
}

struct RemoteShip: Codable, Hashable, Sendable {
  enum Stage: String, Codable, Sendable { case writing, glance, running }
  enum StepState: String, Codable, Sendable { case pending, working, done, failed }
  struct Step: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let state: StepState
    let note: String?
  }
  struct Texts: Codable, Hashable, Sendable {
    var commit: String
    var title: String
    var body: String
    var draft: Bool
  }
  struct Failure: Codable, Hashable, Sendable {
    let step: String
    let message: String
    let output: String?
    let conflicts: Bool
    let pushRefused: Bool
  }
  let kind: String
  let title: String
  let agent: String
  let stage: Stage
  let steps: [Step]
  let texts: Texts
  /// The glance's editable fields, top to bottom: commit / title / body / draft.
  let fields: [String]
  let submitLabel: String
  let submitBlocker: String?
  let error: Failure?
}

struct RemoteSession: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let projectId: String
  let title: String
  let agent: String
  let status: SessionStatus
  let action: String?
  /// Epoch ms the status began.
  let since: Double?
  let activity: Double
  let branch: String?
  let model: String?
  let reply: String?
  let ship: RemoteShip?
  let shipNotice: String?
  /// Model, effort and permission for this session (src/shared/session-settings.ts, Figma 64B–64F).
  var settings: SessionSettings? = nil
  /// What the agent ran this turn: 看板 · 进度's checks line (src/shared/turn-checks.ts).
  var checks: RemoteChecks? = nil
  /// The worktree's `+N −M` against its base; absent when both are 0 or unknown.
  var stat: RemoteStat? = nil
  /// The issue or PR the session works on (看板 · GitHub · 交给 agent).
  var github: GitHubLink? = nil
  /// The context window as the desktop's ring shows it (PRD F22 v1.230 ④); absent when the session has no reading.
  var context: RemoteContext? = nil
}

/// One session's context window (src/shared/remote.ts `RemoteContext`). `high` is worked out on the Mac; the phone never
/// re-derives the 20k / 80 % rule.
struct RemoteContext: Codable, Hashable, Sendable {
  /// 0–100.
  let percent: Double
  let usedTokens: Double?
  let windowTokens: Double?
  /// The agent's compaction point on the 0–100 scale; absent when it is not known.
  let markPercent: Double?
  let high: Bool
}

/// A vendor's plan windows (`RemoteVendorUsage`): the phone matches a session to it by its agent (`usageVendor`).
struct RemoteVendorUsage: Codable, Hashable, Sendable {
  struct Window: Codable, Hashable, Sendable, Identifiable {
    let minutes: Int
    let scope: String?
    /// 0–100.
    let percent: Double
    /// Epoch ms.
    let resetsAt: Double?

    var id: String { scope.map { "\(minutes):\($0)" } ?? String(minutes) }
  }
  /// claude / codex
  let vendor: String
  let plan: String?
  let windows: [Window]
}

/// 这一轮跑过的检查 as the phone shows it (turn-checks.ts `TurnCheckView`): the turns, without the runs.
struct RemoteChecks: Codable, Hashable, Sendable {
  enum Turn: String, Codable, Sendable { case current, previous }
  struct Kind: Codable, Hashable, Sendable {
    /// test / lint / typecheck / build
    let kind: String
    /// pass / fail / unknown / not-run
    let status: String
  }
  let turn: Turn
  let edited: Bool
  let kinds: [Kind]
}

struct RemoteStat: Codable, Hashable, Sendable {
  let added: Int
  let removed: Int
}

/// An issue or PR of a repository (`host/owner/name`); src/shared/types.ts `GitHubLink`.
struct GitHubLink: Codable, Hashable, Sendable {
  let repo: String
  /// issue / pr
  let kind: String
  let number: Int
}

/// 看板 · GitHub's 交给 agent (PRD F22 v1.229 ⑤): the item a new session works on.
struct GitHubTask: Codable, Hashable, Sendable {
  let link: GitHubLink
  let title: String
  /// A PR's head: where its worktree starts.
  let startAt: String?
}

struct SessionSettings: Codable, Hashable, Sendable {
  struct Value: Codable, Hashable, Sendable {
    let value: String
    let label: String
  }

  struct Item: Codable, Hashable, Sendable {
    /// model / effort / permission
    let kind: String
    let current: String
    let values: [Value]
    var currentLabel: String { values.first { $0.value == current }?.label ?? current }
  }

  let items: [Item]
  /// "running": the agent is mid-turn in its terminal, nothing changes until it stops (64E).
  let locked: String?
  /// Shown, never changed (64F).
  let readOnly: Bool?
}

struct RemoteSessionList: Codable, Hashable, Sendable {
  var projects: [RemoteProject]
  var sessions: [RemoteSession]
  /// The plan windows of each vendor that has any (PRD F22 v1.230 ④).
  var usage: [RemoteVendorUsage]? = nil
  static let empty = RemoteSessionList(projects: [], sessions: [])
}

struct RemoteExit: Codable, Hashable, Sendable {
  /// main / pr / push-pr / open-pr
  let kind: String
  let label: String
  let blocker: String?
  let url: String?
}

struct RemoteExits: Codable, Hashable, Sendable {
  struct PR: Codable, Hashable, Sendable {
    let number: Int
    let state: String
    let url: String
  }
  struct Archive: Codable, Hashable, Sendable { let blocker: String? }
  let primary: RemoteExit?
  let secondary: RemoteExit?
  let pr: PR?
  let base: String?
  let baseProtected: Bool?
  let archive: Archive
}

struct DiffHunk: Codable, Hashable, Sendable {
  let oldStart: Int
  let newStart: Int
  let lines: [String]
}

struct ToolDiff: Codable, Hashable, Sendable {
  let path: String
  let hunks: [DiffHunk]
  let added: Int
  let removed: Int
  let truncated: Bool
}

/// One item of a session's conversation (transcript-chat.ts): `kind` is user / text / thinking / tool / system / unknown.
struct ChatItem: Codable, Hashable, Sendable, Identifiable {
  let kind: String
  let id: String
  let at: Double
  var text: String? = nil
  var images: Int? = nil
  var ms: Double? = nil
  var name: String? = nil
  var arg: String? = nil
  /// running / ok / error
  var state: String? = nil
  var output: String? = nil
  var diff: ToolDiff? = nil
  var type: String? = nil
}

struct PermissionRule: Codable, Hashable, Sendable {
  let tool: String
  let content: String?
}

struct AllowAlwaysScope: Codable, Hashable, Sendable {
  let scope: String
  let rules: [PermissionRule]
}

struct QuestionOption: Codable, Hashable, Sendable {
  let label: String
  let description: String?
}

struct AgentQuestion: Codable, Hashable, Sendable {
  let header: String?
  let question: String
  let multiSelect: Bool
  let options: [QuestionOption]
}

/// A permission request, an AskUserQuestion or a plan a GUI session waits on; `answerable` while an answer from the phone
/// reaches it.
struct RemotePrompt: Codable, Hashable, Sendable, Identifiable {
  /// permission / question / plan
  let kind: String
  let id: String
  let sessionId: String
  let createdAt: Double
  let answerable: Bool
  var tool: String? = nil
  var input: [String: JSONValue]? = nil
  var summary: String? = nil
  var canAllowAlways: Bool? = nil
  var allowAlways: AllowAlwaysScope? = nil
  var questions: [AgentQuestion]? = nil
  /// The plan, as Markdown (a GUI session's plan; the phone's sheet is Figma 100, not drawn yet).
  var plan: String? = nil
}

struct GitFileChange: Codable, Hashable, Sendable {
  let path: String
  let oldPath: String?
  /// M / A / D / R / C / U / T
  let status: String
  let added: Int?
  let removed: Int?
  let untracked: Bool?
  let nested: Bool?
  let tooLarge: Bool?
}

struct GitChanges: Codable, Hashable, Sendable {
  let branch: String?
  let base: String?
  let ahead: Int
  let behind: Int
  let uncommitted: [GitFileChange]
  let committed: [GitFileChange]
}

struct NewSessionBranch: Codable, Hashable, Sendable {
  let name: String
  let remote: Bool
}

struct NewSessionInfo: Codable, Hashable, Sendable {
  let repo: Bool
  let currentBranch: String?
  let defaultBranch: String?
  let branches: [NewSessionBranch]
  let prefix: String
}

// MARK: - 看板 · GitHub (PRD F22 v1.229 ⑤, src/shared/github-board.ts)

/// `host/owner/name`, as gh and the branch names have it.
struct GitHubRepo: Codable, Hashable, Sendable {
  let host: String
  let owner: String
  let name: String
}

struct CheckSummaryFailure: Codable, Hashable, Sendable {
  let name: String
  /// The GitHub Actions run and job behind it; null for other CI.
  let runId: Double?
  let jobId: Double?
}

/// What a list row says about a PR's checks (pull-requests.ts `ChecksSummary`).
struct ChecksSummary: Codable, Hashable, Sendable {
  /// none / pending / passing / failing
  let state: String
  let total: Int
  let passed: Int
  let pending: Int
  let failing: [CheckSummaryFailure]
}

/// One row of a project's GitHub list (issue or PR).
struct BoardItem: Codable, Hashable, Sendable {
  /// issue / pr
  let kind: String
  let number: Int
  let title: String
  let url: String
  let author: String
  let labels: [String]
  let comments: Int
  /// Epoch ms.
  let updatedAt: Double
}

/// A PR row: an item plus what only a PR has.
struct BoardPr: Codable, Hashable, Sendable {
  let kind: String
  let number: Int
  let title: String
  let url: String
  let author: String
  let labels: [String]
  let comments: Int
  let updatedAt: Double
  let draft: Bool
  /// approved / changes-requested / review-required; null when GitHub has no verdict.
  let review: String?
  /// The gh user is among the requested reviewers.
  let reviewRequestedFromMe: Bool
  let checks: ChecksSummary
}

/// One project's board: `state` is ok / not-github / error (an error carries `message`).
struct BoardProject: Codable, Hashable, Sendable {
  let state: String
  let repo: GitHubRepo?
  let issues: [BoardItem]?
  let prs: [BoardPr]?
  let fetchedAt: Double?
  let message: String?
}

/// The `github-board` answer: gh's own state when it cannot answer at all (not installed, signed out), else each
/// project's board in the session list's order.
struct GitHubBoard: Codable, Hashable, Sendable {
  struct Project: Codable, Hashable, Sendable {
    let project: String
    let board: BoardProject
  }
  /// ready / checking / missing / signed-out
  let gh: String
  let projects: [Project]?
}

struct BoardComment: Codable, Hashable, Sendable {
  let author: String
  /// Epoch ms.
  let createdAt: Double
  /// Markdown as written on GitHub, capped. Untrusted.
  let body: String
}

/// A PR's branched side of a detail (github-board.ts `BoardDetail.pr`).
struct BoardDetailPr: Codable, Hashable, Sendable {
  struct Check: Codable, Hashable, Sendable {
    let name: String
    /// passed / failed / pending
    let verdict: String
    let startedAt: Double?
    let completedAt: Double?
  }
  let draft: Bool
  let headRef: String
  let baseRef: String
  /// The PR comes from a fork: nothing is pushed back to it.
  let crossRepo: Bool
  let additions: Int
  let deletions: Int
  let changedFiles: Int
  let review: String?
  let checks: [Check]
}

/// One item's body and comments (github-board.ts `BoardDetail`).
struct BoardDetail: Codable, Hashable, Sendable {
  /// issue / pr
  let kind: String
  let repo: GitHubRepo
  let number: Int
  let title: String
  let url: String
  /// open / closed / merged
  let state: String
  let author: String
  let createdAt: Double
  let labels: [String]
  let assignees: [String]
  let body: String
  /// The newest comments, oldest first.
  let comments: [BoardComment]
  let commentCount: Int
  let pr: BoardDetailPr?
}

/// The `github-detail` answer: `ok` with `detail`, or the reason it could not be read.
struct BoardDetailResult: Codable, Hashable, Sendable {
  let ok: Bool
  let detail: BoardDetail?
  let message: String?
}

/// The `github-start` answer: what the phone's 交给 agent form fills in.
struct GitHubStart: Codable, Hashable, Sendable {
  let link: GitHubLink
  /// `#139 …`: the session's title.
  let title: String
  /// The first message (`taskPrompt`), editable in the form.
  let prompt: String
  /// The branch the new worktree gets.
  let branch: String
  /// What it merges into: a PR's base; null = the project's default.
  let base: String?
  /// A PR's head, where the worktree starts.
  let startAt: String?
}

struct Hello: Codable, Sendable {
  let name: String
  let version: String
  /// REMOTE_PROTOCOL; absent from a Mac before it (that Mac speaks 1).
  let `protocol`: Int?
  let urls: [String]?
}

struct FeedUpdate: Codable, Sendable {
  let session: String
  let items: [ChatItem]
  let start: Int
  let reset: Bool?
}

struct RemotePhoto: Codable, Hashable, Sendable {
  let name: String
  /// base64 of the file
  let data: String
}

/// A file inside a session's folder, as the Mac reads it for the phone (src/shared/worktree-files.ts `FilePreview`):
/// `kind` is text / binary / too-large / missing, and only text carries the file.
struct RemoteFilePreview: Codable, Hashable, Sendable {
  let kind: String
  var text: String? = nil
  var size: Int? = nil
}

/// What the phone may do to an exit (the Ship block's buttons).
enum ShipAction: Sendable {
  case start(exit: String)
  case edit(RemoteShip.Texts)
  case submit, retry, cancel, conflicts, switchPr

  var json: JSONValue {
    switch self {
    case .start(let exit): return .object(["do": .string("start"), "exit": .string(exit)])
    case .edit(let t):
      return .object(["do": .string("edit"), "texts": .object(["commit": .string(t.commit), "title": .string(t.title), "body": .string(t.body), "draft": .bool(t.draft)])])
    case .submit: return .object(["do": .string("submit")])
    case .retry: return .object(["do": .string("retry")])
    case .cancel: return .object(["do": .string("cancel")])
    case .conflicts: return .object(["do": .string("conflicts")])
    case .switchPr: return .object(["do": .string("switch-pr")])
    }
  }
}

/// Phone → Wavi (src/shared/remote.ts `PhoneCommand`); main validates every field again.
enum PhoneCommand: Sendable {
  case snapshot
  case watch(session: String?)
  case feed(session: String, before: Int)
  case send(session: String, text: String, photos: [RemotePhoto])
  case interrupt(session: String)
  case permission(prompt: String, decision: String)
  /// 继续规划 / 批准，编辑时问我 / 批准并自动接受编辑 a GUI session's plan (PRD F22 v1.220 ①, the phone's sheet is Figma 100).
  case plan(prompt: String, decision: String)
  case answer(prompt: String, answers: [String: String])
  case newSessionInfo(project: String)
  case newSession(project: String, workdir: String, agent: String, base: String?, branch: String?, prompt: String?, model: String?, task: GitHubTask?)
  /// The same command without a 看板 · GitHub task (the phone's own 新建会话): what every call site but the board's uses.
  static func newSession(project: String, workdir: String, agent: String, base: String?, branch: String?, prompt: String?, model: String?) -> PhoneCommand {
    .newSession(project: project, workdir: workdir, agent: agent, base: base, branch: branch, prompt: prompt, model: model, task: nil)
  }
  case agentModels(agent: String)
  case changes(session: String)
  case diff(session: String, path: String, scope: String, oldPath: String?, untracked: Bool)
  /// The file a reply's chip names (PRD F22 v1.230): the path as written, inside the session's folder.
  case file(session: String, path: String)
  case exits(session: String)
  case ship(session: String, action: ShipAction)
  case archive(session: String)
  case setSetting(session: String, kind: String, value: String)
  /// 看板 · GitHub (PRD F22 v1.229 ⑤): every project's open issues and PRs; `force` skips the Mac's minute of cache.
  case githubBoard(scope: String, force: Bool)
  /// One item's body, comments and (for a PR) branches, size and checks.
  case githubDetail(project: String, kind: String, number: Int)
  /// What 交给 agent's form needs for the item (GitHubStart); a PR's head is fetched first.
  case githubStart(project: String, kind: String, number: Int)

  /// A permission answer's decision (for the receipt it leaves).
  var decision: String? { if case .permission(_, let d) = self { return d } else { return nil } }

  var fields: [String: JSONValue] {
    switch self {
    case .snapshot: return ["type": .string("snapshot")]
    case .watch(let s): return ["type": .string("watch"), "session": s.map { .string($0) } ?? .null]
    case .feed(let s, let before): return ["type": .string("feed"), "session": .string(s), "before": .number(Double(before))]
    case .send(let s, let text, let photos): return ["type": .string("send"), "session": .string(s), "text": .string(text), "photos": .from(photos)]
    case .interrupt(let s): return ["type": .string("interrupt"), "session": .string(s)]
    case .permission(let p, let d): return ["type": .string("permission"), "prompt": .string(p), "decision": .string(d)]
    case .plan(let p, let d): return ["type": .string("plan"), "prompt": .string(p), "decision": .string(d)]
    case .answer(let p, let a): return ["type": .string("answer"), "prompt": .string(p), "answers": .object(a.mapValues { .string($0) })]
    case .newSessionInfo(let p): return ["type": .string("new-session-info"), "project": .string(p)]
    case .newSession(let project, let workdir, let agent, let base, let branch, let prompt, let model, let task):
      var f: [String: JSONValue] = ["type": .string("new-session"), "project": .string(project), "workdir": .string(workdir), "agent": .string(agent)]
      if let base { f["base"] = .string(base) }
      if let branch { f["branch"] = .string(branch) }
      if let prompt { f["prompt"] = .string(prompt) }
      if let model { f["model"] = .string(model) }
      if let task { f["task"] = .from(task) }
      return f
    case .agentModels(let agent): return ["type": .string("agent-models"), "agent": .string(agent)]
    case .changes(let s): return ["type": .string("changes"), "session": .string(s)]
    case .diff(let s, let path, let scope, let oldPath, let untracked):
      var f: [String: JSONValue] = ["type": .string("diff"), "session": .string(s), "path": .string(path), "scope": .string(scope)]
      if let oldPath { f["oldPath"] = .string(oldPath) }
      if untracked { f["untracked"] = .bool(true) }
      return f
    case .file(let s, let path): return ["type": .string("file"), "session": .string(s), "path": .string(path)]
    case .exits(let s): return ["type": .string("exits"), "session": .string(s)]
    case .ship(let s, let action): return ["type": .string("ship"), "session": .string(s), "action": action.json]
    case .archive(let s): return ["type": .string("archive"), "session": .string(s)]
    case .setSetting(let s, let kind, let value): return ["type": .string("set-setting"), "session": .string(s), "kind": .string(kind), "value": .string(value)]
    case .githubBoard(let scope, let force):
      var f: [String: JSONValue] = ["type": .string("github-board"), "scope": .string(scope)]
      if force { f["force"] = .bool(true) }
      return f
    case .githubDetail(let project, let kind, let number):
      return ["type": .string("github-detail"), "project": .string(project), "kind": .string(kind), "number": .number(Double(number))]
    case .githubStart(let project, let kind, let number):
      return ["type": .string("github-start"), "project": .string(project), "kind": .string(kind), "number": .number(Double(number))]
    }
  }
}

/// A request's answer: `data` on success, the reason otherwise (the Mac's, in the Mac's language for now: PRD v1.193).
enum RemoteResult: Sendable {
  case ok(JSONValue?)
  case failed(String)
  /// No answer within the time the request allowed.
  case timedOut

  var error: String? {
    switch self {
    case .ok: nil
    case .failed(let e): e
    case .timedOut: String(localized: "超时")
    }
  }

  func decode<T: Decodable>(_ type: T.Type) -> T? {
    if case .ok(let data) = self { return data?.decode(T.self) }
    return nil
  }
}
