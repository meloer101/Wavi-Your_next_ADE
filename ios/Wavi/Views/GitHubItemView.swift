// One issue or PR of 看板 · GitHub (PRD F22 v1.227 ③④, Figma 103E / 103F): its body, a PR's branch, size and checks, and
// the latest comments. 在 GitHub 打开 hands it to the system browser; 交给 agent asks the Mac for the hand-off (the task,
// branch and start point it works out the same way the desktop does) and opens 新建会话 with it.
import SwiftUI

struct GitHubItemView: View {
  let project: String
  let kind: String
  let number: Int
  var fixture: BoardFixture?

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var detail: BoardDetail?
  @State private var failure: String?
  @State private var handoffFailure: String?
  @State private var handoff: NewSessionView.Handoff?
  @State private var starting = false

  var body: some View {
    Group {
      if let detail {
        content(detail)
      } else if let failure {
        EmptyState(title: failure, action: String(localized: "重试")) { Task { await load() } }
      } else {
        Spinner(color: .textSecondary).frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityLabel("正在读取")
      }
    }
    .background(Color.bgApp)
    .navigationBarBackButtonHidden(true)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        CircleIconButton(name: "arrow-left", label: String(localized: "返回")) { dismiss() }
      }
      if let detail {
        ToolbarItem(placement: .topBarTrailing) {
          HStack(spacing: 8) {
            CircleIconButton(name: "external-link", label: String(localized: "在 GitHub 打开")) {
              if let url = URL(string: detail.url) { openURL(url) }
            }
            Button { Task { await askAgent() } } label: {
              if starting {
                Spinner(color: .solidOn)
              } else {
                Text("交给 agent").font(.ui(.callout, medium: true)).foregroundStyle(Color.solidOn)
                  .padding(.horizontal, 16).frame(height: 36)
                  .background(Color.solidFill, in: Capsule())
              }
            }
            .buttonStyle(.plain)
            .disabled(starting)
            .accessibilityLabel("交给 agent")
          }
        }
      }
    }
    .task { await load() }
    .sheet(item: $handoff) { handoff in
      NewSessionView(handoff: handoff, fixture: fixture)
    }
  }

  private func content(_ detail: BoardDetail) -> some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let now = context.date.timeIntervalSince1970 * 1000
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          HStack(spacing: 4) {
            Text("#\(detail.number)").font(.mono(.caption)).foregroundStyle(Color.textSecondary)
            Text("·").font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
            Text("\(detail.repo.owner)/\(detail.repo.name)").font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
          }
          Text(detail.title).font(.ui(.headline)).foregroundStyle(Color.textPrimary).fixedSize(horizontal: false, vertical: true)
          Text(detailMetaText(detail, now: now)).font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
          if let pr = detail.pr {
            Text(detailBranchText(pr)).font(.mono(.caption)).foregroundStyle(Color.textSecondary)
              .fixedSize(horizontal: false, vertical: true)
            if !pr.checks.isEmpty { checks(pr, now: now) }
          }
          if !detail.body.isEmpty { MarkdownText(text: detail.body) }
          if !detail.comments.isEmpty { comments(detail, now: now) }
          if let handoffFailure {
            // A Mac older than 看板 answers 无效的请求: the phone says its Wavi needs an update (src/main/remote/server.ts).
            Notice(tone: .danger, message: isInvalidRequest(handoffFailure) ? String(localized: "Mac 上的 Wavi 要更新") : handoffFailure)
          }
        }
        .padding(.horizontal, Metric.margin)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollEdgeEffectStyle(.hard, for: .top)
    }
  }

  /// 检查 4, then one row each: the mark, the check's name, and how long it took, how long ago it failed or 进行中.
  private func checks(_ pr: BoardDetailPr, now: Double) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(String(localized: "检查 \(pr.checks.count)")).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textSecondary)
        .padding(.bottom, 4)
      ForEach(Array(pr.checks.enumerated()), id: \.offset) { index, check in
        HStack(spacing: 8) {
          Icon(check.verdict == "failed" ? "x" : check.verdict == "pending" ? "circle" : "check", size: 14)
            .foregroundStyle(check.verdict == "failed" ? Color.statusError : Color.textSecondary)
          Text(check.name).font(.ui(.footnote)).foregroundStyle(Color.textPrimary).lineLimit(1)
          Spacer(minLength: 8)
          Text(checkRightText(check, now: now)).font(.ui(.footnote)).monospacedDigit()
            .foregroundStyle(check.verdict == "failed" ? Color.statusError : Color.textSecondary)
        }
        .frame(minHeight: 32)
      }
    }
    .padding(.top, 4)
  }

  /// 评论 3, then the newest comments oldest first (Figma 103E): who and when, then what they wrote.
  private func comments(_ detail: BoardDetail, now: Double) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(String(localized: "评论 \(detail.commentCount)")).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textSecondary)
      ForEach(Array(detail.comments.enumerated()), id: \.offset) { _, comment in
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 6) {
            Text(comment.author).font(.ui(.footnote, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
            Text(ageText(comment.createdAt, now: now)).font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
          }
          MarkdownText(text: comment.body)
        }
      }
    }
    .padding(.top, 8)
  }

  private func load() async {
    if let detail = fixture?.detail {
      self.detail = detail
      return
    }
    let result = await model.call(.githubDetail(project: project, kind: kind, number: number), timeout: 60)
    if let answer = result.decode(BoardDetailResult.self), answer.ok, let detail = answer.detail {
      self.detail = detail
      failure = nil
    } else if let answer = result.decode(BoardDetailResult.self), !answer.ok {
      failure = answer.message.flatMap { isInvalidRequest($0) ? nil : $0 } ?? String(localized: "Mac 上的 Wavi 要更新")
    } else if let error = result.error {
      failure = isInvalidRequest(error) ? String(localized: "Mac 上的 Wavi 要更新") : error
    }
  }

  /// `github-start` (60 s: the Mac may fetch a PR's head first), then 新建会话 with the project fixed and the task filled in.
  private func askAgent() async {
    guard !starting else { return }
    starting = true
    defer { starting = false }
    handoffFailure = nil
    if let start = fixture?.start {
      handoff = NewSessionView.Handoff(project: project, start: start)
      return
    }
    let result = await model.call(.githubStart(project: project, kind: kind, number: number), timeout: 60)
    if let start = result.decode(GitHubStart.self) {
      handoff = NewSessionView.Handoff(project: project, start: start)
    } else {
      handoffFailure = result.error
    }
  }
}

/// A round icon button in a screen's toolbar (Figma 103E / 103F): 36 across, the icon in the text colour.
struct CircleIconButton: View {
  let name: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Icon(name, size: 17)
        .foregroundStyle(Color.textPrimary)
        .frame(width: 36, height: 36)
        .background(Color.fillStrong, in: Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}
