// 新建会话 (Figma 61F, states 63F1–63F5; the system Form, v1.119): the fields of the desktop's sheet (PRD F4) — project, 工作目录 (new worktree / current folder),
// the branch it starts from and its name, the agent and its model (67A / 67B: the agent's own list, from the Mac) — plus an optional first message. The Mac's window creates it the
// same way its own sheet does (src/renderer/remote/handler.ts); the phone then opens it.
import SwiftUI

struct NewSessionView: View {
  /// 看板 · GitHub's 交给 agent (PRD F22 v1.229 ④): the project is fixed and the Mac's hand-off fills in the branch, its base
  /// and the first message, which the form calls 任务 and which is sent with the session's `task`.
  struct Handoff: Identifiable {
    let project: String
    let start: GitHubStart
    var id: String { "\(start.link.kind)-\(start.link.number)" }
    /// `start.title` is `#142 …`: the form shows the number apart, in mono.
    var itemTitle: String {
      let prefix = "#\(start.link.number)"
      guard start.title.hasPrefix(prefix) else { return start.title }
      return start.title.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
    }
  }

  var handoff: Handoff?
  /// What WaviTests/BoardShots hands the form instead of a Mac's answers (the repo has no stand-in Mac).
  var fixture: BoardFixture?

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var project: String?
  @State private var data: Info?
  @State private var loadError: String?
  @State private var workdir = "worktree"
  @State private var base: String?
  @State private var branch = ""
  @State private var agent = "claude"
  /// The agent's models (not GUI: no row; none listed: only 默认) and the one picked (nil: the agent's default).
  @State private var models: AgentModels?
  @State private var pickedModel: String?
  @State private var prompt = ""
  /// 交给 agent's editable task (the Mac's `taskPrompt`), sent as the first message.
  @State private var task = ""
  @State private var busy = false
  @State private var error: String?

  init(handoff: Handoff? = nil, fixture: BoardFixture? = nil) {
    self.handoff = handoff
    self.fixture = fixture
    _project = State(initialValue: handoff?.project)
    _branch = State(initialValue: handoff?.start.branch ?? "")
    _task = State(initialValue: handoff?.start.prompt ?? "")
  }

  struct Info: Codable {
    let info: NewSessionInfo
    let agents: [String]
  }

  struct Created: Codable { let session: String? }

  struct AgentModels: Codable {
    struct Model: Codable { let value: String; let label: String }
    /// nil from a Mac older than v1.161's row: an empty list then means no row.
    let gui: Bool?
    let models: [Model]
    let current: String?
  }

  var body: some View {
    NavigationStack {
      Form {
        if let handoff {
          Section {
            // The item being handed over (Figma 103G): its glyph, `#142` in mono, then its title, standing alone above 项目.
            HStack(spacing: 8) {
              Icon(handoff.start.link.kind == "pr" ? "git-pull-request" : "circle-dot", size: 16).foregroundStyle(Color.textSecondary)
              Text("#\(handoff.start.link.number)").font(.mono(.footnote)).foregroundStyle(Color.textSecondary)
              Text(handoff.itemTitle).font(.ui(.subheadline)).foregroundStyle(Color.textPrimary).lineLimit(1)
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityElement(children: .combine)
          }
          .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
          Section {
            LabeledContent("项目", value: model.sessions.projects.first { $0.id == handoff.project }?.name ?? handoff.project)
          }
        } else {
          Picker("项目", selection: $project) {
            ForEach(model.sessions.projects) { Text($0.name).tag(Optional($0.id)) }
          }
        }
        if let error { Notice(tone: .danger, message: String(localized: "没有建成：\(error)")).listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
        if let loadError { Text(loadError).foregroundStyle(Color.noticeDanger) }
        if let data {
          Section {
            // 交给 agent always starts a new worktree (PRD F22 v1.229 ④): no 当前目录 to pick.
            if handoff == nil {
              Picker("工作目录", selection: $workdir) {
                Text("新 worktree").tag("worktree")
                Text("当前目录").tag("current")
              }
              .pickerStyle(.segmented)
              .disabled(!data.info.repo)
            }
            if !data.info.repo { LabeledContent("工作目录", value: String(localized: "不是 git 仓库，只能在当前目录")) }
            if workdir == "worktree" {
              Picker("基于", selection: $base) {
                let local = data.info.branches.filter { !$0.remote }
                let remote = data.info.branches.filter(\.remote)
                Section("本地分支") { ForEach(local, id: \.name) { Text($0.name).font(.mono()).tag(Optional($0.name)) } }
                if !remote.isEmpty { Section("远程分支") { ForEach(remote, id: \.name) { Text($0.name).font(.mono()).tag(Optional($0.name)) } } }
              }
              LabeledContent("分支名") {
                TextField("", text: $branch).font(.mono()).multilineTextAlignment(.trailing).autocorrectionDisabled().textInputAutocapitalization(.never)
              }
              if let problem = branchProblem(data) { Text(problem).font(.ui(.footnote)).foregroundStyle(Color.noticeDanger) }
            }
          }
          Section {
            if data.agents.isEmpty {
              LabeledContent("智能体") { Text("Mac 上没有安装").foregroundStyle(Color.noticeDanger) }
            } else {
              // A menu of our own: the system picker draws the chosen agent's mark flush against its name.
              LabeledContent("智能体") {
                Menu {
                  Picker("智能体", selection: $agent) {
                    ForEach(data.agents, id: \.self) { id in
                      Label { Text(Shared.agent(id).name) } icon: { AgentMark(agent: id, size: 16) }.tag(id)
                    }
                  }
                } label: {
                  HStack(spacing: 8) {
                    AgentMark(agent: agent, size: 16)
                    Text(Shared.agent(agent).name)
                    Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.medium)).foregroundStyle(Color.textSecondary)
                  }
                  .foregroundStyle(Color.textPrimary)
                }
              }
              modelRow
            }
          }
          if handoff == nil {
            Section("首条消息") {
              TextField("", text: $prompt, axis: .vertical).lineLimit(4...8)
            }
          } else {
            Section("任务") {
              TextField("", text: $task, axis: .vertical).lineLimit(6...16)
            }
          }
        } else if loadError == nil {
          Spinner(color: .textSecondary).frame(maxWidth: .infinity).accessibilityLabel("正在读取项目")
        }
      }
      .scrollContentBackground(.hidden)
      .background(Color.bgApp)
      .navigationTitle(handoff == nil ? "新建会话" : "交给 agent")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if handoff == nil {
            Button("取消") { dismiss() }
          } else {
            CircleIconButton(name: "arrow-left", label: String(localized: "返回")) { dismiss() }
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await create() } } label: {
            if busy { Spinner(color: .textPrimary) } else { Text(handoff == nil ? "创建" : "创建并发送") }
          }
          .disabled(!ready || busy)
        }
      }
    }
    .onAppear {
      if project == nil { project = model.sessions.sessions.max { $0.activity < $1.activity }?.projectId ?? model.sessions.projects.first?.id }
    }
    .task(id: project) { await load() }
    .task(id: agent) { await loadModels() }
  }

  /// 模型 under 智能体 (67A); a menu like the agent's (67B). Only 默认 when a GUI agent lists none (one that names its
  /// models only once a session runs, or the Mac could not ask it); no row for an agent that runs only in a terminal.
  @ViewBuilder private var modelRow: some View {
    if models == nil {
      LabeledContent("模型") { Spinner(color: .textSecondary) }.accessibilityLabel("正在读取模型")
    } else if let models, models.models.isEmpty, models.gui == true {
      LabeledContent("模型", value: String(localized: "默认"))
    } else if let models, !models.models.isEmpty {
      LabeledContent("模型") {
        Menu {
          Picker("模型", selection: $pickedModel) {
            if models.current == nil { Text("默认").tag(String?.none) }
            ForEach(models.models, id: \.value) { Text($0.label).tag(Optional($0.value)) }
          }
        } label: {
          HStack(spacing: 8) {
            Text(models.models.first { $0.value == pickedModel }?.label ?? String(localized: "默认"))
            Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.medium)).foregroundStyle(Color.textSecondary)
          }
          .foregroundStyle(Color.textPrimary)
        }
      }
    }
  }

  private var ready: Bool {
    guard let data, project != nil, data.agents.contains(agent) else { return false }
    return workdir == "current" || (base != nil && branchProblem(data) == nil)
  }

  /// Empty or already a local branch; anything else git refuses comes back from the Mac.
  private func branchProblem(_ data: Info) -> String? {
    if branch.trimmingCharacters(in: .whitespaces).isEmpty { return String(localized: "要填分支名") }
    return data.info.branches.contains { !$0.remote && $0.name == branch } ? String(localized: "已经有这个分支") : nil
  }

  private func load() async {
    guard let project else { return }
    data = nil
    loadError = nil
    let next: Info
    if let info = fixture?.info {
      next = info
    } else {
      let result = await model.call(.newSessionInfo(project: project))
      guard let loaded = result.decode(Info.self) else {
        loadError = result.error ?? String(localized: "没有读到这个项目")
        return
      }
      next = loaded
    }
    data = next
    workdir = next.info.repo ? "worktree" : "current"
    // 交给 agent starts a worktree where the Mac said (a PR's head, or the default branch), on the branch it named.
    base = handoff?.start.base ?? next.info.defaultBranch ?? next.info.currentBranch ?? next.info.branches.first { !$0.remote }?.name
    branch = handoff?.start.branch ?? generateBranchName(prefix: next.info.prefix, taken: Set(next.info.branches.map(\.name)))
    if !next.agents.contains(agent) { agent = next.agents.first ?? "claude" }
  }

  /// Asking an agent that has not run yet can take a few seconds on the Mac; 创建 does not wait for it (the agent's default).
  private func loadModels() async {
    let asked = agent
    models = nil
    pickedModel = nil
    let next: AgentModels
    if let models = fixture?.models {
      next = models
    } else {
      let result = await model.call(.agentModels(agent: asked))
      guard asked == agent else { return }
      // Not read: the agent starts with its default, so the row says so.
      next = result.decode(AgentModels.self) ?? AgentModels(gui: true, models: [], current: nil)
    }
    models = next
    pickedModel = next.current
  }

  private func create() async {
    guard ready, let project else { return }
    busy = true
    error = nil
    let worktree = workdir == "worktree"
    let text = handoff == nil ? prompt : task
    let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : text
    let result: RemoteResult
    if let start = handoff?.start {
      // The Mac waits up to 60 s for the window to make the session: the task request gets longer than an ordinary one.
      result = await model.call(.newSession(project: project, workdir: workdir, agent: agent, base: worktree ? base : nil,
        branch: worktree ? branch.trimmingCharacters(in: .whitespaces) : nil, prompt: prompt, model: pickedModel,
        task: GitHubTask(link: start.link, title: start.title, startAt: start.startAt)), timeout: 75)
    } else {
      result = await model.call(.newSession(project: project, workdir: workdir, agent: agent, base: worktree ? base : nil,
        branch: worktree ? branch.trimmingCharacters(in: .whitespaces) : nil, prompt: prompt, model: pickedModel))
    }
    busy = false
    if let failure = result.error {
      error = failure
      return
    }
    model.opening = result.decode(Created.self)?.session
    dismiss()
  }
}
