// Wavi on the iPhone (PRD F22): the sessions running in Wavi on the Mac, to follow, answer and steer from wherever the
// Mac can be reached (the same Wi-Fi or Tailscale). Two tabs (PRD v1.227 ①, Figma 103A): 会话 — the list and the screens
// opened from it — and 看板, the desktop board's 进度 and GitHub pages.
import SwiftUI

@main
struct WaviApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel.shared
  @Environment(\.scenePhase) private var phase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .tint(Color.textPrimary)
    }
    .onChange(of: phase) { _, phase in
      // A backgrounded app's socket may have died while it was frozen: reconnect, or check the open one.
      if phase == .active { model.wake() }
    }
  }
}

enum Route: Hashable {
  case session(String)
  case changes(String)
  case tool(session: String, item: String)
  /// The files one turn changed (its TurnChange's tool calls).
  case turn(session: String, tools: [String])
  case diff(session: String, path: String, scope: String, oldPath: String?, untracked: Bool)
  /// One issue or PR of 看板 · GitHub (PRD F22 v1.227 ③): its body, comments and 交给 agent.
  case github(project: String, kind: String, number: Int)
}

enum RootTab: Hashable { case sessions, board }

/// Not paired: pairing. Else the two tabs, each with its own stack: 会话 pushes the list's screens, 看板 its own (a card
/// opens the session right there, the GitHub list opens an item).
struct RootView: View {
  @Environment(AppModel.self) private var model
  @State private var tab: RootTab = .sessions
  @State private var path: [Route] = []
  @State private var boardPath: [Route] = []
  /// 看板's page, remembered on this phone (PRD v1.227 ①).
  @AppStorage("board.page") private var boardPage: BoardPage = .progress
  /// A `wavi://pair` link opened from elsewhere (the Camera app, a message): confirmed before it pairs.
  @State private var linked: PairingOffer?

  var body: some View {
    Group {
      if model.pairing == nil {
        PairView(offer: $linked)
      } else {
        TabView(selection: $tab) {
          Tab(value: RootTab.sessions) {
            NavigationStack(path: $path) {
              SessionsView()
                .navigationDestination(for: Route.self) { destination($0) }
            }
          } label: {
            Label("会话", image: "Icons/message-square")
          }
          Tab(value: RootTab.board) {
            NavigationStack(path: $boardPath) {
              BoardView(page: $boardPage)
                .navigationDestination(for: Route.self) { destination($0) }
            }
          } label: {
            Label("看板", image: "Icons/layout-list")
          }
        }
        .sheet(item: $linked) { _ in PairView(offer: $linked, replacing: model.pairing?.macName) }
      }
    }
    .onOpenURL { url in
      // A tap on the Live Activity: its session, or the list.
      if let session = ActivityLink.session(in: url) {
        tab = .sessions
        path = session.map { [.session($0)] } ?? []
      } else {
        linked = Link.parseOffer(url.absoluteString)
      }
    }
    .onChange(of: model.pairing == nil) { path = []; boardPath = [] }
    .onChange(of: model.backToList) { path = []; boardPath = [] }
    .onChange(of: path) { syncWatch() }
    .onChange(of: boardPath) { syncWatch() }
    .onChange(of: tab) { syncWatch() }
    // The new session shows up in the list Wavi pushes a moment after it is made.
    .onChange(of: model.opening.flatMap { model.session($0) }?.id) { _, id in
      guard let id else { return }
      model.opening = nil
      // 交给 agent opens the session it made, in the list where it appears.
      tab = .sessions
      path.append(.session(id))
    }
    // 只有看板 · 进度能横屏 (PRD v1.227 ②): the app delegate answers iOS with this, and a change turns the screen when the
    // phone is already held sideways. Pushing a session or an item, or the GitHub page, is portrait again.
    .onChange(of: allowsLandscape) { _, allowed in Orientation.apply(allowed) }
    .onAppear { Orientation.apply(allowsLandscape) }
  }

  /// A `wavi://pair` sheet may be up over 进度 (the phone was linked from elsewhere while the board was open): that sheet
  /// is portrait like the rest of PairView.
  private var allowsLandscape: Bool {
    model.pairing != nil && linked == nil && tab == .board && boardPath.isEmpty && boardPage == .progress
  }

  @ViewBuilder private func destination(_ route: Route) -> some View {
    switch route {
    case .session(let id): SessionView(id: id)
    case .changes(let id): ChangesView(id: id)
    case .tool(let session, let item): ToolView(session: session, item: item)
    case .turn(let session, let tools): TurnView(session: session, tools: tools)
    case .diff(let session, let file, let scope, let oldPath, let untracked):
      FileDiffView(session: session, path: file, scope: scope, oldPath: oldPath, untracked: untracked)
    case .github(let project, let kind, let number): GitHubItemView(project: project, kind: kind, number: number)
    }
  }

  /// The session on screen in the tab that is open (nil: that tab's list): the phone watches only that one.
  private func syncWatch() {
    let open = openSession(tab: tab, path: path, boardPath: boardPath)
    // One call, comparing against `open` alone (nil too): switching from a session to 看板 stops the watch, and switching
    // back to the session starts it again — `watching` being nil then must not skip the second part (the session page
    // would stay empty and frozen). SessionView's own `.task(id:)` sees `watching` already set here and does not ask
    // again, whichever of the two runs first.
    guard open != model.watching else { return }
    Task { await model.watch(open) }
  }
}

/// The session the tab on screen shows — the last one pushed in that tab's stack (nil: the tab's list). Each tab has its
/// own stack (RootView), so exactly one of the two paths can hold the session being read.
func openSession(tab: RootTab, path: [Route], boardPath: [Route]) -> String? {
  (tab == .sessions ? path : boardPath).compactMap { route in
    if case .session(let id) = route { id } else { nil }
  }.last
}

extension PairingOffer: Identifiable {
  var id: String { code }
}
